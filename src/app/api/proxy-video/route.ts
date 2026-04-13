import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Cache access token in module scope (survives across requests in same instance)
let cachedToken: string | null = null
let tokenExpiry = 0

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken

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
  if (!driveUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
  }

  const fileId = extractFileId(driveUrl)
  if (!fileId) {
    return NextResponse.json({ error: 'Invalid drive URL' }, { status: 400 })
  }

  const accessToken = await getAccessToken()
  if (!accessToken) {
    return NextResponse.json({ error: 'Drive not authorized' }, { status: 401 })
  }

  try {
    // First get file metadata to know size + type
    const metaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=size,mimeType,name&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!metaResp.ok) {
      return NextResponse.json({ error: `Drive metadata: ${metaResp.status}` }, { status: 502 })
    }
    const meta = await metaResp.json()
    const fileSize = parseInt(meta.size) || 0
    const contentType = meta.mimeType || 'video/mp4'

    // Build headers for the Drive download request
    const driveHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    }

    // Pass through Range header from client for seeking support
    const rangeHeader = req.headers.get('range')
    if (rangeHeader) {
      driveHeaders['Range'] = rangeHeader
    }

    // Stream from Drive — do NOT buffer the whole file
    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
    const driveResp = await fetch(mediaUrl, { headers: driveHeaders })

    if (!driveResp.ok && driveResp.status !== 206) {
      return NextResponse.json({ error: `Drive download: ${driveResp.status}` }, { status: 502 })
    }

    // Build response headers
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400, immutable',
    }

    if (driveResp.status === 206) {
      // Partial content — pass through Drive's Content-Range
      const contentRange = driveResp.headers.get('content-range')
      const contentLength = driveResp.headers.get('content-length')
      if (contentRange) responseHeaders['Content-Range'] = contentRange
      if (contentLength) responseHeaders['Content-Length'] = contentLength

      return new NextResponse(driveResp.body, {
        status: 206,
        headers: responseHeaders,
      })
    }

    // Full response
    if (fileSize) responseHeaders['Content-Length'] = String(fileSize)

    return new NextResponse(driveResp.body, {
      status: 200,
      headers: responseHeaders,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
