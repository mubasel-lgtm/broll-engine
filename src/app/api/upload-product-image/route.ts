import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('image') as File
  const productId = formData.get('product_id') as string

  if (!file || !productId) {
    return NextResponse.json({ error: 'Missing image or product_id' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = `product_${productId}_${Date.now()}.png`

  // Upload to Supabase Storage
  const { error: uploadError } = await getSupabase().storage
    .from('product-images')
    .upload(filename, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: urlData } = getSupabase().storage.from('product-images').getPublicUrl(filename)

  // Update product record
  await getSupabase().from('products').update({ image_url: urlData.publicUrl }).eq('id', parseInt(productId))

  return NextResponse.json({ success: true, image_url: urlData.publicUrl })
}
