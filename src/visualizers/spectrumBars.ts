/**
 * Spectrum bars visualizer (MiniMeters-style bar analyzer).
 */

import type { BandReaction, Ctx2D, FrameContext, Layer, LayerSpecBase, RectSpec } from '@/render'
import { barEdges, smoothedBars } from './spectrumMath'

export interface SpectrumBarsSpec extends LayerSpecBase {
  type: 'spectrum-bars'
  rect: RectSpec
  barCount: number
  /** Gap between bars as a fraction of the bar slot, 0..0.9. */
  gap: number
  minHz: number
  maxHz: number
  /** Gradient stops from the base of a bar to its tip (one color = solid). */
  colors: string[]
  /** Corner radius as a fraction of bar width, 0..0.5. */
  radius: number
  /** 'bottom' = bars grow up from the rect bottom; 'center' = grow both ways from the middle. */
  anchor: 'bottom' | 'center'
  /** Minimum bar height as a fraction of the rect height. */
  minHeight: number
  /** Exponent applied to values 0..1 (>1 = calmer quiet parts, punchier peaks). */
  gamma: number
  /** Meter release time, seconds. */
  releaseSec: number
  /** Pulse: scales the whole visualizer around its anchor by 1 + amount * band. */
  pulse: BandReaction | null
  /** Mirrored reflection under the bars (anchor 'bottom' only), alpha 0..1; 0 = off. */
  reflection: number
}

export const SPECTRUM_BARS_DEFAULTS: Omit<SpectrumBarsSpec, 'id' | 'type'> = {
  rect: { x: 0, y: 0.55, w: 1, h: 0.25, space: 'bleed' },
  barCount: 48,
  gap: 0.3,
  minHz: 30,
  maxHz: 16000,
  colors: ['#4f46e5', '#22d3ee', '#f0abfc'],
  radius: 0.5,
  anchor: 'bottom',
  minHeight: 0.015,
  gamma: 1.2,
  releaseSec: 0.18,
  pulse: { band: 'low', amount: 0.12 },
  reflection: 0.25,
}

export class SpectrumBarsLayer implements Layer {
  readonly id: string
  private readonly spec: SpectrumBarsSpec
  private edges: Float32Array | null = null
  private edgesKey = ''
  private readonly values: Float32Array
  private readonly scratch = { row: new Float32Array(0), bars: new Float32Array(0) }

  constructor(spec: SpectrumBarsSpec) {
    this.id = spec.id
    this.spec = spec
    this.values = new Float32Array(Math.max(1, Math.floor(spec.barCount)))
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const features = f.timeline.audio.features
    const grid = features.spectrum
    const n = this.values.length

    const key = `${grid.binCount}|${grid.minHz}|${grid.maxHz}`
    if (!this.edges || this.edgesKey !== key) {
      this.edges = barEdges(grid, n, s.minHz, s.maxHz)
      this.edgesKey = key
    }
    smoothedBars(
      f.featurePos,
      this.edges,
      grid.binCount,
      { rate: features.rate, releaseSec: s.releaseSec },
      f.spectrumAt,
      this.values,
      this.scratch,
    )

    const r = f.rect(s.rect)
    const slot = r.w / n
    const barW = slot * (1 - Math.min(Math.max(s.gap, 0), 0.9))
    const radius = Math.min(Math.max(s.radius, 0), 0.5) * barW
    const centered = s.anchor === 'center'
    const baseY = centered ? r.y + r.h / 2 : r.y + r.h
    const maxH = centered ? r.h / 2 : r.h
    const minH = s.minHeight * r.h

    if (s.pulse && s.pulse.amount !== 0) {
      const scale = 1 + s.pulse.amount * f.band(s.pulse.band)
      const cx = r.x + r.w / 2
      g.translate(cx, baseY)
      g.scale(scale, scale)
      g.translate(-cx, -baseY)
    }

    g.fillStyle = this.gradient(g, baseY, centered ? baseY - maxH : r.y, centered)
    const trace = () => {
      g.beginPath()
      for (let k = 0; k < n; k++) {
        const v = Math.pow(Math.min(Math.max(this.values[k] ?? 0, 0), 1), s.gamma)
        const h = Math.max(v * maxH, minH)
        const x = r.x + k * slot + (slot - barW) / 2
        if (centered) addBar(g, x, baseY - h, barW, 2 * h, radius)
        else addBar(g, x, baseY - h, barW, h, radius)
      }
    }
    trace()
    g.fill()

    if (!centered && s.reflection > 0) {
      // Path points are transformed when added, so the mirrored copy is traced again.
      g.globalAlpha *= Math.min(s.reflection, 1)
      g.translate(0, 2 * baseY)
      g.scale(1, -1)
      trace()
      g.fill()
    }
  }

  private gradient(g: Ctx2D, y0: number, y1: number, centered: boolean): CanvasGradient | string {
    const colors = this.spec.colors
    if (colors.length <= 1) return colors[0] ?? '#ffffff'
    // Centered bars: tip colors on both ends, base color in the middle.
    const grad = centered
      ? g.createLinearGradient(0, y1, 0, 2 * y0 - y1)
      : g.createLinearGradient(0, y0, 0, y1)
    const last = colors.length - 1
    colors.forEach((c, i) => {
      if (centered) {
        grad.addColorStop(0.5 - (0.5 * i) / last, c)
        grad.addColorStop(0.5 + (0.5 * i) / last, c)
      } else {
        grad.addColorStop(i / last, c)
      }
    })
    return grad
  }
}

function addBar(g: Ctx2D, x: number, y: number, w: number, h: number, radius: number): void {
  if (radius > 0) g.roundRect(x, y, w, h, Math.min(radius, h / 2))
  else g.rect(x, y, w, h)
}
