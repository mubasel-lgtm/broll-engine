import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getGoogleAccessToken } from '@/lib/drive'

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

// Fetch files created in the last 25 hours (daily cron with buffer)
async function listRecentVideos(folderId: string, accessToken: string) {
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType contains 'video/' and createdTime > '${since}'`)
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=createdTime desc`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return (data.files || []) as Array<{ id: string; name: string; mimeType: string; size: string }>
}

export const maxDuration = 300

async function handlePollDrive(req: NextRequest) {
  const accessToken = await getGoogleAccessToken()
  if (!accessToken) {
    return NextResponse.json({ error: 'Google Drive auth failed' }, { status: 500 })
  }

  // Load all known drive file IDs from DB in one query
  const { data: knownClips } = await getSupabase()
    .from('clips')
    .select('drive_url')
    .not('drive_url', 'is', null)
    .limit(5000)

  const knownFileIds = new Set(
    (knownClips || [])
      .map(c => c.drive_url?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1])
      .filter(Boolean)
  )

  const results: Array<{ product: string; new_clips: number; skipped: number; errors: number }> = []

  for (const folder of PRODUCT_FOLDERS) {
    let newClips = 0
    let skipped = 0
    let errors = 0

    try {
      const files = await listRecentVideos(folder.folder_id, accessToken)

      for (const file of files) {
        if (knownFileIds.has(file.id)) {
          skipped++
          continue
        }

        const driveUrl = `https://drive.google.com/file/d/${file.id}/view`

        try {
          const catResp = await fetch(new URL('/api/categorize-clip', req.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            else {
              newClips++
              knownFileIds.add(file.id)
            }
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
