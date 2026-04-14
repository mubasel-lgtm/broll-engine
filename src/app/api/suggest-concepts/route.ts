import { NextRequest, NextResponse } from 'next/server'

const GEMINI_KEY = process.env.GEMINI_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

export async function POST(req: NextRequest) {
  const { script_line, dr_function, full_script, product_name, speaker_description, has_aroll } = await req.json()

  if (!script_line) {
    return NextResponse.json({ error: 'Missing script_line' }, { status: 400 })
  }

  const productBlock = product_name
    ? `PRODUCT: ${product_name}\nEvery concept MUST fit this product's world. If it's about dogs → scenes with dogs. If about teeth → scenes with a mouth/smile. Resolve pronouns in the full script into this product's domain.\n\n`
    : ''
  const scriptBlock = full_script
    ? `FULL AD SCRIPT (use for context — pronouns, implied subjects, metaphors):\n"""\n${full_script}\n"""\n\n`
    : ''
  const speakerBlock = has_aroll
    ? `SPEAKER: The ad has a real person on-camera (the main speaker / testimonial narrator). An A-Roll reference photo of them will be used when generating the final image — the same person will appear in the B-Roll unless the line is purely about an object, mechanism, or close-up detail.${speaker_description ? `\nSpeaker description: ${speaker_description}` : ''}\n\n`
    : ''

  // DR-function guidance for whether the speaker should be in frame
  const personGuidance: Record<string, string> = {
    HOOK: 'Most HOOK lines benefit from the SPEAKER in frame — they grab attention through expression.',
    PROBLEM: 'Usually show the SPEAKER experiencing or reacting to the problem, OR the problem itself (smell, mess, pain).',
    MECHANISM: 'Usually abstract/scientific visuals or the PRODUCT close-up — speaker not always needed.',
    PRODUCT: 'Product close-ups, speaker holding or using the product.',
    OUTCOME: 'SPEAKER visibly relieved/happy after the change — person in frame almost always.',
    SOCIAL_PROOF: 'SPEAKER in candid conversation, showing someone, natural interaction.',
    CTA: 'Product shot, SPEAKER looking confident and satisfied.',
    LIFESTYLE: 'SPEAKER in daily-life moment — always person-centric.',
  }
  const guidance = personGuidance[dr_function] || ''

  const prompt = `You are a creative director for UGC direct-response video ads.

${productBlock}${scriptBlock}${speakerBlock}${guidance ? `DR-FUNCTION GUIDANCE (${dr_function}): ${guidance}\n\n` : ''}Suggest 4 different visual concepts for a B-roll image for THIS specific script line:
"${script_line}"

Rules:
- Each concept must be visually DIFFERENT from the others.
- All concepts must match the meaning of the script line in the context of the full script.
- DEFAULT TO PERSON-CENTRIC: for HOOK, PROBLEM, OUTCOME, SOCIAL_PROOF, LIFESTYLE — the main SPEAKER should be in at least 3 of the 4 concepts, doing something relevant (reacting, showing, holding, talking). Reserve fully-abstract "empty room" shots only for MECHANISM or pure environment lines.
- AVOID GENERIC STOCK-PHOTO TROPES: "sunlight streaming through window", "curtains swaying", "plush couch with folded blanket", "houseplant on counter" — these are lifeless stock clichés. Use real specific moments instead.
- UGC style: iPhone-filmed, casual, bright natural daylight, real German homes, amateur framing. Not cinematic.
- Describe the SCENE (what happens, who's there, what they do), not camera angles.
- Each concept should read like the first frame of a 3-second moment of action, not a posed photograph.
- Keep each concept under 30 words.

${product_name === 'ODRX V2' ? `ODRX V2 is a plug-in ionizer against cigarette smoke. "Frisch gerochen" = the speaker sniffs the air / breathes in with a smile / sits on couch with no more smoke haze, NOT a generic pretty room with curtains. Always tie the scene to the smoke→fresh contrast.\n\n` : ''}Return a JSON array of exactly 4 strings, each being one concept description.`

  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json' },
    }),
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
