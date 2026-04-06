import { NextRequest, NextResponse } from 'next/server'

const GEMINI_KEY = process.env.GEMINI_KEY!
const NANO_URL = `https://generativelanguage.googleapis.com/v1beta/models/nano-banana-pro-preview:generateContent?key=${GEMINI_KEY}`
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

export async function POST(req: NextRequest) {
  const { script_line, dr_function, aroll_image, speaker_description, product_image, product_physical, rejection_feedback, previous_prompt, chat_history } = await req.json()
  // chat_history: Array of { prompt: string, rejection: string } from previous attempts

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
  // Only include speaker reference when the scene clearly shows a PERSON
  // NEVER for: MECHANISM, PRODUCT (product-only shots), pure nature/science scenes
  const mentionsPerson = /ich|mein|mir|Freundin|Besuch|gefragt|gelacht|gedacht|bemerkt/i.test(script_line)
  const personDrFunctions = ['SOCIAL_PROOF', 'HOOK']
  const needsSpeaker = hasAroll && mentionsPerson && (
    personDrFunctions.includes(dr_function) ||
    (dr_function === 'LIFESTYLE' && mentionsPerson) ||
    (dr_function === 'OUTCOME' && mentionsPerson) ||
    (dr_function === 'PROBLEM' && mentionsPerson)
  )

  // Detect multi-person scenes (friend visiting, conversation, etc.)
  const needsMultiplePeople = /Freundin|Besuch|gefragt|Freund|zusammen|gemeinsam/i.test(script_line)

  // Build reference instructions for prompt generation
  let refInstructions = ''
  if (needsSpeaker && needsProduct) {
    refInstructions = `Both speaker and product reference images will be provided.
- Do NOT describe the speaker's appearance — the reference image handles that.
- Do NOT describe the product's design — the reference image handles that.
- The product is: ${product_physical || 'a compact plug-in device'}
- Describe the SCENE, EMOTION, and the RELATIONSHIP between person and product.`
  } else if (needsSpeaker && needsMultiplePeople) {
    refInstructions = `A speaker reference image will be provided. This scene has MULTIPLE PEOPLE.
- The reference person is the MAIN speaker/protagonist — they MUST appear in the image looking like the reference.
- Add a SECOND person (friend/visitor) naturally in the scene — describe the second person's appearance, pose, and position.
- Do NOT describe the speaker's appearance — the reference image handles that.
- IMPORTANT: Both people must be clearly visible and interacting naturally.
- Describe the SCENE, EMOTION, INTERACTION between the two people, and ENVIRONMENT.`
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

  // Step 1: Generate prompt with Gemini (chat-style for iterations)
  const systemPrompt = `You are a B-roll image prompt engineer for direct-response ads.

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
- End with: "9:16 vertical aspect ratio (TikTok/Reels format). No text, no watermark, no extra people."

Return ONLY the prompt text.`

  // Build chat-style contents: system → previous attempts → current request
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

  if (chat_history?.length > 0 || previous_prompt) {
    // First turn: original request
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] })

    if (previous_prompt && !chat_history?.length) {
      // Simple case: one previous attempt
      contents.push({ role: 'model', parts: [{ text: previous_prompt }] })
      contents.push({ role: 'user', parts: [{ text: `The editor REJECTED the image generated from your prompt. Their feedback:\n${rejection_feedback}\n\nIMPORTANT:\n- Keep the same reference images (speaker/product) — do NOT change who appears\n- MODIFY the prompt based on the feedback — do NOT write from scratch\n- Address the specific issue the editor raised\n- Return ONLY the updated prompt text.` }] })
    } else if (chat_history?.length > 0) {
      // Multiple iterations: full chat history
      for (const entry of chat_history) {
        contents.push({ role: 'model', parts: [{ text: entry.prompt }] })
        contents.push({ role: 'user', parts: [{ text: `REJECTED. Feedback: ${entry.rejection}\n\nModify the prompt to fix this issue. Keep reference images. Return ONLY the updated prompt.` }] })
      }
      // Current rejection
      if (rejection_feedback) {
        contents.push({ role: 'model', parts: [{ text: previous_prompt || chat_history[chat_history.length - 1].prompt }] })
        contents.push({ role: 'user', parts: [{ text: `REJECTED again. Feedback: ${rejection_feedback}\n\nModify the prompt to fix this. Keep the same person from reference image. Return ONLY the updated prompt.` }] })
      }
    }
  } else {
    // First generation: single turn
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] })
  }

  const promptResp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
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
