import { NextRequest, NextResponse } from 'next/server'

const GEMINI_KEY = process.env.GEMINI_KEY!
const NANO_URL = `https://generativelanguage.googleapis.com/v1beta/models/nano-banana-pro-preview:generateContent?key=${GEMINI_KEY}`
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

export async function POST(req: NextRequest) {
  const { script_line, dr_function, aroll_image, speaker_description, product_image, product_physical } = await req.json()

  if (!script_line) {
    return NextResponse.json({ error: 'Missing script_line' }, { status: 400 })
  }

  const hasAroll = !!aroll_image
  const hasProduct = !!product_image

  // Determine what references to use based on DR function and script content
  const mentionsProduct = /ODRx|Gerät|einsteck|Filter|Produkt|Link/i.test(script_line)
  const needsProduct = hasProduct && (
    dr_function === 'PRODUCT' ||
    dr_function === 'CTA' ||
    mentionsProduct
  )
  const needsSpeaker = hasAroll && (
    dr_function !== 'MECHANISM' ||
    /ich|mein|mir/i.test(script_line)
  )

  // Build reference instructions for prompt generation
  let refInstructions = ''
  if (needsSpeaker && needsProduct) {
    refInstructions = `Both speaker and product reference images will be provided.
- Do NOT describe the speaker's appearance — the reference image handles that.
- Do NOT describe the product's design — the reference image handles that.
- The product is: ${product_physical || 'a compact plug-in device'}
- Describe the SCENE, EMOTION, and the RELATIONSHIP between person and product.`
  } else if (needsSpeaker) {
    refInstructions = `A speaker reference image will be provided.
- Do NOT describe the speaker's appearance — the reference image handles that.
- Describe the SCENE, EMOTION, POSE, and ENVIRONMENT only.`
  } else if (needsProduct) {
    refInstructions = `A product reference image will be provided.
- Do NOT describe the product's design — the reference image handles that.
- The product is: ${product_physical || 'a compact plug-in device'}
- Describe WHERE the product is and HOW it's lit.`
  }

  const refPrefix = needsSpeaker && needsProduct
    ? 'Generate an image using both of these references. '
    : needsSpeaker
      ? 'Generate an image using this person as reference. '
      : needsProduct
        ? 'Generate an image using this product as reference. '
        : ''

  // DR-specific visual rules
  const drRules: Record<string, string> = {
    'HOOK': 'Hook shot: Create curiosity/intrigue. Bright, attention-grabbing. May or may not show product depending on script.',
    'PROBLEM': 'Problem shot: Show the problem visually. Bright natural lighting (NOT dark/moody). Frustrated/uncomfortable emotion. Show failed solutions if mentioned.',
    'MECHANISM': 'Mechanism shot: Scientific/educational visualization. Clean, conceptual. If about particles/ions: abstract scientific look. If about a natural analogy (rain, storm): show that nature scene.',
    'PRODUCT': 'Product shot: Show the product in real-life context. The product must be the HERO of the frame. If it\'s a plug-in device, show it plugged into a wall outlet. Bright, clean, positive.',
    'OUTCOME': 'Outcome shot: Show the positive result. Clean, bright, fresh environment. Person looks happy/relieved. The "after" state.',
    'SOCIAL_PROOF': 'Social proof shot: Show genuine reaction, surprise, conversation between people. Authentic, candid.',
    'CTA': 'CTA shot: This is the FINAL image before the viewer clicks. Show the PRODUCT beautifully — clean, bright, prominent. The person should look confident and satisfied. NEVER show the problem here — only the solution.',
    'LIFESTYLE': 'Lifestyle shot: Aspirational but authentic daily life scene. Bright, natural, casual.'
  }

  // Step 1: Generate prompt with Gemini
  const promptResp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `You are a B-roll image prompt engineer for direct-response ads.

Write a Nano Banana Pro image generation prompt for this script line:
"${script_line}"
DR Function: ${dr_function}

${drRules[dr_function] || ''}

${refInstructions}

Rules:
${refPrefix ? `- Start with: "${refPrefix}"` : ''}
- iPhone-quality casual photography, bright natural daylight, UGC amateur style
- NOT professionally lit, NOT cinematic, NOT dark or moody
- All people: white, German, appropriate age
- CRITICAL: The visual MUST match the MEANING of the script line
  - If it says "steckst das einmal ein" → show someone plugging the device into a wall outlet
  - If it says "klick auf den Link" → show the product beautifully, person looking satisfied, NOT smoking/sad
  - If it says "kein Filter wechseln" → show the device working effortlessly, forgotten in the background
- End with: "9:16 vertical aspect ratio (TikTok/Reels format). No text, no watermark, no extra people."

Return ONLY the prompt text.` }] }],
      generationConfig: { temperature: 0.2 }
    })
  })
  const promptData = await promptResp.json()
  const imagePrompt = promptData.candidates?.[0]?.content?.parts?.[0]?.text || ''

  if (!imagePrompt) {
    return NextResponse.json({ error: 'Failed to generate prompt' }, { status: 500 })
  }

  // Step 2: Build Nano Banana request with reference images
  const parts: Array<Record<string, unknown>> = []

  if (needsSpeaker) {
    parts.push({ inline_data: { mime_type: 'image/png', data: aroll_image } })
  }
  if (needsProduct) {
    parts.push({ inline_data: { mime_type: 'image/png', data: product_image } })
  }
  parts.push({ text: imagePrompt })

  const imgResp = await fetch(NANO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
    })
  })
  const imgData = await imgResp.json()

  const imagePart = imgData.candidates?.[0]?.content?.parts?.find(
    (p: Record<string, unknown>) => p.inlineData
  )

  if (!imagePart) {
    return NextResponse.json({ error: 'Failed to generate image', details: imgData.error?.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    image: {
      data: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
    },
    prompt_used: imagePrompt,
    used_aroll: needsSpeaker,
    used_product: needsProduct,
    script_line,
    dr_function
  })
}
