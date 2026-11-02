/**
 * Spectrum as a line or filled "mountains" (MiniMeters-style), optional frequency grid with labels.
 */

import type { BandReaction, Ctx2D, FrameContext, Layer, LayerSpecBase, RectSpec } from '@/render'
import { drawGrid, formatHz, hzToX, MONO_STACK, setLabelFont, verticalGradient } from './common'
import { barEdges, smoothedBars } from './spectrumMath'

export interface SpectrumCurveSpec extends LayerSpecBase {
  type: 'spectrum-curve'
  rect: RectSpec
  style: 'line' | 'mountain'
  /** Number of points along the curve. */
  points: number
  minHz: number
  maxHz: number
  lineColor: string
  /** Line width in units (fraction of the shorter frame side). */
  lineWidth: number
  /** Fill gradient for 'mountain', base → top. */
  fillColors: string[]
  fillOpacity: number
  /** Mirror around the rect's horizontal center (symmetric "mountains"). */
  mirror: boolean
  gamma: number
  releaseSec: number
  pulse: BandReaction | null
  grid: boolean
  gridColor: string
  labels: boolean
  labelColor: string
  fontFamily: string
}

export const SPECTRUM_CURVE_DEFAULTS: Omit<SpectrumCurveSpec, 'id' | 'type'> = {
  rect: { x: 0, y: 0.55, w: 1, h: 0.25 },
  style: 'mountain',
  points: 96,
  minHz: 30,
  maxHz: 16000,
  lineColor: '#e0f2fe',
  lineWidth: 0.004,
  fillColors: ['#1d4ed8', '#22d3ee'],
  fillOpacity: 0.55,
  mirror: false,
  gamma: 1.1,
  releaseSec: 0.2,
  pulse: null,
  grid: false,
  gridColor: 'rgba(255,255,255,0.12)',
  labels: false,
  labelColor: 'rgba(255,255,255,0.55)',
  fontFamily: MONO_STACK,
}

const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000]

export class SpectrumCurveLayer implements Layer {
  readonly id: string
  private readonly spec: SpectrumCurveSpec
  private edges: Float32Array | null = null
  private edgesKey = ''
  private readonly values: Float32Array
  private readonly scratch = { row: new Float32Array(0), bars: new Float32Array(0) }

  constructor(spec: SpectrumCurveSpec) {
    this.id = spec.id
    this.spec = spec
    this.values = new Float32Array(Math.max(2, Math.floor(spec.points)))
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
    const unit = f.layout.unit
    if (s.grid) this.drawGrid(g, r, unit)

    const baseY = s.mirror ? r.y + r.h / 2 : r.y + r.h
    const maxH = s.mirror ? r.h / 2 : r.h
    if (s.pulse && s.pulse.amount !== 0) {
      const k = 1 + s.pulse.amount * f.band(s.pulse.band)
      g.translate(0, baseY)
      g.scale(1, k)
      g.translate(0, -baseY)
    }

    const xs = (k: number) => r.x + (r.w * k) / (n - 1)
    const ys = (k: number, dir: 1 | -1) => {
      const v = Math.pow(Math.min(Math.max(this.values[k] ?? 0, 0), 1), s.gamma)
      return baseY - dir * v * maxH
    }
    const trace = (dir: 1 | -1, moveFirst: boolean) => {
      // Quadratic curve through midpoints: smooth, passes near every point.
      if (moveFirst) g.moveTo(xs(0), ys(0, dir))
      else g.lineTo(xs(0), ys(0, dir))
      for (let k = 1; k < n - 1; k++) {
        const mx = (xs(k) + xs(k + 1)) / 2
        const my = (ys(k, dir) + ys(k + 1, dir)) / 2
        g.quadraticCurveTo(xs(k), ys(k, dir), mx, my)
      }
      g.lineTo(xs(n - 1), ys(n - 1, dir))
    }

    if (s.style === 'mountain') {
      g.beginPath()
      g.moveTo(r.x, baseY)
      trace(1, false)
      g.lineTo(r.x + r.w, baseY)
      if (s.mirror) {
        // Lower half: trace back right → left mirrored.
        for (let k = n - 1; k >= 0; k--) g.lineTo(xs(k), ys(k, -1))
      }
      g.closePath()
      const prev = g.globalAlpha
      g.globalAlpha = prev * Math.min(Math.max(s.fillOpacity, 0), 1)
      g.fillStyle = verticalGradient(g, baseY, baseY - maxH, s.fillColors)
      g.fill()
      g.globalAlpha = prev
    }

    g.strokeStyle = s.lineColor
    g.lineWidth = Math.max(s.lineWidth * unit, 1)
    g.lineJoin = 'round'
    g.lineCap = 'round'
    g.beginPath()
    trace(1, true)
    if (s.mirror) trace(-1, true)
    g.stroke()
  }

  private drawGrid(g: Ctx2D, r: { x: number; y: number; w: number; h: number }, unit: number) {
    const s = this.spec
    drawGrid(g, r, unit, { color: s.gridColor, lineWidth: 0.0015 }, 1, 4)
    g.save()
    g.strokeStyle = s.gridColor
    g.lineWidth = Math.max(0.0015 * unit, 1)
    g.beginPath()
    const visible = GRID_HZ.filter((hz) => hz > s.minHz && hz < s.maxHz)
    for (const hz of visible) {
      const x = hzToX(r, hz, s.minHz, s.maxHz)
      g.moveTo(x, r.y)
      g.lineTo(x, r.y + r.h)
    }
    g.stroke()
    if (s.labels) {
      setLabelFont(g, s.fontFamily, 0.022 * unit)
      g.fillStyle = s.labelColor
      g.textAlign = 'center'
      g.textBaseline = 'top'
      for (const hz of visible) {
        g.fillText(formatHz(hz), hzToX(r, hz, s.minHz, s.maxHz), r.y + r.h + 0.008 * unit)
      }
    }
    g.restore()
  }
}
