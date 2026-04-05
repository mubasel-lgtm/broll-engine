import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const GEMINI_KEY = 'AIzaSyCO2wpYY8br2mBOihZq8BUpmEPSavI4a_A'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

// Simple API key for external callers (Make, scripts, etc.)
const API_KEY = process.env.CATEGORIZE_API_KEY || 'broll-cat-2024'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Extract Google Drive file ID from various URL formats
function extractDriveFileId(url: string): string | null {
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]+)/,           // /d/FILE_ID/
    /id=([a-zA-Z0-9_-]+)/,             // ?id=FILE_ID
    /folders\/([a-zA-Z0-9_-]+)/,       // /folders/FOLDER_ID (not a file, but useful)
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

export async function POST(req: NextRequest) {
  // Auth check: internal calls (same origin) skip auth, external need API key
  const authHeader = req.headers.get('x-api-key')
  const referer = req.headers.get('referer') || ''
  const isInternal = referer.includes(req.nextUrl.host)

  if (!isInternal && authHeader !== API_KEY) {
    return NextResponse.json({ error: 'Unauthorized. Provide x-api-key header.' }, { status: 401 })
  }

  const { image_base64, drive_url, filename, brand, filetype } = await req.json()

  if (!image_base64 && !drive_url) {
    return NextResponse.json({ error: 'Provide image_base64 or drive_url' }, { status: 400 })
  }

  // --- DEDUPLICATION: Check if this file is already in the DB ---
  if (drive_url) {
    const fileId = extractDriveFileId(drive_url)
    if (fileId) {
      // Check if any clip already has this Drive file ID in its drive_url
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

  // Also deduplicate by exact filename within the same brand
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

  // --- CATEGORIZE WITH GEMINI ---
  const parts: Array<Record<string, unknown>> = []

  if (image_base64) {
    const mimeType = filetype === 'video' ? 'video/mp4' : 'image/png'
    parts.push({ inline_data: { mime_type: mimeType, data: image_base64 } })
  }

  // If only drive_url (no base64), use the URL as context for Gemini
  // Make can send a thumbnail as image_base64 alongside the drive_url
  const mediaType = filetype || (filename?.match(/\.(mp4|mov|webm)$/i) ? 'video' : 'image')

  parts.push({
    text: `You are a B-roll clip categorizer for direct-response video ads. Analyze this ${mediaType} and categorize it.
${!image_base64 && drive_url ? `\nThe file is: "${filename || 'unknown'}" from Google Drive. Since you cannot see the file, categorize based on the filename and any patterns you recognize. Be conservative with your categorization.` : ''}

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
  const driveFileId = drive_url ? extractDriveFileId(drive_url) : null
  const driveLink = drive_url || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : '')

  const clipData = {
    filename: filename || `clip_${Date.now()}`,
    filepath: driveLink,
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
    drive_url: driveLink,
    thumbnail_url: '',
  }

  const { data: inserted, error } = await getSupabase()
    .from('clips')
    .insert(clipData)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: `DB insert failed: ${error.message}`, category }, { status: 500 })
  }

  return NextResponse.json({ success: true, clip: inserted, category })
}
