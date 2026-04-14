import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() { return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)}

const GEMINI_KEY = process.env.GEMINI_KEY!
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`

export const maxDuration = 300

async function callLLM(prompt: string, maxTokens = 8192, thinkingBudget = 0): Promise<{ content: string; debug: string }> {
  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget },
      },
    }),
  })
  const text = await resp.text()
  if (!resp.ok) {
    return { content: '', debug: `HTTP ${resp.status}: ${text.slice(0, 400)}` }
  }
  let data: { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; error?: { message?: string } }
  try { data = JSON.parse(text) } catch {
    return { content: '', debug: `Non-JSON response: ${text.slice(0, 400)}` }
  }
  if (data.error) return { content: '', debug: `API error: ${data.error.message || JSON.stringify(data.error)}` }
  const parts = data.candidates?.[0]?.content?.parts || []
  const content = parts.map(p => p.text || '').join('')
  const finish = data.candidates?.[0]?.finishReason || 'unknown'
  return { content, debug: `finish=${finish}, len=${content.length}` }
}

type ClipRow = {
  id: number
  filename: string | null
  description: string | null
  dr_function: string | null
  tags: string[] | null
  mood: string | null
  setting: string | null
  has_product: boolean | null
  has_person: boolean | null
  person_gender: string | null
  thumbnail_url: string | null
  drive_url: string | null
  reusability: string | null
  camera_movement: string | null
  filetype: string | null
}

type Segment = {
  line_number: number
  text: string
  text_en: string
  dr_function: string
  search_tags: string[]
}

function extractMatchedIds(raw: string): number[] {
  if (!raw) return []
  const tryParse = (s: string): number[] => {
    try {
      const parsed = JSON.parse(s)
      const ids = parsed.matched_clip_ids || parsed.ids || parsed.clip_ids || (Array.isArray(parsed) ? parsed : [])
      return (Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isFinite(n))
    } catch { return [] }
  }
  let ids = tryParse(raw.trim())
  if (ids.length) return ids
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) {
    ids = tryParse(fence[1])
    if (ids.length) return ids
  }
  const objStart = raw.indexOf('{')
  const objEnd = raw.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    ids = tryParse(raw.slice(objStart, objEnd + 1))
    if (ids.length) return ids
  }
  const arrStart = raw.indexOf('[')
  const arrEnd = raw.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    ids = tryParse(raw.slice(arrStart, arrEnd + 1))
    if (ids.length) return ids
  }
  // Last resort: extract any integers from the response
  const nums = raw.match(/\b\d{1,6}\b/g)
  if (nums) return nums.slice(0, 5).map(Number)
  return []
}

function extractSegments(raw: string): Segment[] {
  if (!raw) return []
  const tryParse = (s: string): Segment[] => {
    try {
      const parsed = JSON.parse(s)
      const arr = Array.isArray(parsed) ? parsed : (parsed.lines || parsed.segments || parsed.data || [])
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }
  // Try direct
  let segs = tryParse(raw.trim())
  if (segs.length) return segs
  // Try stripping markdown fences
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) {
    segs = tryParse(fence[1])
    if (segs.length) return segs
  }
  // Try extracting first {...} or [...]
  const objStart = raw.indexOf('{')
  const objEnd = raw.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    segs = tryParse(raw.slice(objStart, objEnd + 1))
    if (segs.length) return segs
  }
  const arrStart = raw.indexOf('[')
  const arrEnd = raw.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    segs = tryParse(raw.slice(arrStart, arrEnd + 1))
    if (segs.length) return segs
  }
  return []
}

export async function POST(req: NextRequest) {
  const { script, product_id, brand_id } = await req.json()

  // Load product / brand / learnings in parallel
  const [brandRes, productRes] = await Promise.all([
    brand_id ? getSupabase().from('brands').select('name').eq('id', brand_id).single() : Promise.resolve({ data: null as { name: string } | null }),
    product_id ? getSupabase().from('products').select('name, matching_prompt').eq('id', product_id).single() : Promise.resolve({ data: null as { name: string; matching_prompt: string } | null }),
  ])
  const brandName = brandRes.data?.name || ''
  const productName = productRes.data?.name || ''
  const productPrompt = productRes.data?.matching_prompt || ''

  // Load clips filtered by product (preferred) or brand
  let clipQuery = getSupabase()
    .from('clips')
    .select('id, filename, description, dr_function, tags, mood, setting, has_product, has_person, person_gender, thumbnail_url, drive_url, reusability, camera_movement, filetype')
    .eq('filetype', 'video')
  if (product_id) clipQuery = clipQuery.eq('product_id', product_id)
  else if (brandName) clipQuery = clipQuery.eq('brand', brandName)

  const { data: allClipsRaw } = await clipQuery.limit(5000)
  const allClips = (allClipsRaw || []) as ClipRow[]
  if (allClips.length === 0) {
    return NextResponse.json({ error: 'No clips in library' }, { status: 500 })
  }

  // Load learnings
  let learningsContext = ''
  if (product_id || brand_id) {
    let q = getSupabase().from('learnings').select('script_line, dr_function, rejection_reason, editor_note').order('created_at', { ascending: false }).limit(30)
    if (product_id) q = q.eq('product_id', product_id)
    else if (brand_id) q = q.eq('brand_id', brand_id)
    const { data: learnings } = await q
    if (learnings && learnings.length > 0) {
      learningsContext = `\n\nPAST EDITOR FEEDBACK — Learn from these rejections:\n${learnings.map(l => `- "${l.script_line}" (${l.dr_function}) REJECTED: ${l.rejection_reason}${l.editor_note ? ` (${l.editor_note})` : ''}`).join('\n')}\n\nAvoid these mistakes.`
    }
  }

  // ====== PHASE 1: SPLIT SCRIPT (small prompt, fast) ======
  const productHeader = productName ? `\n\nPRODUCT: ${productName}\n(All script lines are for this product. When a line mentions a noun, interpret it in the product's context, not literally.)` : ''

  const splitPrompt = `You are a direct-response video ad editor splitting a German script into B-roll segments.${productHeader}

SPLITTING RULES — BE AGGRESSIVE:
- Each segment = ONE visual scene. B-rolls are SHORT (2-4 seconds on screen).
- If a sentence has 3 different visuals, make 3 segments. Lists of symptoms/details = MULTIPLE segments.
- Em-dashes, commas introducing new imagery, semicolons = strong split signals.
- A 5-word clause with its own clear visual is enough for a segment.
- Only merge tiny connective fragments ("und dann", "im Monat") without standalone visual.
- Default bias: WHEN IN DOUBT, SPLIT.

EXAMPLE — aggressive split:
Script: "Letzte Woche kam ein achtjähriger Hund in meine Praxis – widerliche Zähne, braune Beläge überall, und ein Atem, der den Untersuchungsraum leer gefegt hatte."
Split (4 segments):
1. "Letzte Woche kam ein achtjähriger Hund in meine Praxis" → vet practice, older dog
2. "widerliche Zähne" → close-up dog mouth
3. "braune Beläge überall" → extreme close-up tartar
4. "und ein Atem, der den Untersuchungsraum leer gefegt hatte" → reaction to bad breath

${productPrompt ? 'PRODUCT-SPECIFIC EXAMPLES + HINTS:\n' + productPrompt : ''}

SCRIPT:
${script}

For each segment, return:
- line_number (1-indexed)
- text (exact script text)
- text_en (natural English translation for Filipino editors)
- dr_function (HOOK|PROBLEM|MECHANISM|PRODUCT|OUTCOME|SOCIAL_PROOF|CTA|LIFESTYLE)
- search_tags (array of 2-4 visual keywords like "dog teeth close-up", "vet practice")

Return JSON: {"lines": [{"line_number": 1, "text": "...", "text_en": "...", "dr_function": "HOOK", "search_tags": ["tag1","tag2"]}, ...]}${learningsContext}`

  // Splitting gets a small thinking budget for nuance
  const splitResp = await callLLM(splitPrompt, 8000, 512)
  const segments = extractSegments(splitResp.content)
  if (!segments.length) {
    return NextResponse.json({
      error: 'Split failed — Gemini returned unparseable output',
      debug: splitResp.debug,
      raw: splitResp.content.slice(0, 600) || '(empty)'
    }, { status: 500 })
  }

  // ====== PHASE 2: MATCH CLIPS PER SEGMENT (parallel) ======
  // Gemini 2.5 Flash has 1M context — send full shuffled catalog, let the model pick best
  const shuffledAll = [...allClips]
  for (let i = shuffledAll.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffledAll[i], shuffledAll[j]] = [shuffledAll[j], shuffledAll[i]]
  }
  const fullCatalog = shuffledAll.map(c => ({
    id: c.id,
    desc: c.description?.substring(0, 200),
    dr: c.dr_function,
    tags: (c.tags || []).slice(0, 7).join(', '),
    mood: c.mood,
    setting: c.setting,
    person: c.has_person,
    product: c.has_product,
  }))
  const fullCatalogJson = JSON.stringify(fullCatalog)

  const matchPromises = segments.map(async (seg, idx) => {
    const prev = segments[idx - 1]
    const next = segments[idx + 1]
    const neighbors = [
      prev ? `PREVIOUS LINE: "${prev.text}"` : '',
      next ? `NEXT LINE: "${next.text}"` : '',
    ].filter(Boolean).join('\n')

    const prompt = `You are a UGC direct-response video ad editor picking B-roll clips for ONE script segment.${productHeader}

TARGET SEGMENT (line ${seg.line_number}):
"${seg.text}"
DR function: ${seg.dr_function}
Visual tags: ${seg.search_tags.join(', ')}

${neighbors ? `CONTEXT:\n${neighbors}\n` : ''}
MATCHING RULES:
- Match on VISUAL MEANING. Read the context — a noun often means something different in this product's context than literally.
- Think: what would a video editor CUT TO here? The product in action, the metaphor, not the literal noun.
- Pick 5 distinct clips — variety is important. Avoid near-duplicates.
- NEVER match just because a clip shares a DR function.

UGC STYLE — CRITICAL:
- Must look like real person filmed on phone. Real homes, casual, natural lighting.
- NEVER studios, TV shows, news broadcasts, stages, game shows, studio audiences.

${productPrompt ? 'PRODUCT-SPECIFIC MATCHING HINTS:\n' + productPrompt + '\n' : ''}
CLIP LIBRARY (${fullCatalog.length} clips):
${fullCatalogJson}

Return JSON: {"matched_clip_ids": [id1, id2, id3, id4, id5]}${learningsContext}`

    // Matching with no thinking — fast parallel picks from pre-filtered shortlist
    const { content, debug } = await callLLM(prompt, 2000, 0)
    const ids = extractMatchedIds(content)
    if (ids.length === 0) {
      console.error(`Match failed seg ${seg.line_number}: debug=${debug}, raw=${content.slice(0, 200)}`)
    }
    return { seg, ids: ids.slice(0, 5) }
  })

  const matchResults = await Promise.all(matchPromises)

  // Build response
  const clipMap = new Map(allClips.map(c => [c.id, c]))
  const output = matchResults.map(({ seg, ids }) => {
    const matches = ids
      .map((id: number, i: number) => {
        const clip = clipMap.get(id)
        if (!clip) return null
        return { ...clip, match_score: 10 - i * 2 }
      })
      .filter(Boolean)

    return {
      line_number: seg.line_number,
      text: seg.text,
      text_en: seg.text_en || '',
      dr_function: seg.dr_function,
      search_tags: seg.search_tags || [],
      matches,
    }
  })

  return NextResponse.json({ lines: output })
}
