import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createRenderer } from '../adapters'
import { t } from '../i18n'
import { playback } from '../playback'
import { useAppStore } from '../store'
import { useThrottled } from '../useThrottled'
import { TrackDropzone } from './TrackDropzone'

/**
 * Preview canvas. The frame keeps the output aspect ratio and fits the available area;
 * the canvas backing store matches the on-screen size (×DPR), capped at the output size.
 * Frames are driven by the playback clock, not by React.
 */
export function Preview() {
  const hasTrack = useAppStore((state) => state.track !== null)
  const output = useAppStore((state) => state.output)
  const ratio = output.width / output.height

  return (
    <div className="relative min-h-0 flex-1 p-6 [container-type:size]">
      {hasTrack ? (
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="relative overflow-hidden rounded-md bg-black shadow-[0_0_0_1px_var(--color-line),0_20px_60px_-20px_oklch(0_0_0/0.8)]"
            style={{ aspectRatio: `${ratio}`, width: `min(100cqw, 100cqh * ${ratio})` }}
          >
            <PreviewCanvas />
            <span className="tabular pointer-events-none absolute top-2 left-2 rounded-sm bg-black/55 px-1.5 py-0.5 font-mono text-2xs text-muted backdrop-blur-sm">
              {output.aspect} · {output.width}×{output.height} · {output.fps} fps
            </span>
          </div>
        </div>
      ) : (
        <TrackDropzone className="h-full w-full" />
      )}
    </div>
  )
}

function PreviewCanvas() {
  const timeline = useAppStore((state) => state.timeline)
  const status = useAppStore((state) => state.analysis.status)
  const { width, height, fps } = useAppStore((state) => state.output)
  // Dragging a style slider changes the scene many times a second; rebuilding the renderer for each is too heavy.
  const scene = useThrottled(useAppStore((state) => state.scene))
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !timeline) return
    const renderer = createRenderer()
    let ready = false
    let disposed = false

    const backingSize = () => {
      const rect = canvas.getBoundingClientRect()
      const scale = Math.min(1, (rect.width * devicePixelRatio) / width)
      return { w: Math.max(1, width * scale), h: Math.max(1, height * scale) }
    }
    const draw = (time = playback.time) => {
      if (ready) void renderer.renderFrame(Math.floor(time * fps))
    }

    const observer = new ResizeObserver(() => {
      if (!ready) return
      const { w, h } = backingSize()
      renderer.resize(w, h)
      draw()
    })
    observer.observe(canvas)

    const { w, h } = backingSize()
    let unsubscribe = () => {}
    void renderer.init({ canvas, width: w, height: h, fps, timeline, scene }).then(() => {
      if (disposed) return
      ready = true
      unsubscribe = playback.subscribe(draw)
    })

    return () => {
      disposed = true
      observer.disconnect()
      unsubscribe()
      renderer.dispose()
    }
  }, [timeline, scene, width, height, fps])

  return (
    <>
      {/* Keyed so a renderer that needs a different context type always gets a fresh canvas. */}
      <canvas
        key={`${width}x${height}@${fps}`}
        ref={canvasRef}
        className="block h-full w-full"
        aria-label={t.preview.canvas}
      />
      {!timeline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-muted">
          {status === 'error' ? (
            <span className="text-danger">{t.analysis.error}</span>
          ) : (
            <>
              <LoaderCircle aria-hidden className="size-5 animate-spin text-subtle" />
              {t.analysis[status]}
            </>
          )}
        </div>
      )}
    </>
  )
}
