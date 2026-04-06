import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAccessToken } from '@/lib/drive'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const driveUrl = req.nextUrl.searchParams.get('url')
  if (!driveUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
  }

  const match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) {
    return NextResponse.json({ error: 'Invalid drive URL' }, { status: 400 })
  }

  const fileId = match[1]

  try {
    // Use Drive API v3 with OAuth token for reliable access (including Shared Drives)
    const accessToken = await getGoogleAccessToken()
    if (!accessToken) {
      return NextResponse.json({ error: 'Drive not authorized' }, { status: 401 })
    }

    const apiUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
    const resp = await fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })

    if (!resp.ok) {
      return NextResponse.json({ error: `Drive API returned ${resp.status}` }, { status: 502 })
    }

    const buffer = await resp.arrayBuffer()
    const contentType = resp.headers.get('content-type') || 'video/mp4'

    // Handle range requests for video seeking
    const range = req.headers.get('range')
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : buffer.byteLength - 1
      const chunk = buffer.slice(start, end + 1)

      return new NextResponse(chunk, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${buffer.byteLength}`,
          'Content-Length': String(chunk.byteLength),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
