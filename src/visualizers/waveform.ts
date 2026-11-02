/**
 * Track waveform overview with a playhead. The overview (one value per column) is computed once
 * per timeline and width from the peak series; per frame only the played/unplayed split moves.
 */

import type { Ctx2D, FrameContext, Layer, LayerSpecBase, RectSpec } from '@/render'
import type { Timeline } from '@/shared'

export interface WaveformSpec extends LayerSpecBase {
  type: 'waveform'
  rect: RectSpec
  /** 0 = whole track; otherwise a window of this many seconds scrolling with the playhead. */
  spanSec: number
  /** Column width in units; bars are mirrored around the middle. */
  barWidth: number
  gap: number
  playedColor: string
  unplayedColor: string
  playheadColor: string
  /** Playhead line width in units; 0 = none. */
  playheadWidth: number
}

export const WAVEFORM_DEFAULTS: Omit<WaveformSpec, 'id' | 'type'> = {
  rect: { x: 0, y: 0.9, w: 1, h: 0.08, space: 'bleed' },
  spanSec: 0,
  barWidth: 0.006,
  gap: 0.35,
  playedColor: '#f8fafc',
  unplayedColor: 'rgba(248,250,252,0.3)',
  playheadColor: '#f43f5e',
  playheadWidth: 0.003,
}

/** Max of `series` over each of `columns` equal slices of [from, to) frames. Pure. */
export function overview(
  series: ArrayLike<number>,
  from: number,
  to: number,
  columns: number,
): Float32Array {
  const out = new Float32Array(columns)
  const span = Math.max(to - from, 1e-9)
  for (let c = 0; c < columns; c++) {
    const a = Math.floor(from + (span * c) / columns)
    const b = Math.max(Math.floor(from + (span * (c + 1)) / columns), a + 1)
    let m = 0
    for (let i = Math.max(a, 0); i < Math.min(b, series.length); i++)
      m = Math.max(m, series[i] ?? 0)
    out[c] = m
  }
  return out
}

export class WaveformLayer implements Layer {
  readonly id: string
  private readonly spec: WaveformSpec
  private cacheKey = ''
  private cache: { timeline: Timeline | null; values: Float32Array } = {
    timeline: null,
    values: new Float32Array(0),
  }

  constructor(spec: WaveformSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const feat = f.timeline.audio.features
    const r = f.rect(s.rect)
    const unit = f.layout.unit
    const slot = Math.max(s.barWidth * unit, 1)
    const columns = Math.max(2, Math.floor(r.w / slot))
    const barW = (r.w / columns) * (1 - Math.min(Math.max(s.gap, 0), 0.9))
    const duration = f.timeline.audio.durationSec

    let values: Float32Array
    let playheadFrac: number
    if (s.spanSec > 0) {
      // Scrolling window centered on the playhead: recomputed per frame (columns × few samples).
      const half = (s.spanSec * feat.rate) / 2
      values = overview(feat.peak, f.featurePos - half, f.featurePos + half, columns)
      playheadFrac = 0.5
    } else {
      const key = `${columns}|${feat.frameCount}`
      if (this.cache.timeline !== f.timeline || this.cacheKey !== key) {
        this.cache = {
          timeline: f.timeline,
          values: overview(feat.peak, 0, feat.frameCount, columns),
        }
        this.cacheKey = key
      }
      values = this.cache.values
      playheadFrac = duration > 0 ? Math.min(Math.max(f.time / duration, 0), 1) : 0
    }

    const cy = r.y + r.h / 2
    const playX = r.x + r.w * playheadFrac
    for (const played of [true, false]) {
      g.fillStyle = played ? s.playedColor : s.unplayedColor
      g.beginPath()
      for (let c = 0; c < columns; c++) {
        const x = r.x + (r.w * c) / columns + (r.w / columns - barW) / 2
        if (played !== x + barW / 2 <= playX) continue
        const h = Math.max((values[c] ?? 0) * r.h, Math.max(0.002 * unit, 1))
        g.rect(x, cy - h / 2, barW, h)
      }
      g.fill()
    }
    if (s.playheadWidth > 0) {
      g.fillStyle = s.playheadColor
      const w = Math.max(s.playheadWidth * unit, 1)
      g.fillRect(playX - w / 2, r.y, w, r.h)
    }
  }
}
