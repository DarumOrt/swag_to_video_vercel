/**
 * Lyrics layer: the current line with a karaoke fill by word timings, an optional preview of the
 * next line below, lines scrolling up as the song moves on. Reads `timeline.lyrics`.
 */

import type { Lyrics } from '@/shared'
import { FONT_FAMILY, fontStack } from '../fonts'
import type { RectSpec } from '../layout'
import type { BandReaction, Ctx2D, FrameContext, Layer, LayerSpecBase } from '../types'
import {
  computeLineTimings,
  lineStateAt,
  wordProgress,
  type LineTiming,
  type TimedWord,
} from './lyricsTiming'
import { wrapText } from './text'

export interface LyricsSpec extends LayerSpecBase {
  type: 'lyrics'
  rect: RectSpec
  fontFamily: string
  fontWeight: number
  /** Font size in units (fraction of the shorter frame side); shrinks to fit `maxRows`. */
  fontSize: number
  lineHeight: number
  uppercase: boolean
  align: 'left' | 'center' | 'right'
  /** A lyric line wraps to at most this many rows (the font shrinks to fit). */
  maxRows: number
  /** Vertical position of the current line's center within the rect, 0..1. */
  anchorY: number
  /** Gap between the current line and the preview, in font sizes. */
  gap: number
  /** Not yet sung. */
  baseColor: string
  /** Sung (karaoke fill). */
  fillColor: string
  showNext: boolean
  /** Opacity and scale of the preview line. */
  nextOpacity: number
  nextScale: number
  leadInSec: number
  holdSec: number
  previewLeadSec: number
  transitionSec: number
  /** Words without timing: 'show' fills them between their timed neighbours, 'hide' drops them. */
  untimedWords: 'show' | 'hide'
  /** Scales the current line by 1 + amount * band. */
  pulse: BandReaction | null
}

export const LYRICS_DEFAULTS: Omit<LyricsSpec, 'id' | 'type'> = {
  rect: { x: 0, y: 0.27, w: 1, h: 0.26, space: 'center' },
  fontFamily: fontStack(FONT_FAMILY.grotesk),
  fontWeight: 800,
  fontSize: 0.075,
  lineHeight: 1.15,
  uppercase: false,
  align: 'center',
  maxRows: 2,
  anchorY: 0.3,
  gap: 0.45,
  baseColor: 'rgba(255,255,255,0.38)',
  fillColor: '#ffffff',
  showNext: true,
  nextOpacity: 0.45,
  nextScale: 0.78,
  leadInSec: 0.6,
  holdSec: 1.2,
  previewLeadSec: 0.8,
  transitionSec: 0.3,
  untimedWords: 'show',
  pulse: { band: 'low', amount: 0.03 },
}

interface RowLayout {
  text: string
  width: number
  /** Word spans in row coordinates (0 = row start). */
  words: { id: string; x0: number; x1: number; start: number; end: number }[]
}

interface LineLayout {
  fontPx: number
  rows: RowLayout[]
  height: number
}

export class LyricsLayer implements Layer {
  readonly id: string
  private readonly spec: LyricsSpec
  private lyrics: Lyrics | null = null
  private timings: LineTiming[] = []
  private layoutKey = ''
  private layouts = new Map<string, LineLayout>()

