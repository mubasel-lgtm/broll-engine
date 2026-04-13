import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Shared token cache with proxy-video
let cachedToken: string | null = null
let tokenExpiry = 0

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    })
  })
  const data = await resp.json()
  if (!data.access_token) return null
  cachedToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000
  return cachedToken
}

function extractFileId(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

export async function GET(req: NextRequest) {
  const driveUrl = req.nextUrl.searchParams.get('url')
  if (!driveUrl) return new NextResponse(null, { status: 400 })

  const fileId = extractFileId(driveUrl)
  if (!fileId) return new NextResponse(null, { status: 400 })

  const token = await getAccessToken()
  if (!token) return new NextResponse(null, { status: 401 })

  try {
    // Get thumbnail link from Drive API
    const metaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink,hasThumbnail&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!metaResp.ok) return new NextResponse(null, { status: 502 })
    const meta = await metaResp.json()

    if (!meta.thumbnailLink) {
      // No thumbnail available — return a transparent 1x1 pixel
      return new NextResponse(null, { status: 204 })
    }

    // Fetch the thumbnail image (typically ~10-50KB JPEG)
    // Increase size from default: replace =s220 with =s640
    const thumbUrl = meta.thumbnailLink.replace(/=s\d+$/, '=s640')
    const thumbResp = await fetch(thumbUrl, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!thumbResp.ok) return new NextResponse(null, { status: 502 })

    const imageBuffer = await thumbResp.arrayBuffer()
    const contentType = thumbResp.headers.get('content-type') || 'image/jpeg'

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(imageBuffer.byteLength),
        'Cache-Control': 'public, max-age=604800, immutable', // 7 days
      }
    })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
