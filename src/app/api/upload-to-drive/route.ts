import { NextRequest, NextResponse } from 'next/server'
import { uploadClipToDrive } from '@/lib/drive'

// Standalone endpoint for manual retries or external calls
export async function POST(req: NextRequest) {
  const { clip_id, file_url, filename } = await req.json()

  if (!clip_id || !file_url || !filename) {
    return NextResponse.json({ error: 'Missing clip_id, file_url, or filename' }, { status: 400 })
  }

  if (!process.env.GOOGLE_DRIVE_REFRESH_TOKEN) {
    return NextResponse.json({ error: 'Google Drive not authorized. Visit /api/drive-auth first.' }, { status: 401 })
  }

  try {
    const driveUrl = await uploadClipToDrive(clip_id, file_url, filename)
    if (!driveUrl) {
      return NextResponse.json({ error: 'Google Drive upload failed' }, { status: 500 })
    }
    return NextResponse.json({ success: true, drive_url: driveUrl })
  } catch (e) {
    return NextResponse.json({ error: `Upload failed: ${e}` }, { status: 500 })
  }
}
