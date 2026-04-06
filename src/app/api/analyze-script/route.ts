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

  // Step 1: Get only VIDEO clips from DB (no images/icons)
  const { data: allClips } = await getSupabase()
    .from('clips')
    .select('id, filename, description, dr_function, tags, mood, setting, has_product, has_person, person_gender, thumbnail_url, drive_url, reusability, camera_movement, filetype')
    .eq('filetype', 'video')

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
  const prompt = `You are a direct-response video ad editor cutting B-roll for a German ad. You have a script and a library of B-roll clips.

YOUR JOB: Split the script into B-roll segments. Each segment = ONE distinct visual scene that a video editor would cut to.

SPLITTING RULES:
- Each segment should show ONE clear visual scene (typically 5-15 words)
- Split when the VISUAL SCENE changes (different location, action, person, or object)
- Keep together words that describe the SAME visual moment
- Short fragments like "und gewartet" or "im Monat" are NOT their own segment — merge them with the previous or next segment
- A complete thought that describes one scene = one segment

EXAMPLE — correct splitting:
Script: "Das Gerät kam drei Tage nachdem ich es bestellt habe an, ich hab es an die Steckdose angeschlossen, und dann einfach wie immer weitergeraucht und gewartet."
Split:
1. "Das Gerät kam drei Tage nachdem ich es bestellt habe an" → package arriving, delivery
2. "ich hab es an die Steckdose angeschlossen" → plugging device into outlet
3. "und dann einfach wie immer weitergeraucht und gewartet" → person smoking on couch, waiting

WRONG — too granular:
- "und gewartet" as its own segment ← WRONG, not a standalone visual
- "im Monat" as its own segment ← WRONG, belongs with the price

WRONG — too long:
- "Das Gerät kam an, ich hab es an die Steckdose angeschlossen, und dann weitergeraucht" ← WRONG, three different visuals

MORE CORRECT EXAMPLES:
- "und ich hab schon gedacht dass das genauso endet wie alles andere was ich vorher probiert hatte" → ONE segment (one emotion: disappointment about past failures)
- "für unter einem Euro Strom im Monat" → ONE segment (cost/value visual)
- "Die binden sich an Geruchspartikel und neutralisieren sie" → ONE segment (same scientific animation)
- "Meine Freundin hat mich gefragt wann ich eigentlich aufgehört habe" → ONE segment (one conversation)
- "als eine Freundin zu Besuch kam die weiß dass ich rauche" → ONE segment (friend arriving)

For EACH segment, pick the TOP 5 best matching clips from the library by their ID.

MATCHING RULES:
- Match based on VISUAL MEANING, not just keywords
- "Bei Galileo gesehen" = someone watching TV, a TV show, a screen
- "Zigarettengeruch" = cigarette smoke, smoky room, ashtray
- "steckst das einmal ein" = plugging in device, product close-up
- "klick auf den Link" = CTA, product shot
- NEVER match a clip just because it shares a DR function — the VISUAL CONTENT must match

SCRIPT:
${script}

CLIP LIBRARY (${clipCatalog.length} clips — all are videos, no images):
${JSON.stringify(clipCatalog)}

Return JSON array. For each segment:
{"line_number": 1, "text": "exact script text for this segment", "dr_function": "HOOK|PROBLEM|MECHANISM|PRODUCT|OUTCOME|SOCIAL_PROOF|CTA|LIFESTYLE", "search_tags": ["relevant", "visual", "tags"], "matched_clip_ids": [id1, id2, id3, id4, id5]}

Split by visual scene changes. One scene = one segment. Not too fine, not too coarse.${learningsContext}`

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
