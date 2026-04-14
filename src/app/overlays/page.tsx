'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { renderOverlay } from '@/lib/overlay-renderer'

type Turn = { role: 'user' | 'assistant'; content: string }

export default function OverlaysPage() {
  const [prompt, setPrompt] = useState('')
  const [history, setHistory] = useState<Turn[]>([])
  const [currentHtml, setCurrentHtml] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isRendering, setIsRendering] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  const [previewFrame, setPreviewFrame] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [durationSeconds, setDurationSeconds] = useState(6)
  const [error, setError] = useState<string>('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Real-time preview playback
  useEffect(() => {
    if (!currentHtml || !isPlaying || isRendering) return
    let raf = 0
    let start = 0
    const totalFrames = Math.round(durationSeconds * 30)
    const tick = (now: number) => {
      if (!start) start = now
      const elapsed = (now - start) / 1000
      const frame = Math.round(elapsed * 30) % totalFrames
      setPreviewFrame(frame)
      const win = iframeRef.current?.contentWindow as (Window & { seekTo?: (f: number, fps: number) => void }) | null
      win?.seekTo?.(frame, 30)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, isRendering, currentHtml, durationSeconds])

  useEffect(() => {
    if (isPlaying || !currentHtml) return
    const win = iframeRef.current?.contentWindow as (Window & { seekTo?: (f: number, fps: number) => void }) | null
    win?.seekTo?.(previewFrame, 30)
  }, [previewFrame, isPlaying, currentHtml])

  async function handleGenerate() {
    if (!prompt.trim() || isGenerating) return
    setIsGenerating(true)
    setError('')
    try {
      const resp = await fetch('/api/generate-overlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, history }),
      })
      const text = await resp.text()
      let data: { html?: string; error?: string; detail?: string } = {}
      try { data = JSON.parse(text) } catch {
        throw new Error(`Server returned ${resp.status}: ${text.slice(0, 200)}`)
      }
      if (!resp.ok || !data.html) throw new Error((data.error || 'Generate failed') + (data.detail ? ` — ${data.detail}` : ''))
      const html = data.html
      setCurrentHtml(html)
      setHistory(h => [...h, { role: 'user', content: prompt }, { role: 'assistant', content: html }])
      setPrompt('')
      setDurationSeconds(guessDurationFromHtml(html))
      setIsPlaying(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleRender() {
    if (!iframeRef.current || !currentHtml) return
    setIsRendering(true)
    setIsPlaying(false)
    setProgress({ done: 0, total: Math.round(durationSeconds * 30) })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const blob = await renderOverlay({
        iframe: iframeRef.current,
        fps: 30,
        durationSeconds,
        width: 1920,
        height: 1080,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `overlay_${Date.now()}.webm`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError('Render fehlgeschlagen: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsRendering(false)
      setProgress(null)
      setIsPlaying(true)
      abortRef.current = null
    }
  }

  function reset() {
    setHistory([])
    setCurrentHtml('')
    setPrompt('')
    setError('')
  }

  const userTurns = history.filter(t => t.role === 'user')

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center gap-10">
          <Link href="/" className="font-semibold text-[15px] tracking-tight text-gray-900">B-Roll Engine</Link>
          <div className="flex items-center gap-1">
            <Link href="/clips" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50">Upload</Link>
            <Link href="/brands" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50">Brands</Link>
            <Link href="/projects" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50">Projects</Link>
            <Link href="/overlays" className="px-4 py-2 text-[13px] text-gray-900 rounded-lg bg-gray-100">Overlays</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-10">
        <div className="mb-8">
          <h1 className="text-[32px] font-bold tracking-tight mb-2">Overlay-Generator</h1>
          <p className="text-[15px] text-gray-500 max-w-2xl">Beschreibe in normalem Deutsch, welches Overlay du haben willst. Die KI generiert die Animation. Download als Chroma-Green WebM — in Premiere mit Ultra Key den grünen Hintergrund ausschlüsseln.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-8">
          {/* Left: prompt chat */}
          <div className="space-y-4">
            {userTurns.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wider">Verlauf</label>
                  <button onClick={reset} className="text-[12px] text-gray-500 hover:text-gray-900">Neu starten</button>
                </div>
                {userTurns.map((t, i) => (
                  <div key={i} className="text-[13px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <div className="text-[11px] text-gray-400 mb-0.5">#{i + 1}</div>
                    {t.content}
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-[12px] font-medium text-gray-500 uppercase tracking-wider mb-2">
                {userTurns.length === 0 ? 'Beschreibe dein Overlay' : 'Anpassung'}
              </label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate()
                }}
                placeholder={
                  userTurns.length === 0
                    ? 'z.B. "Ein Lower-Third unten links, mit einer großen Zahl 94% in grün, daneben der Text \'der Tierärzte empfehlen das\' und darunter kleiner \'Quelle: Bundesverband 2025\'. Soll schnell und modern wirken."'
                    : 'z.B. "Mach die Zahl größer", "Zentriere das Ganze", "Animiere die Zahl langsamer"'
                }
                rows={userTurns.length === 0 ? 8 : 4}
                disabled={isGenerating}
                className="w-full px-3 py-3 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 resize-none font-[inherit] leading-relaxed"
              />
              <div className="flex items-center justify-between mt-2">
                <div className="text-[11px] text-gray-400">⌘ + Enter zum Senden</div>
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || isGenerating}
                  className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? 'Generiere…' : userTurns.length === 0 ? 'Erstellen' : 'Anpassen'}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}

            {currentHtml && (
              <div className="border-t border-gray-200 pt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-[12px] text-gray-500">Dauer (Sek.)</label>
                  <input
                    type="number"
                    min={1} max={20} step={0.5}
                    value={durationSeconds}
                    onChange={e => setDurationSeconds(parseFloat(e.target.value) || 6)}
                    className="w-20 px-2 py-1 text-[13px] border border-gray-300 rounded-md"
                  />
                </div>
                <button
                  onClick={handleRender}
                  disabled={isRendering}
                  className="w-full px-4 py-3 bg-indigo-600 text-white text-[14px] font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRendering
                    ? `Rendere… ${progress ? `${progress.done}/${progress.total}` : ''}`
                    : 'Render & Download WebM'}
                </button>
                {isRendering && (
                  <button onClick={() => abortRef.current?.abort()} className="w-full px-4 py-2 text-[13px] text-gray-600 hover:text-gray-900">Abbrechen</button>
                )}
                {isRendering && progress && (
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: preview */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wider">Vorschau (1920×1080)</label>
              {currentHtml && (
                <button
                  onClick={() => setIsPlaying(p => !p)}
                  disabled={isRendering}
                  className="text-[13px] text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
              )}
            </div>
            <PreviewFrame html={currentHtml} iframeRef={iframeRef} />
            {currentHtml && !isPlaying && (
              <div className="mt-4">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, Math.round(durationSeconds * 30) - 1)}
                  value={previewFrame}
                  onChange={e => setPreviewFrame(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="text-[12px] text-gray-500 mt-1">Frame {previewFrame} / {Math.round(durationSeconds * 30) - 1}</div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function PreviewFrame({ html, iframeRef }: { html: string; iframeRef: React.RefObject<HTMLIFrameElement | null> }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    if (!wrapperRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setScale(e.contentRect.width / 1920)
    })
    ro.observe(wrapperRef.current)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={wrapperRef} className="relative bg-black rounded-xl overflow-hidden flex items-center justify-center" style={{ aspectRatio: '16 / 9' }}>
      {html ? (
        <iframe
          ref={iframeRef}
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin"
          className="border-0"
          style={{
            width: '1920px',
            height: '1080px',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0, left: 0,
          }}
        />
      ) : (
        <div className="text-center text-gray-500 p-8">
          <div className="text-[14px]">Noch kein Overlay generiert.</div>
          <div className="text-[12px] mt-1">Beschreibe links was du haben willst und klicke &quot;Erstellen&quot;.</div>
        </div>
      )}
    </div>
  )
}

function guessDurationFromHtml(html: string): number {
  // Try to find "const total = X.X" or "total = X" in the generated script
  const match = html.match(/total\s*=\s*([0-9.]+)/)
  if (match) {
    const v = parseFloat(match[1])
    if (v > 0 && v < 30) return v
  }
  return 6
}
