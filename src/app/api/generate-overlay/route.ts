import { NextRequest, NextResponse } from 'next/server'

const GEMINI_KEY = process.env.GEMINI_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`

export const maxDuration = 60

const SYSTEM_PROMPT = `You are an expert motion designer and frontend engineer. Your job is to generate a complete, self-contained HTML file that renders an animated video overlay based on the user's description.

HARD REQUIREMENTS — the output MUST follow these exactly:

1. OUTPUT FORMAT
   - Return ONLY the raw HTML source. No markdown, no code fences, no commentary, no explanations.
   - Start with <!DOCTYPE html> and end with </html>.
   - Single self-contained file: all CSS in <style>, all JS in <script>. No external resources.

2. CANVAS & BACKGROUND
   - Document dimensions: exactly 1920x1080 pixels.
   - Body background MUST be the chroma-key green #00b140. This will be keyed out in Premiere.
   - html/body must be 1920x1080, overflow hidden, margin 0, padding 0.

3. DETERMINISTIC ANIMATION — THIS IS CRITICAL
   - Define a GLOBAL function: window.seekTo(frame, fps)
   - This function must be 100% pure: given the same frame and fps, it produces identical visual state every time.
   - DO NOT use: requestAnimationFrame, setTimeout, setInterval, Date.now(), performance.now(), or CSS @keyframes animations for anything that must be recorded.
   - All animation state (opacities, transforms, counter values, text slices) must be CALCULATED from the frame index alone.
   - Call window.seekTo(0, 30) once at the bottom of the script so the initial state is correct.

4. DURATION
   - Pick a total duration that fits the content (typically 4-8 seconds).
   - Animation should loop cleanly: include enter (slide/fade in), hold (content visible), exit (slide/fade out).
   - Use modulo so seekTo works beyond the total duration.

5. TYPOGRAPHY
   - Use: font-family: -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", sans-serif;
   - Enable: -webkit-font-smoothing: antialiased;
   - White or near-white text on top of a dark semi-transparent element when overlaid on green.
   - If you show raw text on green, wrap it in a dark element (rgba(0,0,0,0.8+), rounded) so green won't bleed through antialiased edges.

6. POSITIONING
   - Default: bottom-left lower-third (left: 80px, bottom: 100px), unless user asks otherwise.
   - Respect the user's position if they specify one (top, center, right, etc.).

7. ANIMATION PRINCIPLES
   - Use easing: easeOutCubic = t => 1 - Math.pow(1 - t, 3)
   - Stagger elements for visual rhythm (e.g., word-by-word reveal, numbers count up).
   - Respect the feel requested: punchy, elegant, urgent, calm, etc.
   - For counters: animate from 0 to target with easeOutCubic over ~1.2s.
   - For word reveals: 40-60ms stagger with 300-500ms per-word fade+slide.

8. CLEAN DESIGN
   - Modern, editorial. Dark rounded bars/pills/cards for text. Subtle shadows.
   - Accent colors can be used (green gradient, white shimmer, thin colored bars).
   - Do not use emoji, stock icons, or placeholder images unless user asks.

EXAMPLE OUTPUT (reference, do not copy verbatim — adapt to user request):

