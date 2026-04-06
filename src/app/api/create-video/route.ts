import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const EVOLINK_KEY = process.env.EVOLINK_KEY!
const EVOLINK_URL = 'https://api.evolink.ai/v1/videos/generations'
const EVOLINK_POLL = 'https://api.evolink.ai/v1/tasks'

const GEMINI_KEY = process.env.GEMINI_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const { image_base64, script_line, dr_function } = await req.json()

  if (!image_base64) {
    return NextResponse.json({ error: 'Missing image' }, { status: 400 })
  }

  // Step 1: Upload frame to Supabase Storage to get a public URL (Evolink needs a URL)
  const filename = `frame_${Date.now()}.jpg`
  const buffer = Buffer.from(image_base64, 'base64')

  const { error: uploadError } = await getSupabase().storage
    .from('product-images')
    .upload(filename, buffer, { contentType: 'image/jpeg', upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const { data: urlData } = getSupabase().storage.from('product-images').getPublicUrl(filename)
  const imageUrl = urlData.publicUrl

  // Step 2: Generate motion prompt with Gemini
  const motionResp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `You are a video motion director. Write a motion prompt to bring this B-roll image to life as a 3-second video clip.

Script context: "${script_line}"
DR function: ${dr_function}

CRITICAL RULES:
- Do NOT just describe camera movement (no "slow zoom in" or "pan left")
- Describe what the PEOPLE and OBJECTS actually DO in the scene
- The motion must match the script context:
  - If two people are talking → they gesture, nod, one speaks while the other listens, natural conversation body language
  - If someone receives a package → they reach out, take it, look at it
  - If someone smokes → smoke rises, they bring cigarette to mouth or exhale
  - If someone is relaxing → subtle breathing, shifting position, looking around
  - If it shows a device → a light turns on, subtle glow pulsing
- Think like a film director: what HAPPENS in these 3 seconds?
- 2-3 sentences max
- Include both subject motion AND camera (slight) if appropriate
- Specify the end state

Return ONLY the motion prompt text.` }] }],
      generationConfig: { temperature: 0.2 }
    })
  })
  const motionData = await motionResp.json()
  const motionPrompt = motionData.candidates?.[0]?.content?.parts?.[0]?.text || 'slow zoom in'

  // Step 3: Submit to Kling via Evolink
  const klingResp = await fetch(EVOLINK_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EVOLINK_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'kling-o3-image-to-video',
      image_url: imageUrl,
      prompt: motionPrompt,
      duration: 3,
      aspect_ratio: '9:16',
    })
  })

  const klingData = await klingResp.json()
  if (!klingData.id) {
    return NextResponse.json({ error: klingData.error?.message || 'Kling submission failed', details: klingData }, { status: 500 })
  }

  const taskId = klingData.id

  // Step 4: Poll for completion
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 10000))

    const pollResp = await fetch(`${EVOLINK_POLL}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${EVOLINK_KEY}` }
    })
    const pollData = await pollResp.json()
    const status = pollData.status

    if (status === 'completed') {
      // Find video URL in response
      const fullStr = JSON.stringify(pollData)
      const urlMatch = fullStr.match(/https?:\/\/[^\s"\\]+\.mp4[^\s"\\]*/)
      if (urlMatch) {
        // Cleanup temp file
        await getSupabase().storage.from('product-images').remove([filename])
        return NextResponse.json({ success: true, video_url: urlMatch[0], motion_prompt: motionPrompt })
      }
      return NextResponse.json({ error: 'No video URL in completed response' }, { status: 500 })
    }

    if (status === 'failed') {
      await getSupabase().storage.from('product-images').remove([filename])
      return NextResponse.json({ error: pollData.error?.message || 'Video generation failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Timeout waiting for video' }, { status: 504 })
}
