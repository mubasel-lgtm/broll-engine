import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() { return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)}

const MOONSHOT_KEY = process.env.MOONSHOT_KEY!
const MOONSHOT_URL = 'https://api.moonshot.ai/v1/chat/completions'

export const maxDuration = 300

async function callKimi(prompt: string, maxTokens = 8192): Promise<{ content: string; debug: string }> {
  const resp = await fetch(MOONSHOT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MOONSHOT_KEY}`,
    },
    body: JSON.stringify({
      model: 'kimi-k2-turbo-preview',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    })
  })
  const text = await resp.text()
  if (!resp.ok) {
    return { content: '', debug: `HTTP ${resp.status}: ${text.slice(0, 400)}` }
  }
  let data: { choices?: { message?: { content?: string }; finish_reason?: string }[]; error?: { message?: string } }
  try { data = JSON.parse(text) } catch {
    return { content: '', debug: `Non-JSON response: ${text.slice(0, 400)}` }
  }
  if (data.error) return { content: '', debug: `API error: ${data.error.message || JSON.stringify(data.error)}` }
  const content = data.choices?.[0]?.message?.content || ''
  const finish = data.choices?.[0]?.finish_reason || 'unknown'
  return { content, debug: `finish_reason=${finish}, content_len=${content.length}` }
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

const STOPWORDS = new Set([
  'der','die','das','den','dem','des','ein','eine','einer','einem','einen','eines',
  'und','oder','aber','weil','dass','ist','sind','war','waren','war','hab','habe','hat','haben','hatte','hatten',
  'ich','du','er','sie','es','wir','ihr','mich','mir','dich','dir','ihn','ihm','ihnen','uns','euch',
  'mein','dein','sein','ihr','unser','euer','nicht','kein','keine','auch','nur','sehr','schon','noch','mal','so',
  'the','a','an','and','or','but','is','are','was','were','of','to','in','on','at','for','with','by','from',
  'i','you','he','she','it','we','they','me','him','her','us','them',
  'über','unter','vor','nach','bei','mit','zu','aus','für','auf','an','ab','als','am','im','um','von','zum','zur',
])

function extractTerms(text: string): Set<string> {
  const terms = new Set<string>()
  const words = text.toLowerCase().replace(/[^a-zäöüß0-9\s-]/g, ' ').split(/\s+/)
  for (const w of words) {
    if (w.length >= 3 && !STOPWORDS.has(w)) terms.add(w)
  }
  return terms
}

function scoreClip(clip: ClipRow, terms: Set<string>, drFunction: string): number {
  let score = 0
  const clipText = [
    clip.description || '',
    (clip.tags || []).join(' '),
    clip.mood || '',
    clip.setting || '',
    clip.filename || '',
  ].join(' ').toLowerCase()
  for (const term of terms) {
    if (clipText.includes(term)) score += 2
    // Partial match (substring root) counts half
    else if (term.length >= 5 && clipText.includes(term.slice(0, -1))) score += 1
  }
  // DR-function alignment bonus (soft — still include even if mismatch)
  if (clip.dr_function && drFunction && clip.dr_function.toUpperCase() === drFunction.toUpperCase()) score += 1
  // Slight random tiebreaker for diversity when many clips tie
  score += Math.random() * 0.5
  return score
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

  const splitResp = await callKimi(splitPrompt, 8000)
  const segments = extractSegments(splitResp.content)
  if (!segments.length) {
    return NextResponse.json({
      error: 'Split failed — Kimi returned unparseable output',
      debug: splitResp.debug,
      raw: splitResp.content.slice(0, 600) || '(empty)'
    }, { status: 500 })
  }

  // ====== PHASE 2: MATCH CLIPS PER SEGMENT (parallel) ======
  // Pre-filter clips per segment via cheap text scoring, send only top-50 to Kimi
  const PREFILTER_SIZE = 50

  const matchPromises = segments.map(async (seg, idx) => {
    const prev = segments[idx - 1]
    const next = segments[idx + 1]
    const neighbors = [
      prev ? `PREVIOUS LINE: "${prev.text}"` : '',
      next ? `NEXT LINE: "${next.text}"` : '',
    ].filter(Boolean).join('\n')

    // Score clips by term overlap with segment text + tags
    const terms = extractTerms(seg.text + ' ' + seg.search_tags.join(' ') + ' ' + (seg.text_en || ''))
    const scored = allClips.map(c => ({ clip: c, score: scoreClip(c, terms, seg.dr_function) }))
    scored.sort((a, b) => b.score - a.score)
    const shortlist = scored.slice(0, PREFILTER_SIZE).map(s => s.clip)
    // Shuffle shortlist to reduce position bias in Kimi's picks
    for (let i = shortlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shortlist[i], shortlist[j]] = [shortlist[j], shortlist[i]]
    }
    const catalog = shortlist.map(c => ({
      id: c.id,
      desc: c.description?.substring(0, 200),
      dr: c.dr_function,
      tags: (c.tags || []).slice(0, 7).join(', '),
      mood: c.mood,
      setting: c.setting,
      person: c.has_person,
      product: c.has_product,
    }))

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
SHORTLISTED CLIPS (${catalog.length} candidates pre-filtered for relevance):
${JSON.stringify(catalog)}

Return JSON: {"matched_clip_ids": [id1, id2, id3, id4, id5]}${learningsContext}`

    try {
      const { content } = await callKimi(prompt, 1000)
      const parsed = JSON.parse(content)
      const ids = parsed.matched_clip_ids || parsed.ids || []
      return { seg, ids: Array.isArray(ids) ? ids.slice(0, 5) : [] }
    } catch (err) {
      console.error(`Match failed for segment ${seg.line_number}:`, err)
      return { seg, ids: [] }
    }
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