  constructor(spec: LyricsSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const lyrics = f.timeline.lyrics
    if (!lyrics) return
    if (lyrics !== this.lyrics) {
      this.lyrics = lyrics
      this.timings = computeLineTimings(lyrics.lines, s, s.untimedWords === 'show')
      this.layouts.clear()
    }

    const r = f.rect(s.rect)
    const basePx = s.fontSize * f.layout.unit
    const key = `${r.w}|${basePx}`
    if (key !== this.layoutKey || this.layouts.size === 0) {
      // Lay out every line up front: no measuring mid-song (no hitches, same work on every frame).
      this.layoutKey = key
      this.layouts.clear()
      for (const line of this.timings) this.layout(g, line, r.w, basePx)
    }

    const t = f.time
    const y0 = r.y + r.h * s.anchorY
    const x = s.align === 'left' ? r.x : s.align === 'right' ? r.x + r.w : r.x + r.w / 2
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    const pulse = s.pulse ? 1 + s.pulse.amount * f.band(s.pulse.band) : 1

    for (let i = 0; i < this.timings.length; i++) {
      const line = this.timings[i]
      if (!line) continue
      const state = lineStateAt(line, t, s.transitionSec)
      if (!state) continue
      const lay = this.layout(g, line, r.w, basePx)

      // Opacity: preview → nextOpacity, current → 1, leaving → 0.
      const slot = state.slot
      const opacity =
        (slot >= 0 ? 1 + (s.nextOpacity * (s.showNext ? 1 : 0) - 1) * slot : 1 + slot) * state.fade
      if (opacity <= 0.001) continue
      const scale =
        (slot > 0 ? 1 + (s.nextScale - 1) * slot : 1) * (slot > -1 && slot < 1 ? pulse : 1)

      const neighbour = slot > 0 ? this.timings[i - 1] : slot < 0 ? this.timings[i + 1] : undefined
      const other = neighbour ? this.layout(g, neighbour, r.w, basePx) : lay
      const spacing = (lay.height + other.height) / 2 + s.gap * basePx
      const cy = y0 + slot * spacing

      g.save()
      g.globalAlpha *= Math.min(opacity, 1)
      g.translate(x, cy)
      g.scale(scale, scale)
      g.font = this.font(lay.fontPx)
      const lh = lay.fontPx * s.lineHeight
      lay.rows.forEach((row, ri) => {
        const rowY = (ri - (lay.rows.length - 1) / 2) * lh
        const left = s.align === 'left' ? 0 : s.align === 'right' ? -row.width : -row.width / 2
        g.fillStyle = this.rowFill(g, row, left, t)
        g.fillText(row.text, left, rowY)
        for (const w of row.words) {
          f.words.place({
            wordId: w.id,
            x: x + (left + (w.x0 + w.x1) / 2) * scale,
            y: cy + rowY * scale,
            width: (w.x1 - w.x0) * scale,
            height: lay.fontPx * scale,
            start: w.start,
            end: w.end,
          })
        }
      })
      g.restore()
    }
  }

  private font(px: number): string {
    return `${this.spec.fontWeight} ${px}px ${this.spec.fontFamily}`
  }

  /** Hard-edged horizontal gradient: fill color up to the sung position, base color after it. */
  private rowFill(g: Ctx2D, row: RowLayout, left: number, t: number): string | CanvasGradient {
    const s = this.spec
    let edge = 0
    for (const w of row.words) {
      const p = wordProgress(w, t)
      if (p > 0) edge = w.x0 + (w.x1 - w.x0) * p
    }
    if (edge <= 0) return s.baseColor
    if (edge >= row.width) return s.fillColor
    const frac = edge / row.width
    const grad = g.createLinearGradient(left, 0, left + row.width, 0)
    grad.addColorStop(0, s.fillColor)
    grad.addColorStop(frac, s.fillColor)
    grad.addColorStop(frac, s.baseColor)
    grad.addColorStop(1, s.baseColor)
    return grad
  }

  /** Wrap and fit a line: shrink the font until it fits `maxRows` rows of `width`. Cached. */
  private layout(g: Ctx2D, line: LineTiming, width: number, basePx: number): LineLayout {
    const cached = this.layouts.get(line.id)
    if (cached) return cached
    const s = this.spec
    const words = line.words
      .map((w) => ({ ...w, text: (s.uppercase ? w.text.toLocaleUpperCase() : w.text).trim() }))
      .filter((w) => w.text !== '')
    const text = words.map((w) => w.text).join(' ')
    let px = basePx
    let rows: string[] = []
    for (let attempt = 0; attempt < 16; attempt++) {
      g.font = this.font(px)
      rows = wrapText(text, width, (x) => g.measureText(x).width)
      const widest = Math.max(...rows.map((x) => g.measureText(x).width))
      if (rows.length <= Math.max(1, s.maxRows) && widest <= width) break
      px *= 0.9
    }
    g.font = this.font(px)
    const layout: LineLayout = {
      fontPx: px,
      rows: placeWords(rows, words, (x) => g.measureText(x).width),
      height: rows.length * px * s.lineHeight,
    }
    this.layouts.set(line.id, layout)
    return layout
  }
}

/** Assign words to wrapped rows (in order) and measure each word's span within its row. */
export function placeWords(
  rows: string[],
  words: TimedWord[],
  measure: (s: string) => number,
): RowLayout[] {
  let wi = 0
  return rows.map((text) => {
    const count = text.split(' ').filter(Boolean).length
    const spans: RowLayout['words'] = []
    let prefix = ''
    for (let k = 0; k < count; k++) {
      const w = words[wi++]
      if (!w) break
      const before = prefix ? `${prefix} ` : ''
      const x0 = measure(before)
      prefix = before + w.text
      spans.push({ id: w.id, x0, x1: measure(prefix), start: w.start, end: w.end })
    }
    return { text, width: measure(text), words: spans }
  })
}
