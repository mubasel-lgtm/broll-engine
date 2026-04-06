import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const API_KEY = process.env.CATEGORIZE_API_KEY || 'broll-cat-2024'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Called by Make after uploading a clip to Google Drive
// Updates the clip's drive_url with the actual Drive link
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('x-api-key')
  if (authHeader !== API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clip_id, drive_url, drive_file_id } = await req.json()

  if (!clip_id || !drive_url) {
    return NextResponse.json({ error: 'Missing clip_id or drive_url' }, { status: 400 })
  }

  const { data, error } = await getSupabase()
    .from('clips')
    .update({
      drive_url,
      filepath: drive_url,
    })
    .eq('id', clip_id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, clip: data })
}
