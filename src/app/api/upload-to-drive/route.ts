import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const BROLL_FOLDER_ID = '19B5_90zVZJIirJGPpklArzp2C-JzSugC'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Get a fresh access token using the stored refresh token
async function getAccessToken(): Promise<string | null> {
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  if (!refreshToken) return null

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  })
  const data = await resp.json()
  return data.access_token || null
}

// Upload file to Google Drive B-Roll folder
async function uploadToDrive(accessToken: string, filename: string, fileBuffer: Buffer, mimeType: string): Promise<{ id: string; webViewLink: string } | null> {
  // Google Drive API v3 multipart upload
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

  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })

  if (!resp.ok) {
    const err = await resp.text()
    console.error('Drive upload failed:', err)
    return null
  }

  return await resp.json()
}

export async function POST(req: NextRequest) {
  const { clip_id, file_url, filename } = await req.json()

  if (!clip_id || !file_url || !filename) {
    return NextResponse.json({ error: 'Missing clip_id, file_url, or filename' }, { status: 400 })
  }

  // Get access token
  const accessToken = await getAccessToken()
  if (!accessToken) {
    return NextResponse.json({ error: 'Google Drive not authorized. Visit /api/drive-auth first.' }, { status: 401 })
  }

  // Download file from Supabase Storage (or external URL)
  const fileResp = await fetch(file_url)
  if (!fileResp.ok) {
    return NextResponse.json({ error: `Failed to download file: ${fileResp.status}` }, { status: 500 })
  }
  const fileBuffer = Buffer.from(await fileResp.arrayBuffer())
  const mimeType = filename.match(/\.(mp4|mov|webm)$/i) ? 'video/mp4' : 'image/png'

  // Upload to Google Drive
  const driveFile = await uploadToDrive(accessToken, filename, fileBuffer, mimeType)
  if (!driveFile) {
    return NextResponse.json({ error: 'Google Drive upload failed' }, { status: 500 })
  }

  // Update clip in DB with Drive URL
  const driveUrl = `https://drive.google.com/file/d/${driveFile.id}/view`
  const { error } = await getSupabase()
    .from('clips')
    .update({ drive_url: driveUrl, filepath: driveUrl })
    .eq('id', clip_id)

  if (error) {
    return NextResponse.json({ error: `DB update failed: ${error.message}`, drive_url: driveUrl }, { status: 500 })
  }

  return NextResponse.json({ success: true, drive_url: driveUrl, drive_file_id: driveFile.id })
}
