'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TEMPLATES, type OverlayTemplate } from '@/lib/overlay-templates'
import { renderOverlay } from '@/lib/overlay-renderer'

export default function OverlaysPage() {
  const [templateId, setTemplateId] = useState<string>(TEMPLATES[0].id)
  const template = useMemo<OverlayTemplate>(() => TEMPLATES.find(t => t.id === templateId)!, [templateId])
  const [values, setValues] = useState<Record<string, string>>(() => buildDefaults(template))
  const [previewTime, setPreviewTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [isRendering, setIsRendering] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Reset values when template changes
  useEffect(() => {
    setValues(buildDefaults(template))
    setPreviewTime(0)
  }, [template])

  // Push params into iframe whenever values change
  useEffect(() => {
    const win = iframeRef.current?.contentWindow as (Window & { setParams?: (p: Record<string, unknown>) => void }) | null
    if (win?.setParams) {
      win.setParams(coerceValues(template, values))
    }
  }, [values, template])

  // Real-time preview playback
  useEffect(() => {
    if (!isPlaying || isRendering) return
    let raf = 0
    let start = 0
    const tick = (now: number) => {
      if (!start) start = now
      const elapsed = (now - start) / 1000
      const frame = Math.round(elapsed * 30) % Math.round(template.durationSeconds * 30)
      setPreviewTime(frame)
      const win = iframeRef.current?.contentWindow as (Window & { seekTo?: (f: number, fps: number) => void }) | null
      win?.seekTo?.(frame, 30)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, isRendering, template])

  // Apply previewTime when not playing (scrubbing)
  useEffect(() => {
    if (isPlaying) return
    const win = iframeRef.current?.contentWindow as (Window & { seekTo?: (f: number, fps: number) => void }) | null
    win?.seekTo?.(previewTime, 30)
  }, [previewTime, isPlaying])

  async function handleRender() {
    if (!iframeRef.current) return
    setIsRendering(true)
    setIsPlaying(false)
    setProgress({ done: 0, total: Math.round(template.durationSeconds * 30) })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const blob = await renderOverlay({
        iframe: iframeRef.current,
        fps: 30,
        durationSeconds: template.durationSeconds,
        width: 1920,
        height: 1080,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${template.id}_${Date.now()}.webm`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('Render fehlgeschlagen: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsRendering(false)
      setProgress(null)
      setIsPlaying(true)
      abortRef.current = null
    }
  }

  function cancelRender() {
    abortRef.current?.abort()
  }

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
          <h1 className="text-[32px] font-bold tracking-tight mb-2">Overlay-Animationen</h1>
          <p className="text-[15px] text-gray-500">Statistiken, Zitate und Text-Callouts als Chroma-Green WebM. In Premiere den grünen Hintergrund ausschlüsseln.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8">
          {/* Left: form */}
          <div className="space-y-6">
            <div>
              <label className="block text-[12px] font-medium text-gray-500 uppercase tracking-wider mb-3">Template</label>
              <div className="space-y-2">
                {TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTemplateId(t.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      templateId === t.id
                        ? 'border-indigo-500 bg-indigo-50/50 shadow-sm'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="font-semibold text-[14px] text-gray-900">{t.name}</div>
                    <div className="text-[12px] text-gray-500 mt-1 leading-relaxed">{t.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <label className="block text-[12px] font-medium text-gray-500 uppercase tracking-wider mb-3">Inhalt</label>
              <div className="space-y-4">
                {template.fields.map(f => (
                  <div key={f.key}>
                    <label className="block text-[13px] font-medium text-gray-700 mb-1.5">{f.label}</label>
                    {f.type === 'textarea' ? (
                      <textarea
                        value={values[f.key] ?? ''}
                        onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      />
                    ) : (
                      <input
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={values[f.key] ?? ''}
                        onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                        className="w-full px-3 py-2 text-[14px] border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <button
                onClick={handleRender}
                disabled={isRendering}
                className="w-full px-4 py-3 bg-gray-900 text-white text-[14px] font-semibold rounded-xl hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRendering ? `Rendere… ${progress ? `${progress.done}/${progress.total}` : ''}` : 'Render & Download WebM'}
              </button>
              {isRendering && (
                <button
                  onClick={cancelRender}
                  className="w-full mt-2 px-4 py-2 text-[13px] text-gray-600 hover:text-gray-900"
                >Abbrechen</button>
              )}
              {isRendering && progress && (
                <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              )}
              <p className="text-[12px] text-gray-500 mt-3 leading-relaxed">
                Rendering dauert je nach Template ~15-40 Sekunden. Der grüne Hintergrund ist Chroma-Key — in Premiere mit Ultra Key ausschlüsseln.
              </p>
            </div>
          </div>

          {/* Right: preview */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wider">Vorschau (1920×1080)</label>
              <button
                onClick={() => setIsPlaying(p => !p)}
                disabled={isRendering}
                className="text-[13px] text-indigo-600 hover:text-indigo-700 font-medium"
              >
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
            </div>
            <PreviewFrame template={template} iframeRef={iframeRef} />
            {!isPlaying && (
              <div className="mt-4">
                <input
                  type="range"
                  min={0}
                  max={Math.round(template.durationSeconds * 30) - 1}
                  value={previewTime}
                  onChange={e => setPreviewTime(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="text-[12px] text-gray-500 mt-1">Frame {previewTime} / {Math.round(template.durationSeconds * 30) - 1}</div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function PreviewFrame({ template, iframeRef }: { template: OverlayTemplate; iframeRef: React.RefObject<HTMLIFrameElement | null> }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    if (!wrapperRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setScale(e.contentRect.width / 1920)
      }
    })
    ro.observe(wrapperRef.current)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={wrapperRef} className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
      <iframe
        ref={iframeRef}
        src={template.file}
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
    </div>
  )
}

function buildDefaults(template: OverlayTemplate): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of template.fields) out[f.key] = String(f.default)
  return out
}

function coerceValues(template: OverlayTemplate, values: Record<string, string>): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const f of template.fields) {
    const v = values[f.key]
    if (f.type === 'number') out[f.key] = parseFloat(v) || 0
    else out[f.key] = v
  }
  return out
}
