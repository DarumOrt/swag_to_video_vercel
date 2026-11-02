/**
 * Level meters (peak with hold, RMS, short-term LUFS) and a stereo correlation meter.
 * Holds and smoothing are computed from past feature frames, never from renderer state.
 */

import type { Ctx2D, FrameContext, Layer, LayerSpecBase, PixelRect, RectSpec } from '@/render'
import { dbToMeter, linToDb, MONO_STACK, setLabelFont, verticalGradient } from './common'

// ---------------------------------------------------------------------------
// Level meters
// ---------------------------------------------------------------------------

export interface LevelMetersSpec extends LayerSpecBase {
  type: 'level-meters'
  rect: RectSpec
  orientation: 'vertical' | 'horizontal'
  /** Bottom of the dB scale (top is 0 dBFS). */
  minDb: number
  /** Peak hold time, seconds. */
  holdSec: number
  /** Colors along the scale, quiet → loud. */
  colors: string[]
  trackColor: string
  /** Gap between meters as a fraction of a meter's slot. */
  gap: number
  /** Draw dB ticks and the numeric readouts. */
  labels: boolean
  labelColor: string
  fontFamily: string
}

export const LEVEL_METERS_DEFAULTS: Omit<LevelMetersSpec, 'id' | 'type'> = {
  rect: { x: 0.1, y: 0.55, w: 0.8, h: 0.25 },
  orientation: 'vertical',
  minDb: -60,
  holdSec: 1.5,
  colors: ['#22c55e', '#a3e635', '#facc15', '#ef4444'],
  trackColor: 'rgba(255,255,255,0.08)',
  gap: 0.35,
  labels: true,
  labelColor: 'rgba(255,255,255,0.6)',
  fontFamily: MONO_STACK,
}

const TICKS_DB = [0, -6, -12, -18, -24, -36, -48, -60, -72]

/** Max of a series over the last `windowSec` up to `pos` (feature grid). Pure. */
export function heldMax(
  series: ArrayLike<number>,
  pos: number,
  rate: number,
  windowSec: number,
): number {
  const end = Math.min(Math.floor(pos), series.length - 1)
  const start = Math.max(end - Math.round(windowSec * rate), 0)
  let m = 0
  for (let i = start; i <= end; i++) m = Math.max(m, series[i] ?? 0)
  return m
}

/** Mean of a series over the last `windowSec` up to `pos`. Pure. */
export function windowMean(
  series: ArrayLike<number>,
  pos: number,
  rate: number,
  windowSec: number,
): number {
  const end = Math.min(Math.floor(pos), series.length - 1)
  const start = Math.max(end - Math.round(windowSec * rate), 0)
  if (end < start) return 0
  let sum = 0
  for (let i = start; i <= end; i++) sum += series[i] ?? 0
  return sum / (end - start + 1)
}

export class LevelMetersLayer implements Layer {
  readonly id: string
  private readonly spec: LevelMetersSpec

