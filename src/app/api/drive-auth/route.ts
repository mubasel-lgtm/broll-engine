import { NextRequest, NextResponse } from 'next/server'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const origin = req.nextUrl.origin
  const redirectUri = `${origin}/api/drive-auth`

  // Already authorized?
  if (!code && process.env.GOOGLE_DRIVE_REFRESH_TOKEN) {
    return new NextResponse(`
      <html><body style="font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px">
        <h2 style="color:#059669">Google Drive ist verbunden</h2>
        <p>Refresh Token ist konfiguriert. Drive-Upload funktioniert.</p>
        <a href="/" style="color:#4F46E5">Zurück zur App</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }

  // Step 1: No code → redirect to Google consent
  if (!code) {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive')
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    return NextResponse.redirect(authUrl.toString())
  }

  // Step 2: Exchange code for tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
  })

  const tokens = await tokenResp.json()

  if (tokens.error) {
    return new NextResponse(`
      <html><body style="font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px">
        <h2 style="color:#DC2626">Fehler</h2>
        <p>${tokens.error_description || tokens.error}</p>
        <a href="/api/drive-auth" style="color:#4F46E5">Nochmal versuchen</a>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }

  return new NextResponse(`
    <html><body style="font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px">
      <h2 style="color:#059669">Google Drive verbunden!</h2>
      <p>Jetzt diesen Refresh Token als <code>GOOGLE_DRIVE_REFRESH_TOKEN</code> in Vercel setzen:</p>
      <div style="background:#F3F4F6;padding:16px;border-radius:12px;font-family:monospace;font-size:13px;word-break:break-all;margin:16px 0;border:1px solid #E5E7EB">
        ${tokens.refresh_token}
      </div>
      <p style="color:#6B7280;font-size:14px">Danach: <code>vercel env add GOOGLE_DRIVE_REFRESH_TOKEN production</code></p>
      <p style="color:#6B7280;font-size:14px">Der Token ist permanent und muss nur einmal gesetzt werden.</p>
    </body></html>
  `, { headers: { 'Content-Type': 'text/html' } })
}