<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Overlay</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1920px; height: 1080px; overflow: hidden;
    background: #00b140;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { position: fixed; left: 80px; bottom: 100px; }
  .bar { display: flex; background: rgba(0,0,0,0.82); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.25); transform: translateY(40px); opacity: 0; }
  .box { width: 200px; padding: 28px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #1D9E75, #0F6E56); }
  .num { font-size: 64px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
  .text { padding: 28px 32px; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
  .line1 { font-size: 22px; font-weight: 500; color: #fff; opacity: 0; transform: translateX(-12px); }
  .line2 { font-size: 15px; color: rgba(255,255,255,0.5); opacity: 0; transform: translateX(-12px); }
</style>
</head>
<body>
<div class="wrap">
  <div class="bar" id="bar">
    <div class="box"><div class="num" id="num">0%</div></div>
    <div class="text"><div class="line1" id="line1">der Tierärzte empfehlen</div><div class="line2" id="line2">Quelle: Bundesverband 2025</div></div>
  </div>
</div>
<script>
  const ease = t => 1 - Math.pow(1 - t, 3);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TARGET = 94;
  window.seekTo = function(frame, fps) {
    const total = 6.0;
    const t = (frame / fps) % total;
    let bT = 40, bO = 0;
    if (t < 0.5) { const p = clamp(t/0.5,0,1); bT = lerp(40,0,ease(p)); bO = ease(p); }
    else if (t < 4.5) { bT = 0; bO = 1; }
    else if (t < 5.1) { const p = clamp((t-4.5)/0.6,0,1); bT = lerp(0,40,p); bO = 1-p; }
    const bar = document.getElementById('bar');
    bar.style.transform = 'translateY(' + bT + 'px)';
    bar.style.opacity = bO;
    const cp = clamp((t - 0.2)/1.3, 0, 1);
    document.getElementById('num').textContent = Math.round(TARGET * ease(cp)) + '%';
    for (const [id, start] of [['line1', 0.5], ['line2', 0.8]]) {
      const p = clamp((t - start)/0.4, 0, 1);
      const e = ease(p);
      const el = document.getElementById(id);
      el.style.opacity = id === 'line2' ? e * 0.5 : e;
      el.style.transform = 'translateX(' + lerp(-12, 0, e) + 'px)';
    }
  };
  window.seekTo(0, 30);
</script>
</body>
</html>

Now generate the HTML for the user's request below. Return ONLY the HTML.`

export async function POST(req: NextRequest) {
  const { prompt, history } = await req.json()
  if (!prompt) {
    return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })
  }

  if (!GEMINI_KEY) {
    return NextResponse.json({ error: 'GEMINI_KEY env var is not set in Vercel' }, { status: 500 })
  }

  const userTurn = buildUserTurn(prompt, history)
  const fullPrompt = SYSTEM_PROMPT + '\n\n===\n\n' + userTurn

  try {
    const resp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 32768,
        },
      }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      return NextResponse.json({ error: 'Gemini returned ' + resp.status, detail: text.slice(0, 500) }, { status: 500 })
    }

    const data = await resp.json()
    const raw = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || ''
    const html = extractHtml(raw)

    if (!html) {
      return NextResponse.json({ error: 'No HTML in response', raw: raw.slice(0, 500), finishReason: data.candidates?.[0]?.finishReason }, { status: 500 })
    }

    return NextResponse.json({ html })
  } catch (err) {
    return NextResponse.json({ error: 'Request failed', detail: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

type HistoryTurn = { role: 'user' | 'assistant'; content: string }

function buildUserTurn(prompt: string, history?: HistoryTurn[]): string {
  if (!history || history.length === 0) {
    return `USER REQUEST:\n${prompt}\n\nReturn only the HTML.`
  }
  const priorHtml = history.filter(t => t.role === 'assistant').at(-1)?.content || ''
  const priorUser = history.filter(t => t.role === 'user').at(-1)?.content || ''
  return `PRIOR USER REQUEST:\n${priorUser}\n\nPRIOR HTML OUTPUT:\n${priorHtml.slice(0, 6000)}${priorHtml.length > 6000 ? '\n...(truncated)' : ''}\n\nNEW REFINEMENT FROM USER:\n${prompt}\n\nGenerate an UPDATED HTML that applies the refinement while keeping everything else that worked. Return only the HTML.`
}

function extractHtml(raw: string): string {
  const trimmed = raw.trim()
  // Strip markdown fences if present
  const fenceMatch = trimmed.match(/```(?:html)?\s*([\s\S]*?)```/)
  const body = fenceMatch ? fenceMatch[1] : trimmed
  const start = body.toLowerCase().indexOf('<!doctype')
  if (start < 0) return ''
  return body.slice(start).trim()
}
