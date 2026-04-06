import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { uploadClipToDrive } from '@/lib/drive'

const GEMINI_KEY = process.env.GEMINI_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

// Simple API key for external callers (Make, scripts, etc.)
const API_KEY = process.env.CATEGORIZE_API_KEY || 'broll-cat-2024'

// Google Drive upload is handled by /api/upload-to-drive (no Make needed)

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Extract Google Drive file ID from various URL formats
function extractDriveFileId(url: string): string | null {
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

// Build a categorized filename: DRFUNCTION_mood_setting_clipID.ext
function buildCategorizedFilename(category: Record<string, unknown>, clipId: number, originalFilename: string): string {
  const ext = originalFilename.match(/\.[^.]+$/)?.[0] || '.mp4'
  const dr = (category.dr_function as string || 'OTHER').toUpperCase()
  const mood = (category.mood as string || 'neutral').replace(/\s+/g, '-').toLowerCase()
  const setting = (category.setting as string || 'unknown').replace(/\s+/g, '-').toLowerCase()
  return `${dr}_${mood}_${setting}_clip${clipId}${ext}`
}

export async function POST(req: NextRequest) {
  // Auth check: internal calls (same origin) skip auth, external need API key
  const authHeader = req.headers.get('x-api-key')
  const referer = req.headers.get('referer') || ''
  const isInternal = referer.includes(req.nextUrl.host)

  if (!isInternal && authHeader !== API_KEY) {
    return NextResponse.json({ error: 'Unauthorized. Provide x-api-key header.' }, { status: 401 })
  }

  const { image_base64, drive_url, video_url, filename, brand, filetype } = await req.json()

  // Accept video_url (from create-video/Kling) or drive_url
  const externalUrl = drive_url || video_url || ''

  if (!image_base64 && !externalUrl) {
    return NextResponse.json({ error: 'Provide image_base64, drive_url, or video_url' }, { status: 400 })
  }

  // --- DEDUPLICATION: Check if this file is already in the DB ---
  if (externalUrl) {
    const fileId = extractDriveFileId(externalUrl)
    if (fileId) {
      const { data: existing } = await getSupabase()
        .from('clips')
        .select('id, filename')
        .like('drive_url', `%${fileId}%`)
        .limit(1)

      if (existing && existing.length > 0) {
        return NextResponse.json({
          skipped: true,
          message: `Already categorized: ${existing[0].filename} (clip #${existing[0].id})`,
          clip_id: existing[0].id
        })
      }
    }
  }

  if (filename && brand) {
    const { data: existingByName } = await getSupabase()
      .from('clips')
      .select('id')
      .eq('filename', filename)
      .eq('brand', brand)
      .limit(1)

    if (existingByName && existingByName.length > 0) {
      return NextResponse.json({
        skipped: true,
        message: `Already categorized: ${filename} (clip #${existingByName[0].id})`,
        clip_id: existingByName[0].id
      })
    }
  }

  // --- SAVE FILE TO SUPABASE STORAGE ---
  let storageUrl = ''
  const safeFilename = (filename || `clip_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${brand || 'uncategorized'}/${safeFilename}`

  if (video_url && !drive_url) {
    // Kling video URL — download the actual VIDEO and save to storage (priority over image)
    try {
      const videoResp = await fetch(video_url)
      if (videoResp.ok) {
        const videoBuffer = Buffer.from(await videoResp.arrayBuffer())
        const { error: uploadError } = await getSupabase().storage
          .from('broll-clips')
          .upload(storagePath, videoBuffer, { contentType: 'video/mp4', upsert: true })

        if (!uploadError) {
          const { data: urlData } = getSupabase().storage.from('broll-clips').getPublicUrl(storagePath)
          storageUrl = urlData.publicUrl
        }
      }
    } catch (e) {
      console.error('Failed to download video for storage:', e)
    }
  } else if (image_base64 && !video_url) {
    // Image-only upload (no video URL) — save image to storage
    const isVideo = filetype === 'video' || safeFilename.match(/\.(mp4|mov|webm)$/i)
    const contentType = isVideo ? 'video/mp4' : 'image/png'
    const buffer = Buffer.from(image_base64, 'base64')

    const { error: uploadError } = await getSupabase().storage
      .from('broll-clips')
      .upload(storagePath, buffer, { contentType, upsert: true })

    if (!uploadError) {
      const { data: urlData } = getSupabase().storage.from('broll-clips').getPublicUrl(storagePath)
      storageUrl = urlData.publicUrl
    }
  }

  // --- CATEGORIZE WITH GEMINI (prefer video over image) ---
  const parts: Array<Record<string, unknown>> = []
  const mediaType = filetype || (safeFilename.match(/\.(mp4|mov|webm)$/i) ? 'video' : 'image')

  if (video_url && !drive_url) {
    // Send the actual video to Gemini for categorization
    try {
      const videoResp = await fetch(storageUrl || video_url)
      if (videoResp.ok) {
        const videoBuffer = Buffer.from(await videoResp.arrayBuffer())
        const videoBase64 = videoBuffer.toString('base64')
        parts.push({ inline_data: { mime_type: 'video/mp4', data: videoBase64 } })
      }
    } catch (e) {
      console.error('Failed to load video for Gemini:', e)
    }
  }

  // Fallback to image if no video was added
  if (parts.length === 0 && image_base64) {
    const mimeType = mediaType === 'video' ? 'video/mp4' : 'image/png'
    parts.push({ inline_data: { mime_type: mimeType, data: image_base64 } })
  }

  parts.push({
    text: `You are a B-roll clip categorizer for direct-response video ads. Analyze this ${mediaType} and categorize it.
${!image_base64 && externalUrl ? `\nThe file is: "${filename || 'unknown'}" from Google Drive. Since you cannot see the file, categorize based on the filename and any patterns you recognize. Be conservative with your categorization.` : ''}

Return JSON with exactly these fields:
{
  "description": "2-3 sentence description of what's visually happening",
  "dr_function": "one of: HOOK, PROBLEM, MECHANISM, PRODUCT, OUTCOME, LIFESTYLE, SOCIAL_PROOF, CTA, OTHER",
  "tags": ["array", "of", "5-10", "visual", "tags"],
  "has_product": true/false,
  "has_person": true/false,
  "person_gender": "male/female/none",
  "person_age_range": "e.g. 25-35 or none",
  "mood": "e.g. frustrated, happy, calm, energetic, scientific",
  "palette": "e.g. bright natural, warm tones, cool tones, neutral",
  "setting": "e.g. living room, kitchen, bathroom, outdoor, studio",
  "camera_movement": "e.g. static, slow zoom, pan, handheld",
  "reusability": "high/medium/low — high if generic enough for multiple scripts",
  "reusability_reason": "why this reusability rating"
}

IMPORTANT:
- dr_function should reflect the VISUAL PURPOSE in a direct-response ad
- Tags should describe what you SEE, not abstract concepts
- Be specific about the setting and mood
- For reusability: product-specific shots = low, generic lifestyle = high`
  })

  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    })
  })

  const data = await resp.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

  let category: Record<string, unknown>
  try {
    category = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Failed to parse categorization', raw: text.substring(0, 300) }, { status: 500 })
  }

  // --- SAVE TO CLIPS TABLE ---
  const clipData = {
    filename: filename || `clip_${Date.now()}`,
    filepath: storageUrl || externalUrl,
    filetype: mediaType,
    description: category.description,
    dr_function: category.dr_function,
    tags: category.tags,
    has_product: category.has_product,
    has_person: category.has_person,
    person_gender: category.person_gender || 'none',
    person_age_range: category.person_age_range || 'none',
    mood: category.mood,
    palette: category.palette,
    setting: category.setting,
    camera_movement: category.camera_movement,
    reusability: category.reusability,
    reusability_reason: category.reusability_reason,
    brand: brand || 'Uncategorized',
    drive_url: externalUrl,
    thumbnail_url: storageUrl || '',
  }

  const { data: inserted, error } = await getSupabase()
    .from('clips')
    .insert(clipData)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: `DB insert failed: ${error.message}`, category }, { status: 500 })
  }

  // --- UPLOAD TO GOOGLE DRIVE (inline, before response) ---
  let driveUrl = ''
  if (inserted && (storageUrl || externalUrl) && process.env.GOOGLE_DRIVE_REFRESH_TOKEN) {
    const categorizedFilename = buildCategorizedFilename(category, inserted.id, clipData.filename)
    try {
      driveUrl = await uploadClipToDrive(inserted.id, storageUrl || externalUrl, categorizedFilename) || ''
    } catch (e) {
      console.error('Drive upload failed:', e)
    }
  }

  return NextResponse.json({ success: true, clip: { ...inserted, drive_url: driveUrl || inserted.drive_url }, category, storage_url: storageUrl, drive_url: driveUrl })
}
