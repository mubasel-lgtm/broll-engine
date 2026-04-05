import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const { product_id, brand_id, clip_id, script_line, dr_function, rejection_reason, editor_note } = await req.json()

  if (!script_line || !rejection_reason) {
    return NextResponse.json({ error: 'Missing script_line or rejection_reason' }, { status: 400 })
  }

  const { data, error } = await getSupabase()
    .from('learnings')
    .insert({
      product_id: product_id || null,
      brand_id: brand_id || null,
      clip_id: clip_id || null,
      script_line,
      dr_function: dr_function || null,
      rejection_reason,
      editor_note: editor_note || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, learning: data })
}

// GET endpoint to fetch learnings for a product (used by analyze-script)
export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get('product_id')
  const brandId = req.nextUrl.searchParams.get('brand_id')

  let query = getSupabase().from('learnings').select('*').order('created_at', { ascending: false }).limit(50)

  if (productId) query = query.eq('product_id', productId)
  else if (brandId) query = query.eq('brand_id', brandId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ learnings: data || [] })
}
