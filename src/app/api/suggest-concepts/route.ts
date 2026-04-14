import { NextRequest, NextResponse } from 'next/server'

const GEMINI_KEY = process.env.GEMINI_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

export async function POST(req: NextRequest) {
  const { script_line, dr_function, full_script, product_name } = await req.json()

  if (!script_line) {
    return NextResponse.json({ error: 'Missing script_line' }, { status: 400 })
  }

  const contextBlock = `${product_name ? `PRODUCT: ${product_name}\nEVERY concept MUST fit this product's world. If the product is about dogs, scenes involve dogs; if about teeth, scenes involve teeth. Never generate a generic human scene when the product's subject is animals or something specific.\n\n` : ''}${full_script ? `FULL AD SCRIPT (for context — understand what "it", "they", "laufen", "geben" refer to):\n"""\n${full_script}\n"""\n\n` : ''}`

  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `You are a creative director for UGC direct-response video ads.

${contextBlock}Now suggest 4 different visual concepts for a B-roll image for THIS specific script line:
"${script_line}"
DR function: ${dr_function}

Rules:
- Each concept must be visually DIFFERENT from the others
- All concepts must match the meaning of the script line IN THE CONTEXT OF THE FULL SCRIPT ABOVE
- If the script is about a dog, the subject of the scene is a DOG (not a person) unless the line is explicitly about a person
- UGC style: casual, iPhone-quality, bright natural daylight, real homes
- Describe the SCENE, not camera angles or technical terms
- Think about what would look good as a 3-second video clip
- Keep each concept under 30 words

Return a JSON array of exactly 4 strings, each being one concept description.` }] }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json' }
    })
  })

  const data = await resp.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]'

  try {
    const concepts = JSON.parse(text)
    return NextResponse.json({ concepts })
  } catch {
    return NextResponse.json({ concepts: [] })
  }
}
