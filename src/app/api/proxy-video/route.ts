import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const driveUrl = req.nextUrl.searchParams.get('url')
  if (!driveUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
  }

  const match = driveUrl.match(/\/d\/([^/]+)/)
  if (!match) {
    return NextResponse.json({ error: 'Invalid drive URL' }, { status: 400 })
  }

  const fileId = match[1]
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`

  try {
    // First, follow redirects to get the actual download URL
    const headResp = await fetch(downloadUrl, { method: 'GET', redirect: 'follow' })

    if (!headResp.ok) {
      return NextResponse.json({ error: `Drive returned ${headResp.status}` }, { status: 502 })
    }

    // Get the full content as array buffer
    const buffer = await headResp.arrayBuffer()
    const contentType = headResp.headers.get('content-type') || 'video/mp4'

    // Handle range requests for proper video seeking
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

    // Full response
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
