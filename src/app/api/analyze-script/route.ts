import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const GEMINI_KEY = process.env.GEMINI_KEY!
const geminiUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`

async function callGemini(model: string, prompt: string, thinkingBudget: number, maxTokens = 16000): Promise<{ ok: boolean; content: string; status: number; error?: string }> {
  const resp = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget },
      },
    }),
  })
  const raw = await resp.text()
  if (!resp.ok) return { ok: false, content: '', status: resp.status, error: raw.slice(0, 400) }
  let data: { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } }
  try { data = JSON.parse(raw) } catch { return { ok: false, content: '', status: 502, error: `Non-JSON: ${raw.slice(0, 400)}` } }
  if (data.error) return { ok: false, content: '', status: 500, error: data.error.message }
  const parts = data.candidates?.[0]?.content?.parts || []
  return { ok: true, content: parts.map(p => p.text || '').join(''), status: 200 }
}

async function callGeminiWithFallback(prompt: string): Promise<{ content: string; modelUsed: string; attempts: string[] }> {
  const attempts: string[] = []

  // Try Pro up to 2x (demand spikes are usually brief)
  for (let i = 0; i < 2; i++) {
    const r = await callGemini('gemini-2.5-pro', prompt, 4096)
    attempts.push(`pro-${i}: ${r.ok ? 'ok' : `${r.status} ${r.error?.slice(0, 60)}`}`)
    if (r.ok) return { content: r.content, modelUsed: 'gemini-2.5-pro', attempts }
    if (r.status !== 503 && r.status !== 429) break
    await new Promise(res => setTimeout(res, 1500))
  }

  // Fallback to Flash with higher thinking budget
  const flash = await callGemini('gemini-2.5-flash', prompt, 2048)
  attempts.push(`flash: ${flash.ok ? 'ok' : `${flash.status} ${flash.error?.slice(0, 60)}`}`)
  if (flash.ok) return { content: flash.content, modelUsed: 'gemini-2.5-flash', attempts }

  throw new Error(`All Gemini models failed. Attempts: ${attempts.join(' | ')}`)
}

export const maxDuration = 300

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

type OutLine = {
  line_number: number
  text: string
  text_en: string
  dr_function: string
  search_tags: string[]
  matched_clip_ids: number[]
}

function extractLines(raw: string): OutLine[] {
  if (!raw) return []
  const tryParse = (s: string): OutLine[] => {
    try {
      const parsed = JSON.parse(s)
      const arr = Array.isArray(parsed) ? parsed : (parsed.lines || parsed.segments || parsed.data || [])
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }
  let out = tryParse(raw.trim())
  if (out.length) return out
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) { out = tryParse(fence[1]); if (out.length) return out }
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
  if (s >= 0 && e > s) { out = tryParse(raw.slice(s, e + 1)); if (out.length) return out }
  return []
}

export async function POST(req: NextRequest) {
  const { script, product_id, brand_id } = await req.json()

  const [brandRes, productRes] = await Promise.all([
    brand_id
      ? getSupabase().from('brands').select('name').eq('id', brand_id).single()
      : Promise.resolve({ data: null as { name: string } | null }),
    product_id
      ? getSupabase().from('products').select('name, matching_prompt').eq('id', product_id).single()
      : Promise.resolve({ data: null as { name: string; matching_prompt: string } | null }),
  ])
  const brandName = brandRes.data?.name || ''
  const productName = productRes.data?.name || ''
  const productPrompt = productRes.data?.matching_prompt || ''

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

  let learningsContext = ''
  if (product_id || brand_id) {
    let q = getSupabase().from('learnings').select('script_line, dr_function, rejection_reason, editor_note').order('created_at', { ascending: false }).limit(30)
    if (product_id) q = q.eq('product_id', product_id)
    else if (brand_id) q = q.eq('brand_id', brand_id)
    const { data: learnings } = await q
    if (learnings && learnings.length > 0) {
      learningsContext = `\n\nPAST EDITOR FEEDBACK — avoid these mistakes:\n${learnings.map(l => `- "${l.script_line}" (${l.dr_function}) REJECTED: ${l.rejection_reason}${l.editor_note ? ` (${l.editor_note})` : ''}`).join('\n')}`
    }
  }

  // Shuffle catalog to avoid position bias
  const shuffled = [...allClips]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const catalog = shuffled.map(c => ({
    id: c.id,
    desc: c.description?.substring(0, 200),
    dr: c.dr_function,
    tags: (c.tags || []).slice(0, 7).join(', '),
    mood: c.mood,
    setting: c.setting,
    person: c.has_person,
    product: c.has_product,
  }))

  const productHeader = productName
    ? `\nPRODUCT: ${productName}\nEvery line is part of an ad for this product. Resolve pronouns and nouns in this context — if the product is about dogs, "sie konnte nicht mehr laufen" means the DOG couldn't walk.\n`
    : ''

  const prompt = `You are a direct-response UGC video ad editor splitting a German script into B-roll segments and picking 5 matching clips for each from a library.
${productHeader}
SPLITTING — be aggressive but not mechanical:
- Each segment = ONE visual scene (2-4 seconds on screen).
- Split when the imagery changes: new subject, new action, new symptom in a list, new setting.
- Em-dashes, semicolons, commas introducing new imagery are strong split signals.
- A 5+ word clause with its own clear visual is its own segment.
- Merge tiny connective fragments that have no standalone visual ("und dann", "im Monat").
- Default: when unsure, SPLIT.

EXAMPLE — aggressive split across a descriptive sentence:
"Letzte Woche kam ein achtjähriger Hund in meine Praxis – widerliche Zähne, braune Beläge überall, und ein Atem, der den Raum leer gefegt hatte." → 4 segments:
1. "Letzte Woche kam ein achtjähriger Hund in meine Praxis" → vet practice, older dog
2. "widerliche Zähne" → close-up dog mouth
3. "braune Beläge überall" → extreme close-up tartar
4. "und ein Atem, der den Raum leer gefegt hatte" → reaction to bad breath

MATCHING — pick the TOP 5 clip IDs per segment from the library:
- Match on VISUAL MEANING, not keyword overlap. Use the FULL SCRIPT to understand what this line is really about — the product in action, the metaphor, not the literal noun.
- For each segment: 5 DISTINCT clips, variety is critical, avoid near-duplicates.
- CROSS-SEGMENT DIVERSITY: spread the library across segments. The same "good" clip should not appear in every segment. If you notice you're reusing the same 3-5 clips everywhere, force yourself to find alternatives from deeper in the catalog.
- If the script says "sie probieren Febreze" and there's a clip of someone spraying Febreze, USE IT — specific visual matches are always better than generic "spraying" stand-ins.
- NEVER pick a clip just because it shares a DR function with the segment.

UGC STYLE — CRITICAL:
- UGC testimonial ad — must look like a real person filmed on a phone.
- Never studios, TV shows, news broadcasts, stages, game shows, studio audiences, professional lighting.
- Prefer real homes, kitchens, living rooms, casual natural lighting, one or two normal people.
- A clip with the right emotion in the wrong setting (studio, stage) is WORSE than a clip with a less perfect emotion in an authentic home setting.

${productPrompt ? `PRODUCT-SPECIFIC EXAMPLES & MATCHING HINTS:\n${productPrompt}\n` : ''}
SCRIPT:
"""
${script}
"""

CLIP LIBRARY (${catalog.length} clips, all videos, no images, shuffled):
${JSON.stringify(catalog)}

Return JSON with a "lines" array. Each element:
{"line_number": 1, "text": "exact script text", "text_en": "natural English translation for Filipino editors", "dr_function": "HOOK|PROBLEM|MECHANISM|PRODUCT|OUTCOME|SOCIAL_PROOF|CTA|LIFESTYLE", "search_tags": ["tag1","tag2"], "matched_clip_ids": [id, id, id, id, id]}

Format: {"lines": [...]}${learningsContext}`

  let content: string, modelUsed: string, attempts: string[]
  try {
    const r = await callGeminiWithFallback(prompt)
    content = r.content
    modelUsed = r.modelUsed
    attempts = r.attempts
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Gemini failed',
    }, { status: 503 })
  }

  const lines = extractLines(content)
  if (!lines.length) {
    return NextResponse.json({
      error: 'Gemini returned unparseable output',
      debug: `model=${modelUsed}, attempts=${attempts.join('|')}, len=${content.length}`,
      raw: content.slice(0, 600) || '(empty)',
    }, { status: 500 })
  }

  const clipMap = new Map(allClips.map(c => [c.id, c]))
  const output = lines.map(line => {
    const matches = (line.matched_clip_ids || [])
      .map(Number)
      .filter((n: number) => Number.isFinite(n))
      .slice(0, 5)
      .map((id: number, i: number) => {
        const clip = clipMap.get(id)
        if (!clip) return null
        return { ...clip, match_score: 10 - i * 2 }
      })
      .filter(Boolean)

    return {
      line_number: line.line_number,
      text: line.text,
      text_en: line.text_en || '',
      dr_function: line.dr_function,
      search_tags: line.search_tags || [],
      matches,
    }
  })

  return NextResponse.json({ lines: output })
}
