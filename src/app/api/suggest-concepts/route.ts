import { NextRequest, NextResponse } from 'next/server'

const GEMINI_KEY = process.env.GEMINI_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

export async function POST(req: NextRequest) {
  const { script_line, dr_function } = await req.json()

  if (!script_line) {
    return NextResponse.json({ error: 'Missing script_line' }, { status: 400 })
  }

  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `You are a creative director for UGC direct-response video ads.

For this script line, suggest 4 different visual concepts for a B-roll image.
Each concept should be a short description (1-2 sentences) of what the image should show.

Script line: "${script_line}"
DR function: ${dr_function}

Rules:
- Each concept must be visually DIFFERENT from the others
- All concepts must match the meaning of the script line
- UGC style: casual, iPhone-quality, bright natural daylight, real homes
- Describe the SCENE, not camera angles or technical terms
- Think about what would look good as a 3-second video clip
- Keep each concept under 30 words

Return a JSON array of exactly 4 strings, each being one concept description.
Example: ["A man opens his front door to receive a brown package from a delivery person", "Close-up of hands unwrapping a small white box on a kitchen table", "A package sits on a doorstep, a hand reaches down to pick it up", "A woman smiles as she holds a newly arrived package in her living room"]` }] }],
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