  constructor(spec: LevelMetersSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const feat = f.timeline.audio.features
    const r = f.rect(s.rect)
    const unit = f.layout.unit
    const vertical = s.orientation === 'vertical'

    const peakDb = linToDb(f.sample(feat.peak))
    const holdDb = linToDb(heldMax(feat.peak, f.featurePos, feat.rate, s.holdSec))
    const rmsDb = linToDb(f.sample(feat.rms))
    const lufs = f.sample(feat.lufsShortTerm)
    const meters = [
      { label: 'PEAK', value: peakDb, hold: holdDb, unit: 'dB' },
      { label: 'RMS', value: rmsDb, hold: null, unit: 'dB' },
      { label: 'LUFS', value: lufs, hold: null, unit: 'LU' },
    ]

    const labelPx = 0.022 * unit
    const readoutSpace = s.labels ? labelPx * 2.6 : 0
    const scaleSpace = s.labels ? labelPx * 2.6 : 0
    // Meter area leaves room for readouts (below / right) and the dB scale (left / below).
    const area: PixelRect = vertical
      ? { x: r.x + scaleSpace, y: r.y, w: r.w - scaleSpace, h: r.h - readoutSpace }
      : { x: r.x + readoutSpace * 1.6, y: r.y, w: r.w - readoutSpace * 1.6, h: r.h - scaleSpace }
    const n = meters.length
    const slot = (vertical ? area.w : area.h) / n
    const thick = slot * (1 - Math.min(Math.max(s.gap, 0), 0.9))
    const len = vertical ? area.h : area.w

    const fill = vertical
      ? verticalGradient(g, area.y + area.h, area.y, s.colors)
      : horizontalGradient(g, area.x, area.x + area.w, s.colors)

    meters.forEach((m, i) => {
      const off = i * slot + (slot - thick) / 2
      const frac = dbToMeter(m.value, s.minDb)
      g.fillStyle = s.trackColor
      if (vertical) g.fillRect(area.x + off, area.y, thick, len)
      else g.fillRect(area.x, area.y + off, len, thick)
      g.fillStyle = fill
      if (vertical) g.fillRect(area.x + off, area.y + len * (1 - frac), thick, len * frac)
      else g.fillRect(area.x, area.y + off, len * frac, thick)
      if (m.hold !== null) {
        const h = dbToMeter(m.hold, s.minDb)
        const hp = Math.max(0.004 * unit, 2)
        g.fillStyle = s.colors[s.colors.length - 1] ?? '#ffffff'
        if (vertical) g.fillRect(area.x + off, area.y + len * (1 - h) - hp / 2, thick, hp)
        else g.fillRect(area.x + len * h - hp / 2, area.y + off, hp, thick)
      }
      if (s.labels) {
        setLabelFont(g, s.fontFamily, labelPx, 600)
        g.fillStyle = s.labelColor
        const text = `${m.label} ${m.value <= s.minDb ? '-∞' : m.value.toFixed(1)}`
        if (vertical) {
          g.textAlign = 'center'
          g.textBaseline = 'top'
          g.fillText(m.label, area.x + off + thick / 2, area.y + area.h + labelPx * 0.3)
          g.fillText(
            m.value <= s.minDb ? '-∞' : m.value.toFixed(1),
            area.x + off + thick / 2,
            area.y + area.h + labelPx * 1.4,
          )
        } else {
          g.textAlign = 'right'
          g.textBaseline = 'middle'
          g.fillText(text, area.x - labelPx * 0.5, area.y + off + thick / 2)
        }
      }
    })

    if (s.labels) {
      setLabelFont(g, s.fontFamily, labelPx * 0.85)
      g.fillStyle = s.labelColor
      for (const db of TICKS_DB) {
        if (db < s.minDb) continue
        const p = dbToMeter(db, s.minDb)
        if (vertical) {
          g.textAlign = 'right'
          g.textBaseline = 'middle'
          g.fillText(`${db}`, area.x - labelPx * 0.4, area.y + area.h * (1 - p))
        } else {
          g.textAlign = 'center'
          g.textBaseline = 'top'
          g.fillText(`${db}`, area.x + area.w * p, area.y + area.h + labelPx * 0.4)
        }
      }
    }
  }
}

function horizontalGradient(g: Ctx2D, x0: number, x1: number, colors: string[]) {
  if (colors.length <= 1) return colors[0] ?? '#ffffff'
  const grad = g.createLinearGradient(x0, 0, x1, 0)
  colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c))
  return grad
}

// ---------------------------------------------------------------------------
// Correlation meter
// ---------------------------------------------------------------------------

export interface CorrelationSpec extends LayerSpecBase {
  type: 'correlation'
  rect: RectSpec
  /** Averaging window, seconds. */
  smoothingSec: number
  negativeColor: string
  positiveColor: string
  trackColor: string
  labels: boolean
  labelColor: string
  fontFamily: string
}

export const CORRELATION_DEFAULTS: Omit<CorrelationSpec, 'id' | 'type'> = {
  rect: { x: 0.1, y: 0.82, w: 0.8, h: 0.03 },
  smoothingSec: 0.3,
  negativeColor: '#ef4444',
  positiveColor: '#22c55e',
  trackColor: 'rgba(255,255,255,0.1)',
  labels: true,
  labelColor: 'rgba(255,255,255,0.55)',
  fontFamily: MONO_STACK,
}

export class CorrelationLayer implements Layer {
  readonly id: string
  private readonly spec: CorrelationSpec

  constructor(spec: CorrelationSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const feat = f.timeline.audio.features
    const r = f.rect(s.rect)
    const unit = f.layout.unit
    const c = Math.max(
      -1,
      Math.min(1, windowMean(feat.stereo.correlation, f.featurePos, feat.rate, s.smoothingSec)),
    )
    const mid = r.x + r.w / 2
    g.fillStyle = s.trackColor
    g.fillRect(r.x, r.y, r.w, r.h)
    g.fillStyle = c >= 0 ? s.positiveColor : s.negativeColor
    const x = mid + (r.w / 2) * c
    g.fillRect(Math.min(mid, x), r.y, Math.abs(x - mid), r.h)
    g.fillStyle = '#ffffff'
    g.fillRect(
      x - Math.max(0.002 * unit, 1),
      r.y - r.h * 0.25,
      Math.max(0.004 * unit, 2),
      r.h * 1.5,
    )
    if (s.labels) {
      setLabelFont(g, s.fontFamily, 0.02 * unit)
      g.fillStyle = s.labelColor
      g.textBaseline = 'top'
      const y = r.y + r.h + 0.008 * unit
      g.textAlign = 'left'
      g.fillText('-1', r.x, y)
      g.textAlign = 'center'
      g.fillText(`CORR ${c >= 0 ? '+' : ''}${c.toFixed(2)}`, mid, y)
      g.textAlign = 'right'
      g.fillText('+1', r.x + r.w, y)
    }
  }
}
