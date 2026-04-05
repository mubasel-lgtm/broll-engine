import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() { return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)}

const GEMINI_KEY = process.env.GEMINI_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

async function callGemini(prompt: string): Promise<string> {
  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    })
  })
  const data = await resp.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

export async function POST(req: NextRequest) {
  const { script, product_id, brand_id } = await req.json()

  // Step 1: Get ALL clips from DB
  const { data: allClips } = await getSupabase()
    .from('clips')
    .select('id, filename, description, dr_function, tags, mood, setting, has_product, has_person, person_gender, thumbnail_url, drive_url, reusability, camera_movement')

  // Step 1b: Load learnings for this product/brand to improve matching
  let learningsContext = ''
  if (product_id || brand_id) {
    let learningsQuery = getSupabase().from('learnings').select('script_line, dr_function, rejection_reason, editor_note').order('created_at', { ascending: false }).limit(30)
    if (product_id) learningsQuery = learningsQuery.eq('product_id', product_id)
    else if (brand_id) learningsQuery = learningsQuery.eq('brand_id', brand_id)
    const { data: learnings } = await learningsQuery
    if (learnings && learnings.length > 0) {
      learningsContext = `\n\nPAST EDITOR FEEDBACK — Learn from these rejections to improve your matching:
${learnings.map(l => `- Script: "${l.script_line}" (${l.dr_function}) — REJECTED because: ${l.rejection_reason}${l.editor_note ? ` (Note: ${l.editor_note})` : ''}`).join('\n')}

Use this feedback to AVOID making the same mistakes. If an editor rejected a clip for a certain reason, do NOT match similar clips for similar script lines.`
    }
  }

  if (!allClips || allClips.length === 0) {
    return NextResponse.json({ error: 'No clips in library' }, { status: 500 })
  }

  // Step 2: Build a compact clip catalog for Gemini
  const clipCatalog = allClips.map(c => ({
    id: c.id,
    desc: c.description?.substring(0, 80),
    dr: c.dr_function,
    tags: (c.tags || []).slice(0, 5).join(', '),
    mood: c.mood,
    product: c.has_product
  }))

  // Step 3: Send script + entire catalog to Gemini for intelligent matching
  const prompt = `You are a direct-response video ad editor. You have a script and a library of B-roll clips. Your job is to:

1. Split the script into logical B-roll segments (one per sentence or clause)
2. For EACH segment, pick the TOP 5 best matching clips from the library by their ID

IMPORTANT MATCHING RULES:
- Match based on VISUAL MEANING, not just keywords
- "Bei Galileo gesehen" = someone watching TV, a TV show, a screen → match clips showing TV/screens/watching
- "Zigarettengeruch" = cigarette smoke, smoky room, ashtray → match clips showing smoke/smoking
- "Luftfilter zu Hause" = air purifier device, home appliance → match clips showing purifiers/devices
- "Nikotinpartikel durch den Filter" = particles, filter, microscopic, scientific → match clips showing filters/particles
- "negative Ionen" = ions, scientific animation, technology → match clips showing ion/science content
- "nach einem Gewitter frisch" = rain, fresh air, nature, storm → match clips showing weather/nature/freshness
- "Wohnung riecht frisch" = clean home, happy, relief → match clips showing clean rooms/happy people
- "Besuch kam, alles vollgesprüht" = spraying air freshener, panic, cleaning → match clips showing cleaning/spraying
- "Freundin gefragt ob ich aufgehört hab" = friend visiting, surprised, conversation → match clips showing people talking/visiting
- "steckst das einmal ein" = plugging in device, product close-up → match clips showing product/plug-in
- "klick auf den Link" = CTA, product shot, call to action → match product/promo clips
- NEVER match a clip just because it shares a DR function — the VISUAL CONTENT must match the script line meaning

SCRIPT:
${script}

CLIP LIBRARY (${clipCatalog.length} clips):
${JSON.stringify(clipCatalog)}

Return JSON array. For each script segment:
{"line_number": 1, "text": "exact script text", "dr_function": "HOOK|PROBLEM|MECHANISM|PRODUCT|OUTCOME|SOCIAL_PROOF|CTA|LIFESTYLE", "search_tags": ["relevant", "visual", "tags"], "matched_clip_ids": [id1, id2, id3, id4, id5]}

Pick clip IDs that VISUALLY match what the script line is talking about. Order by best match first.${learningsContext}`

  const result = await callGemini(prompt)

  let lines: Array<{
    line_number: number
    text: string
    dr_function: string
    search_tags: string[]
    matched_clip_ids: number[]
  }> = []

  try {
    lines = JSON.parse(result)
  } catch {
    const start = result.indexOf('[')
    const end = result.lastIndexOf(']') + 1
    if (start >= 0 && end > start) {
      try { lines = JSON.parse(result.slice(start, end)) } catch { /* */ }
    }
  }

  if (!lines.length) {
    return NextResponse.json({ error: 'Failed to analyze script', raw: result.substring(0, 300) }, { status: 500 })
  }

  // Step 4: Build response with full clip data for matched IDs
  const clipMap = new Map(allClips.map(c => [c.id, c]))

  const output = lines.map(line => {
    const matches = (line.matched_clip_ids || [])
      .map((id, idx) => {
        const clip = clipMap.get(id)
        if (!clip) return null
        return { ...clip, match_score: 10 - idx * 2 }
      })
      .filter(Boolean)

    return {
      line_number: line.line_number,
      text: line.text,
      dr_function: line.dr_function,
      search_tags: line.search_tags || [],
      matches
    }
  })

  return NextResponse.json({ lines: output })
}
