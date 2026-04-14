import { toCanvas } from 'html-to-image'

export type RenderOptions = {
  iframe: HTMLIFrameElement
  fps: number
  durationSeconds: number
  width: number
  height: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

export async function renderOverlay(opts: RenderOptions): Promise<Blob> {
  const { iframe, fps, durationSeconds, width, height, onProgress, signal } = opts
  const totalFrames = Math.round(fps * durationSeconds)

  const doc = iframe.contentDocument
  const win = iframe.contentWindow as (Window & { seekTo?: (f: number, fps: number) => void }) | null
  if (!doc || !win || typeof win.seekTo !== 'function') {
    throw new Error('Template iframe not ready or missing seekTo()')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack

  const mime = pickMimeType()
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data) }

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start()

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new Error('aborted')
      win.seekTo(i, fps)
      await waitFrame(doc)
      const frameCanvas = await toCanvas(doc.body, {
        width, height,
        canvasWidth: width, canvasHeight: height,
        pixelRatio: 1,
        skipFonts: false,
      })
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(frameCanvas, 0, 0, width, height)
      track.requestFrame()
      onProgress?.(i + 1, totalFrames)
    }
  } finally {
    if (recorder.state !== 'inactive') recorder.stop()
    track.stop()
  }

  await done
  return new Blob(chunks, { type: mime })
}

function pickMimeType(): string {
  const options = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const m of options) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return 'video/webm'
}

function waitFrame(doc: Document): Promise<void> {
  const win = doc.defaultView!
  return new Promise(resolve => {
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()))
  })
}
