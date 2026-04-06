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
  const prompt = `You are a direct-response video ad editor cutting B-roll for a German ad. You have a script and a library of B-roll clips.

YOUR #1 JOB: Split the script into VERY SHORT B-roll segments. Each segment = ONE single visual action or idea.

CRITICAL SPLITTING RULES:
- Each segment should be 3-8 words MAX — one visual moment per segment
- Every new ACTION, OBJECT, EMOTION, or SCENE CHANGE = a new segment
- NEVER combine multiple actions into one segment
- Think like a video editor: each cut needs its own B-roll clip

EXAMPLE of correct splitting:
Script: "Das Gerät kam drei Tage nachdem ich es bestellt habe an, ich hab es an die Steckdose angeschlossen, und dann einfach wie immer weitergeraucht und gewartet."
Split into:
1. "Das Gerät kam drei Tage nachdem ich es bestellt habe an" → package arriving, delivery
2. "ich hab es an die Steckdose angeschlossen" → plugging device into wall outlet
3. "und dann einfach wie immer weitergeraucht" → person smoking
4. "und gewartet" → person waiting, looking around

WRONG (too long, multiple actions combined):
1. "Das Gerät kam drei Tage nachdem ich es bestellt habe an, ich hab es an die Steckdose angeschlossen" ← WRONG! Two different visuals!

MORE EXAMPLES:
- "Meine Freundin hat mich gefragt ob ich aufgehört habe zu rauchen" → one segment (one conversation moment)
- "weil die Wohnung so frisch gerochen hat" → separate segment (different visual: fresh apartment)
- "Ich hab erstmal gelacht" → separate segment (reaction shot)

For EACH segment, pick the TOP 5 best matching clips from the library by their ID.

MATCHING RULES:
- Match based on VISUAL MEANING, not just keywords
- "Bei Galileo gesehen" = someone watching TV, a TV show, a screen
- "Zigarettengeruch" = cigarette smoke, smoky room, ashtray
- "Luftfilter zu Hause" = air purifier device, home appliance
- "steckst das einmal ein" = plugging in device, product close-up
- "klick auf den Link" = CTA, product shot, call to action
- NEVER match a clip just because it shares a DR function — the VISUAL CONTENT must match

SCRIPT:
${script}

CLIP LIBRARY (${clipCatalog.length} clips):
${JSON.stringify(clipCatalog)}

Return JSON array. For each segment:
{"line_number": 1, "text": "exact script text for this segment", "dr_function": "HOOK|PROBLEM|MECHANISM|PRODUCT|OUTCOME|SOCIAL_PROOF|CTA|LIFESTYLE", "search_tags": ["relevant", "visual", "tags"], "matched_clip_ids": [id1, id2, id3, id4, id5]}

REMEMBER: Split aggressively! One visual = one segment. If in doubt, split more.${learningsContext}`

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
