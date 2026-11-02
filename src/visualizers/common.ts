/**
 * Shared helpers for visualizers: colors, grids, labels, level math, scope data.
 * No runtime imports from `@/render` (it imports this module) — types only.
 */

import type { Ctx2D, FrameContext, PixelRect } from '@/render'

/** Embedded monospace stack (see src/render/fonts). Kept as a literal to avoid a runtime import cycle. */
export const MONO_STACK = '"STV JetBrains Mono", monospace'

export interface ColorStopSpec {
  offset: number
  color: string
}

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa → [r, g, b, a] 0..255. Unknown → opaque white. */
export function parseHexColor(hex: string): [number, number, number, number] {
  const h = hex.trim().replace(/^#/, '')
  const full =
    h.length === 3 || h.length === 4
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) return [255, 255, 255, 255]
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), full.length === 8 ? n(6) : 255]
}

/** 256-entry RGBA lookup table from hex color stops (offsets 0..1, ascending). */
export function buildColorLut(stops: ColorStopSpec[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4)
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  const parsed = sorted.map((s) => ({ o: s.offset, c: parseHexColor(s.color) }))
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let a = parsed[0]
    let b = parsed[parsed.length - 1]
    for (let k = 0; k < parsed.length - 1; k++) {
      const p = parsed[k]
      const q = parsed[k + 1]
      if (p && q && x >= p.o && x <= q.o) {
        a = p
        b = q
        break
      }
    }
    if (!a || !b) continue
    const t = b.o > a.o ? Math.min(Math.max((x - a.o) / (b.o - a.o), 0), 1) : 0
    for (let c = 0; c < 4; c++) {
      lut[i * 4 + c] = (a.c[c] ?? 0) + ((b.c[c] ?? 0) - (a.c[c] ?? 0)) * t
    }
  }
  return lut
}

/** Linear amplitude → dBFS, floored at `floor`. */
export function linToDb(v: number, floor = -96): number {
  return v > 0 ? Math.max(20 * Math.log10(v), floor) : floor
}

/** dB → 0..1 position on a meter scale [minDb, 0]. */
export function dbToMeter(db: number, minDb: number): number {
  return Math.min(Math.max((db - minDb) / -minDb, 0), 1)
}

export function verticalGradient(
  g: Ctx2D,
  yBottom: number,
  yTop: number,
  colors: string[],
): CanvasGradient | string {
  if (colors.length <= 1) return colors[0] ?? '#ffffff'
  const grad = g.createLinearGradient(0, yBottom, 0, yTop)
  colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c))
  return grad
}

export interface GridStyle {
  color: string
  /** Line width in units (fraction of the shorter side). */
  lineWidth: number
}

/** Rectangle frame plus `cols` × `rows` inner divisions. */
export function drawGrid(
  g: Ctx2D,
  r: PixelRect,
  unit: number,
  style: GridStyle,
  cols: number,
  rows: number,
): void {
  g.save()
  g.strokeStyle = style.color
  g.lineWidth = Math.max(style.lineWidth * unit, 1)
  g.beginPath()
  g.rect(r.x, r.y, r.w, r.h)
  for (let i = 1; i < cols; i++) {
    const x = r.x + (r.w * i) / cols
    g.moveTo(x, r.y)
    g.lineTo(x, r.y + r.h)
  }
  for (let i = 1; i < rows; i++) {
    const y = r.y + (r.h * i) / rows
    g.moveTo(r.x, y)
    g.lineTo(r.x + r.w, y)
  }
  g.stroke()
  g.restore()
}

export function setLabelFont(g: Ctx2D, family: string, px: number, weight = 500): void {
  g.font = `${weight} ${Math.max(px, 1)}px ${family}`
}

/** Frequency label: 100, 1k, 10k. */
export function formatHz(hz: number): string {
  return hz >= 1000 ? `${+(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`
}

/** Log-frequency x position inside a rect spanning [minHz, maxHz]. */
export function hzToX(r: PixelRect, hz: number, minHz: number, maxHz: number): number {
  return r.x + (r.w * Math.log(hz / minHz)) / Math.log(maxHz / minHz)
}

/**
 * Waveform snapshot (left/right, -1..1) for the current frame from `features.scope`.
 * Fallback without scope: a deterministic synthetic wave from the band energies, so the
 * oscilloscope and goniometer still move with the music.
 */
export function scopeRow(f: FrameContext, outL: Float32Array, outR: Float32Array): void {
  const scope = f.timeline.audio.features.scope
  const n = outL.length
  if (scope && scope.pointsPerFrame > 0) {
    const frames = f.timeline.audio.features.frameCount
    const row = Math.min(Math.max(Math.round(f.featurePos), 0), frames - 1)
    const p = scope.pointsPerFrame
    for (let i = 0; i < n; i++) {
      const src = row * p + Math.min(Math.floor((i / n) * p), p - 1)
      outL[i] = scope.left[src] ?? 0
      outR[i] = scope.right[src] ?? 0
    }
    return
  }
  const low = f.band('low')
  const mid = f.band('mid')
  const high = f.band('high')
  const corr = f.sample(f.timeline.audio.features.stereo.correlation)
  const t = f.time
  for (let i = 0; i < n; i++) {
    const x = i / n
    const ts = t + x * 0.025
    const body =
      0.6 * low * Math.sin(2 * Math.PI * 55 * ts) + 0.3 * mid * Math.sin(2 * Math.PI * 440 * ts)
    const air = 0.15 * high * Math.sin(2 * Math.PI * 3100 * ts + 0.7)
    const side = (1 - corr) * 0.25 * mid * Math.sin(2 * Math.PI * 660 * ts + 1.3)
    outL[i] = body + air + side
    outR[i] = body - air * 0.5 - side
  }
}
