import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getGoogleAccessToken } from '@/lib/drive'

const API_KEY = process.env.CATEGORIZE_API_KEY || 'broll-cat-2024'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Product folders to watch
const PRODUCT_FOLDERS = [
  { product_id: 1, brand: 'NorvaHaus', name: 'ODRX V2', folder_id: '19B5_90zVZJIirJGPpklArzp2C-JzSugC' },
  { product_id: 2, brand: 'PetBloom', name: 'Teeth', folder_id: '1Na5rTNDuePZT_RsPBH20ANhN6XH17c71' },
  { product_id: 3, brand: 'PetBloom', name: 'Dog Joint', folder_id: '15A1GjbH56p3wnMcXalrw23qq0zpjll0D' },
  { product_id: 4, brand: 'PetBloom', name: 'Digestion', folder_id: '18or234A5qryiaFFZ7JQnVtl0fASqDNpi' },
]

async function listNewVideos(folderId: string, accessToken: string) {
  const allFiles: Array<{ id: string; name: string; mimeType: string; size: string }> = []
  let pageToken: string | null = null

  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType contains 'video/'`)
    let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=createdTime desc`
    if (pageToken) url += `&pageToken=${pageToken}`

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    allFiles.push(...(data.files || []))
    pageToken = data.nextPageToken || null
  } while (pageToken)

  return allFiles
}

export const maxDuration = 300

async function handlePollDrive(req: NextRequest) {

  const accessToken = await getGoogleAccessToken()
  if (!accessToken) {
    return NextResponse.json({ error: 'Google Drive auth failed' }, { status: 500 })
  }

  const results: Array<{ product: string; new_clips: number; skipped: number; errors: number }> = []

  for (const folder of PRODUCT_FOLDERS) {
    let newClips = 0
    let skipped = 0
    let errors = 0

    try {
      const files = await listNewVideos(folder.folder_id, accessToken)

      for (const file of files) {
        const driveUrl = `https://drive.google.com/file/d/${file.id}/view`

        // Check if already in DB
        const { data: existing } = await getSupabase()
          .from('clips')
          .select('id')
          .or(`drive_url.like.%${file.id}%,filename.eq.${file.name}`)
          .eq('brand', folder.brand)
          .limit(1)

        if (existing && existing.length > 0) {
          skipped++
          continue
        }

        // New file — categorize it
        try {
          const catResp = await fetch(new URL('/api/categorize-clip', req.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: JSON.stringify({
              drive_url: driveUrl,
              filename: file.name,
              brand: folder.brand,
              product_id: folder.product_id,
              filetype: 'video',
            })
          })

          if (catResp.ok) {
            const catData = await catResp.json()
            if (catData.skipped) skipped++
            else newClips++
          } else {
            errors++
          }
        } catch {
          errors++
        }
      }
    } catch (e) {
      errors++
      console.error(`poll-drive error for ${folder.name}:`, e)
    }

    results.push({ product: folder.name, new_clips: newClips, skipped, errors })
  }

  return NextResponse.json({ results, polled_at: new Date().toISOString() })
}

// Vercel Cron calls GET
export async function GET(req: NextRequest) {
  return handlePollDrive(req)
}

// Manual/Make calls POST
export async function POST(req: NextRequest) {
  return handlePollDrive(req)
}
