import { createClient } from '@supabase/supabase-js'

const BROLL_FOLDER_ID = '19B5_90zVZJIirJGPpklArzp2C-JzSugC'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function getGoogleAccessToken(): Promise<string | null> {
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!refreshToken || !clientId || !clientSecret) return null

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  })
  const data = await resp.json()
  return data.access_token || null
}

export async function uploadFileToDrive(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ id: string; webViewLink: string; driveUrl: string } | null> {
  const accessToken = await getGoogleAccessToken()
  if (!accessToken) return null

  const metadata = JSON.stringify({
    name: filename,
    parents: [BROLL_FOLDER_ID],
  })

  const boundary = 'broll_upload_boundary'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ])

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )

  if (!resp.ok) return null

  const result = await resp.json()
  return {
    id: result.id,
    webViewLink: result.webViewLink,
    driveUrl: `https://drive.google.com/file/d/${result.id}/view`,
  }
}

// Full flow: download file → upload to Drive → update clip in DB
export async function uploadClipToDrive(
  clipId: number,
  fileUrl: string,
  filename: string
): Promise<string | null> {
  // Download file
  const fileResp = await fetch(fileUrl)
  if (!fileResp.ok) return null
  const fileBuffer = Buffer.from(await fileResp.arrayBuffer())
  const mimeType = filename.match(/\.(mp4|mov|webm)$/i) ? 'video/mp4' : 'image/png'

  // Upload to Drive
  const driveFile = await uploadFileToDrive(fileBuffer, filename, mimeType)
  if (!driveFile) return null

  // Update clip in DB
  await getSupabase()
    .from('clips')
    .update({ drive_url: driveFile.driveUrl, filepath: driveFile.driveUrl })
    .eq('id', clipId)

  return driveFile.driveUrl
}
