/**
 * Canvas 2D drawing of overlay items (flash, particles, full-screen word) in screen space,
 * on top of the scene layers and outside the camera transform.
 */

import type { Ctx2D } from '@/render'
import { rgba } from './math'
import {
  PARTICLE_STRIDE,
  type FlashOverlay,
  type OverlayItem,
  type ParticleOverlay,
  type WordOverlay,
} from './types'

/** Frame size in px; `unit` is the shorter side (`layout` from the frame context fits). */
export interface Viewport {
  width: number
  height: number
  unit: number
}

export interface OverlayOptions {
  /** CSS font-family for the full-screen word; the renderer passes a loaded embedded font. */
  fontFamily: string
  fontWeight: number
}

export const DEFAULT_OVERLAY_OPTIONS: OverlayOptions = {
  fontFamily: '"STV Unbounded", system-ui, sans-serif',
  fontWeight: 800,
}

/** Draws `items` in order. Leaves the context state as it found it. */
export function drawOverlays(
  g: Ctx2D,
  items: readonly OverlayItem[],
  vp: Viewport,
  options: OverlayOptions = DEFAULT_OVERLAY_OPTIONS,
): void {
  for (const item of items) {
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    switch (item.kind) {
      case 'flash':
        drawFlash(g, item, vp)
        break
      case 'particles':
        drawParticles(g, item, vp)
        break
      case 'word':
        drawWord(g, item, vp, options)
        break
    }
    g.restore()
  }
}

const FLASH_BLEND: Record<FlashOverlay['blend'], GlobalCompositeOperation> = {
  normal: 'source-over',
  screen: 'screen',
  add: 'lighter',
}

function drawFlash(g: Ctx2D, f: FlashOverlay, vp: Viewport): void {
  g.globalCompositeOperation = FLASH_BLEND[f.blend]
  g.fillStyle = rgba(f.color, f.alpha)
  g.fillRect(0, 0, vp.width, vp.height)
}

function drawParticles(g: Ctx2D, p: ParticleOverlay, vp: Viewport): void {
  const ox = p.originX * vp.width
  const oy = p.originY * vp.height
  const u = vp.unit
  if (p.glow) g.globalCompositeOperation = 'lighter'
  // Two passes (one per color) to keep fillStyle changes down.
  for (const [color, second] of [
    [p.color, false],
    [p.color2, true],
  ] as const) {
    g.fillStyle = color
    g.strokeStyle = color
    g.lineCap = 'round'
    for (let i = 0; i < p.count; i++) {
      const o = i * PARTICLE_STRIDE
      if ((p.data[o + 5] ?? 0) >= 0.5 !== second) continue
      const x = ox + (p.data[o] ?? 0) * u
      const y = oy + (p.data[o + 1] ?? 0) * u
      const size = (p.data[o + 2] ?? 0) * u
      g.globalAlpha = p.data[o + 3] ?? 0
      if (p.shape === 'spark') {
        const heading = p.data[o + 4] ?? 0
        const len = size * 5
        g.lineWidth = Math.max(size * 0.6, 1)
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x - Math.cos(heading) * len, y - Math.sin(heading) * len)
        g.stroke()
      } else if (p.shape === 'square') {
        g.fillRect(x - size / 2, y - size / 2, size, size)
      } else {
        g.beginPath()
        g.arc(x, y, size / 2, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
}

const REF_PX = 100

function drawWord(g: Ctx2D, w: WordOverlay, vp: Viewport, o: OverlayOptions): void {
  if (w.dim > 0) {
    g.fillStyle = `rgba(0,0,0,${Math.min(w.dim, 1).toFixed(4)})`
    g.fillRect(0, 0, vp.width, vp.height)
  }
  if (!w.text) return
  g.font = `${o.fontWeight} ${REF_PX}px ${o.fontFamily}`
  const m = g.measureText(w.text)
  const width = Math.max(m.width, 1)
  // Fit to the requested width, but never taller than ~a third of the frame.
  const px = Math.min((REF_PX * w.fill * vp.width) / width, vp.height * 0.32) * w.scale
  g.font = `${o.fontWeight} ${px}px ${o.fontFamily}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.globalAlpha = Math.min(w.alpha, 1)
  const x = vp.width / 2
  const y = vp.height * (0.5 + w.offsetY)
  if (w.outline) {
    g.lineWidth = Math.max(px * 0.035, 1.5)
    g.lineJoin = 'round'
    g.strokeStyle = w.color
    g.strokeText(w.text, x, y)
    g.globalAlpha *= 0.18
    g.fillStyle = w.color
    g.fillText(w.text, x, y)
  } else {
    g.fillStyle = w.color
    g.fillText(w.text, x, y)
  }
}
