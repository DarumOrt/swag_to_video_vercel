/**
 * Oscilloscope and goniometer (vectorscope) from `features.scope`, with a synthetic fallback when
 * the analysis has no scope data (see `scopeRow`).
 */

import type { Ctx2D, FrameContext, Layer, LayerSpecBase, RectSpec } from '@/render'
import { drawGrid, MONO_STACK, scopeRow, setLabelFont } from './common'

const SCOPE_POINTS = 256

// ---------------------------------------------------------------------------
// Oscilloscope
// ---------------------------------------------------------------------------

export interface OscilloscopeSpec extends LayerSpecBase {
  type: 'oscilloscope'
  rect: RectSpec
  /** 'mid' = (L+R)/2, 'stereo' = L and R as two lines. */
  channel: 'mid' | 'stereo'
  color: string
  color2: string
  lineWidth: number
  gain: number
  grid: boolean
  gridColor: string
}

export const OSCILLOSCOPE_DEFAULTS: Omit<OscilloscopeSpec, 'id' | 'type'> = {
  rect: { x: 0, y: 0.6, w: 1, h: 0.18, space: 'bleed' },
  channel: 'mid',
  color: '#a7f3d0',
  color2: '#f9a8d4',
  lineWidth: 0.004,
  gain: 1.6,
  grid: false,
  gridColor: 'rgba(255,255,255,0.12)',
}

export class OscilloscopeLayer implements Layer {
  readonly id: string
  private readonly spec: OscilloscopeSpec
  private readonly left = new Float32Array(SCOPE_POINTS)
  private readonly right = new Float32Array(SCOPE_POINTS)

  constructor(spec: OscilloscopeSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const r = f.rect(s.rect)
    const unit = f.layout.unit
    if (s.grid) drawGrid(g, r, unit, { color: s.gridColor, lineWidth: 0.0015 }, 8, 4)
    scopeRow(f, this.left, this.right)
    g.lineWidth = Math.max(s.lineWidth * unit, 1)
    g.lineJoin = 'round'
    g.lineCap = 'round'
    const cy = r.y + r.h / 2
    const amp = (r.h / 2) * s.gain
    const line = (sample: (i: number) => number, color: string) => {
      g.strokeStyle = color
      g.beginPath()
      for (let i = 0; i < SCOPE_POINTS; i++) {
        const x = r.x + (r.w * i) / (SCOPE_POINTS - 1)
        const y = cy - Math.max(-1, Math.min(1, sample(i) * s.gain)) * (amp / s.gain)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
    if (s.channel === 'stereo') {
      line((i) => this.left[i] ?? 0, s.color)
      line((i) => this.right[i] ?? 0, s.color2)
    } else {
      line((i) => ((this.left[i] ?? 0) + (this.right[i] ?? 0)) / 2, s.color)
    }
  }
}

// ---------------------------------------------------------------------------
// Goniometer
// ---------------------------------------------------------------------------

export interface GoniometerSpec extends LayerSpecBase {
  type: 'goniometer'
  /** The goniometer is a square centered in this rect. */
  rect: RectSpec
  style: 'dots' | 'lines'
  color: string
  /** Dot size or line width in units. */
  size: number
  gain: number
  /** Also draw the previous N feature frames, fading out (deterministic trail). */
  trail: number
  grid: boolean
  gridColor: string
  labels: boolean
  labelColor: string
  fontFamily: string
}

export const GONIOMETER_DEFAULTS: Omit<GoniometerSpec, 'id' | 'type'> = {
  rect: { x: 0.25, y: 0.5, w: 0.5, h: 0.3, space: 'center' },
  style: 'dots',
  color: '#bef264',
  size: 0.005,
  gain: 1.4,
  trail: 3,
  grid: true,
  gridColor: 'rgba(255,255,255,0.15)',
  labels: true,
  labelColor: 'rgba(255,255,255,0.5)',
  fontFamily: MONO_STACK,
}

export class GoniometerLayer implements Layer {
  readonly id: string
  private readonly spec: GoniometerSpec
  private readonly left = new Float32Array(SCOPE_POINTS)
  private readonly right = new Float32Array(SCOPE_POINTS)

  constructor(spec: GoniometerSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const rr = f.rect(s.rect)
    const unit = f.layout.unit
    const side = Math.min(rr.w, rr.h)
    const cx = rr.x + rr.w / 2
    const cy = rr.y + rr.h / 2
    const half = side / 2

    if (s.grid) {
      g.save()
      g.strokeStyle = s.gridColor
      g.lineWidth = Math.max(0.0015 * unit, 1)
      g.beginPath()
      // Diamond (L / R axes at ±45°) plus M (vertical) and S (horizontal) axes.
      g.moveTo(cx, cy - half)
      g.lineTo(cx + half, cy)
      g.lineTo(cx, cy + half)
      g.lineTo(cx - half, cy)
      g.closePath()
      g.moveTo(cx, cy - half)
      g.lineTo(cx, cy + half)
      g.moveTo(cx - half, cy)
      g.lineTo(cx + half, cy)
      g.stroke()
      g.restore()
    }
    if (s.labels) {
      g.save()
      setLabelFont(g, s.fontFamily, 0.022 * unit)
      g.fillStyle = s.labelColor
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const d = half * 0.62
      g.fillText('L', cx - d, cy - d)
      g.fillText('R', cx + d, cy - d)
      g.fillText('M', cx, cy - half - 0.02 * unit)
      g.restore()
    }

    // Clip to the diamond's bounding square so loud frames don't spill over the frame.
    g.beginPath()
    g.rect(cx - half, cy - half, side, side)
    g.clip()

    const trail = Math.max(0, Math.min(Math.floor(s.trail), 12))
    const sizePx = Math.max(s.size * unit, 1)
    for (let k = trail; k >= 0; k--) {
      const frame = k === 0 ? f : { ...f, featurePos: Math.max(f.featurePos - k, 0) }
      scopeRow(frame, this.left, this.right)
      const prev = g.globalAlpha
      g.globalAlpha = prev * (1 - k / (trail + 1))
      g.fillStyle = s.color
      g.strokeStyle = s.color
      g.lineWidth = sizePx
      g.beginPath()
      for (let i = 0; i < SCOPE_POINTS; i++) {
        const l = this.left[i] ?? 0
        const r = this.right[i] ?? 0
        // M = (L + R) / 2 up, S = (R - L) / 2 right — the standard goniometer view.
        const x = cx + ((r - l) / 2) * half * s.gain
        const y = cy - ((l + r) / 2) * half * s.gain
        if (s.style === 'dots') g.rect(x - sizePx / 2, y - sizePx / 2, sizePx, sizePx)
        else if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      if (s.style === 'dots') g.fill()
      else g.stroke()
      g.globalAlpha = prev
    }
  }
}
