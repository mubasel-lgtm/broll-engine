import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Save analysis results for a project
export async function POST(req: NextRequest) {
  const { project_id, lines } = await req.json()

  if (!project_id || !lines?.length) {
    return NextResponse.json({ error: 'Missing project_id or lines' }, { status: 400 })
  }

  // Delete old results for this project (in case of re-analysis)
  await getSupabase().from('project_results').delete().eq('project_id', project_id)

  // Insert new results
  const rows = lines.map((line: { line_number: number; text: string; dr_function: string; search_tags: string[]; matches: Array<{ id: number }> }) => ({
    project_id,
    line_number: line.line_number,
    script_text: line.text,
    dr_function: line.dr_function,
    search_tags: line.search_tags || [],
    matched_clip_ids: (line.matches || []).map((m: { id: number }) => m.id),
    status: 'pending',
  }))

  const { error } = await getSupabase().from('project_results').insert(rows)

  if (error) {
    return NextResponse.json({ error: `Save failed: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, saved: rows.length })
}

// Load results for a project
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  const { data: results, error } = await getSupabase()
    .from('project_results')
    .select('*')
    .eq('project_id', projectId)
    .order('line_number')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ results: results || [] })
}

// Update a single line result (when editor selects/generates)
export async function PATCH(req: NextRequest) {
  const { id, selected_clip_id, generated_image_url, generated_video_url, status } = await req.json()

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (selected_clip_id !== undefined) update.selected_clip_id = selected_clip_id
  if (generated_image_url !== undefined) update.generated_image_url = generated_image_url
  if (generated_video_url !== undefined) update.generated_video_url = generated_video_url
  if (status !== undefined) update.status = status

  const { error } = await getSupabase()
    .from('project_results')
    .update(update)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
