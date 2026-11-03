/**
 * Lyrics layer. `reveal: 'karaoke'` — the current line with a karaoke fill by word timings, an
 * optional preview of the next line below, lines scrolling up as the song moves on. The other
 * reveal modes (textReveal.ts) make the text appear in place instead: word by word, the current
 * word alone, the whole line, typed letters or popping words, with enter / exit animations.
 * `scale` enlarges the text; lines wrap and shrink to stay inside the safe area.
 * Reads `timeline.lyrics`.
 */

import type { Lyrics } from '@/shared'
import { FONT_FAMILY, fontStack } from '../fonts'
import type { PixelRect, RectSpec } from '../layout'
import type { BandReaction, Ctx2D, FrameContext, Layer, LayerSpecBase } from '../types'
import {
  computeLineTimings,
  lineStateAt,
  wordProgress,
  type LineTiming,
  type TimedWord,
} from './lyricsTiming'
import { wrapText } from './text'
import {
  animState,
  combine,
  lineExitState,
  lineWindows,
  popState,
  typedChars,
  type AnimState,
  type LineExit,
  type LineWindow,
  type TextAnim,
  type TextReveal,
} from './textReveal'

export interface LyricsSpec extends LayerSpecBase {
  type: 'lyrics'
  rect: RectSpec
  /** How the text shows up (TextReveal); only karaoke uses the preview / scroll slots. */
  reveal: TextReveal
  /** Enter / exit animation of words and lines in appearing modes. */
  anim: TextAnim
  animSec: number
  /** Appearing modes: a line leaves after its last word (+ `holdSec`) or when the next one shows. */
  exit: LineExit
  /** Text size multiplier (0.5..2.5) on top of `fontSize`. */
  scale: number
  fontFamily: string
  fontWeight: number
  /**
   * Font size in units (fraction of the shorter frame side). Shrinks to fit `maxRows` rows (more
   * when scaled up) within the rect width and the safe area.
   */
  fontSize: number
  lineHeight: number
  uppercase: boolean
  align: 'left' | 'center' | 'right'
  /** A lyric line wraps to at most this many rows at scale 1 (the font shrinks to fit). */
  maxRows: number
  /** Vertical position of the current line's center within the rect, 0..1. */
  anchorY: number
  /** Gap between the current line and the preview, in font sizes. */
  gap: number
  /** Not yet sung (karaoke). */
  baseColor: string
  /** Sung (karaoke fill); the text color in appearing modes. */
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
  reveal: 'karaoke',
  anim: 'fade',
  animSec: 0.25,
  exit: 'line-end',
  scale: 1,
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

export const TEXT_SCALE_MIN = 0.5
export const TEXT_SCALE_MAX = 2.5
export const clampTextScale = (x: number) =>
  Math.min(Math.max(Number.isFinite(x) ? x : 1, TEXT_SCALE_MIN), TEXT_SCALE_MAX)

export interface WordSpan {
  id: string
  text: string
  /** Span in row coordinates (0 = row start). */
  x0: number
  x1: number
  start: number
  end: number
  /** Width of the first k characters of the word (typewriter), length = text.length + 1. */
  chars: number[]
}

interface RowLayout {
  text: string
  width: number
  words: WordSpan[]
}

export interface LineLayout {
  fontPx: number
  rows: RowLayout[]
  height: number
}

/** Room the text may take around its anchor: rect width ∩ safe area, height within the safe area. */
export function textArea(
  r: PixelRect,
  safe: PixelRect,
  align: LyricsSpec['align'],
  anchorX: number,
  anchorY: number,
): { w: number; h: number } {
  const left = Math.max(r.x, safe.x)
  const right = Math.min(r.x + r.w, safe.x + safe.w)
  const w =
    align === 'center'
      ? 2 * Math.min(anchorX - left, right - anchorX)
      : align === 'left'
        ? right - anchorX
        : anchorX - left
  const h = 2 * Math.min(anchorY - safe.y, safe.y + safe.h - anchorY)
  // Never collapse to nothing (anchor outside the safe area): fall back to a small box.
  const floor = Math.min(safe.w, safe.h) * 0.2
  return { w: Math.max(w, floor), h: Math.max(h, floor) }
}

export class LyricsLayer implements Layer {
  readonly id: string
  private readonly spec: LyricsSpec
  private lyrics: Lyrics | null = null
  private timings: LineTiming[] = []
  private windows: LineWindow[] = []
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
      this.windows = lineWindows(this.timings, s.reveal, s.exit, s.holdSec)
      this.layouts.clear()
    }

    const r = f.rect(s.rect)
    const scale = clampTextScale(s.scale)
    const basePx = s.fontSize * f.layout.unit * scale
    const y0 = r.y + r.h * s.anchorY
    const x = s.align === 'left' ? r.x : s.align === 'right' ? r.x + r.w : r.x + r.w / 2
    const area = textArea(r, f.layout.safe, s.align, x, y0)
    const key = `${area.w}|${area.h}|${basePx}`
    if (key !== this.layoutKey || this.layouts.size === 0) {
      // Lay out every line up front: no measuring mid-song (no hitches, same work on every frame).
      this.layoutKey = key
      this.layouts.clear()
      for (const line of this.timings) this.layout(g, line, area, basePx, scale)
    }

    g.textAlign = 'left'
    g.textBaseline = 'middle'
    const pulse = s.pulse ? 1 + s.pulse.amount * f.band(s.pulse.band) : 1
    const ctx: DrawCtx = { f, area, basePx, scale, x, y0, pulse }
    if (s.reveal === 'karaoke') this.drawKaraoke(g, ctx)
    else this.drawAppearing(g, ctx)
  }

  private drawKaraoke(g: Ctx2D, c: DrawCtx): void {
    const s = this.spec
    const { f, x, y0, pulse } = c
    const t = f.time
    for (let i = 0; i < this.timings.length; i++) {
      const line = this.timings[i]
      if (!line) continue
      const state = lineStateAt(line, t, s.transitionSec)
      if (!state) continue
      const lay = this.layout(g, line, c.area, c.basePx, c.scale)

      // Opacity: preview → nextOpacity, current → 1, leaving → 0.
      const slot = state.slot
      const opacity =
        (slot >= 0 ? 1 + (s.nextOpacity * (s.showNext ? 1 : 0) - 1) * slot : 1 + slot) * state.fade
      if (opacity <= 0.001) continue
      const scale =
        (slot > 0 ? 1 + (s.nextScale - 1) * slot : 1) * (slot > -1 && slot < 1 ? pulse : 1)

      const neighbour = slot > 0 ? this.timings[i - 1] : slot < 0 ? this.timings[i + 1] : undefined
      const other = neighbour ? this.layout(g, neighbour, c.area, c.basePx, c.scale) : lay
      const spacing = (lay.height + other.height) / 2 + s.gap * c.basePx
      const cy = y0 + slot * spacing

      g.save()
      g.globalAlpha *= Math.min(opacity, 1)
      g.translate(x, cy)
      g.scale(scale, scale)
      g.font = this.font(lay.fontPx)
      const lh = lay.fontPx * s.lineHeight
      lay.rows.forEach((row, ri) => {
        const rowY = (ri - (lay.rows.length - 1) / 2) * lh
        const left = rowLeft(s.align, row.width)
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

  /** Appearing modes: lines stay in place at the anchor; words / lines animate in and out. */
  private drawAppearing(g: Ctx2D, c: DrawCtx): void {
    const s = this.spec
    const { f, x, y0, pulse } = c
    const t = f.time
    g.fillStyle = s.fillColor
    for (let i = 0; i < this.timings.length; i++) {
      const line = this.timings[i]
      const win = this.windows[i]
      if (!line || !win) continue
      const ls = lineExitState(win, t, s.anim, s.animSec)
      if (!ls || ls.alpha <= 0.001) continue
      const lay = this.layout(g, line, c.area, c.basePx, c.scale)
      const px = lay.fontPx
      const lineScale = ls.scale * pulse
      const cy = y0 + ls.dy * px
      const lineBlur: AnimState = { alpha: 1, dy: 0, scale: 1, blur: ls.blur }
      const lh = px * s.lineHeight

      g.save()
      g.globalAlpha *= Math.min(ls.alpha, 1)
      g.translate(x, cy)
      g.scale(lineScale, lineScale)
      g.font = this.font(px)
      const place = (w: WordSpan, wx: number, wy: number, st: AnimState) =>
        f.words.place({
          wordId: w.id,
          x: x + wx * lineScale,
          y: cy + (wy + st.dy * px) * lineScale,
          width: (w.x1 - w.x0) * st.scale * lineScale,
          height: px * st.scale * lineScale,
          start: w.start,
          end: w.end,
        })

      if (s.reveal === 'word-solo') {
        // The current word alone, centered on the anchor; it cuts to the next word.
        const all = lay.rows.flatMap((row) => row.words)
        let cur = -1
        all.forEach((w, k) => {
          if (w.start <= t) cur = k
        })
        const w = all[cur]
        if (w) {
          const st = combine(this.wordEnter(t - w.start), lineBlur)
          const solo = this.soloLayout(g, w, c.area, c.basePx)
          g.font = this.font(solo.fontPx)
          const width = solo.x1 - solo.x0
          if (st.alpha > 0.001) {
            drawWord(g, w.text, 0, 0, width, st, solo.fontPx)
            f.words.place({
              wordId: w.id,
              x,
              y: cy + st.dy * solo.fontPx * lineScale,
              width: width * st.scale * lineScale,
              height: solo.fontPx * st.scale * lineScale,
              start: w.start,
              end: w.end,
            })
          }
        }
        g.restore()
        continue
      }

      lay.rows.forEach((row, ri) => {
        const rowY = (ri - (lay.rows.length - 1) / 2) * lh
        const left = rowLeft(s.align, row.width)
        for (const w of row.words) {
          const wx = left + (w.x0 + w.x1) / 2
          const width = w.x1 - w.x0
          if (s.reveal === 'typewriter') {
            const n = typedChars(w, w.text.length, t)
            if (n <= 0) continue
            const full = Math.floor(n)
            const st = lineBlur
            g.save()
            if (st.blur > 0.002) g.filter = `blur(${(st.blur * px).toFixed(2)}px)`
            if (full > 0) g.fillText(w.text.slice(0, full), left + w.x0, rowY)
            const frac = n - full
            if (full < w.text.length && frac > 0.01) {
              g.globalAlpha *= frac
              g.fillText(w.text.charAt(full), left + w.x0 + (w.chars[full] ?? 0), rowY)
            }
            g.restore()
            place(w, wx, rowY, st)
            continue
          }
          const since = t - (s.reveal === 'line' ? win.show : w.start)
          if (since < 0) continue
          const st = combine(this.wordEnter(since), lineBlur)
          if (st.alpha <= 0.001) continue
          drawWord(g, w.text, wx, rowY, width, st, px)
          place(w, wx, rowY, st)
        }
      })
      g.restore()
    }
  }

  /** Enter animation of a word `since` seconds after it appeared. */
  private wordEnter(since: number): AnimState {
    const s = this.spec
    if (s.reveal === 'pop') return popState(since, Math.max(s.animSec, 0.22))
    return animState(s.anim, s.anim === 'none' ? 1 : since / Math.max(s.animSec, 1e-3))
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

  /**
   * Wrap and fit a line: shrink the font until it fits the row limit within `area`. Scaled-up
   * text may wrap to more rows than `maxRows` (wrapping first, shrinking when that is not enough).
   * Cached.
   */
  private layout(
    g: Ctx2D,
    line: LineTiming,
    area: { w: number; h: number },
    basePx: number,
    scale: number,
  ): LineLayout {
    const cached = this.layouts.get(line.id)
    if (cached) return cached
    const s = this.spec
    const words = line.words
      .map((w) => ({ ...w, text: (s.uppercase ? w.text.toLocaleUpperCase() : w.text).trim() }))
      .filter((w) => w.text !== '')
    const layout = fitLine(
      words,
      area,
      basePx,
      Math.max(1, s.maxRows, Math.ceil(s.maxRows * Math.max(scale, 1))),
      s.lineHeight,
      (px) => {
        g.font = this.font(px)
        return (x: string) => g.measureText(x).width
      },
    )
    this.layouts.set(line.id, layout)
    // word-solo: fit every word on its own as well (also up front).
    if (s.reveal === 'word-solo') {
      for (const row of layout.rows) for (const w of row.words) this.soloLayout(g, w, area, basePx)
    }
    return layout
  }

  private soloLayout(
    g: Ctx2D,
    w: WordSpan,
    area: { w: number; h: number },
    basePx: number,
  ): WordSpan & { fontPx: number } {
    const key = `solo|${w.id}`
    const cached = this.layouts.get(key)
    const span = cached?.rows[0]?.words[0]
    if (cached && span) return { ...span, fontPx: cached.fontPx }
    const timed: TimedWord = { ...w, timed: true }
    const lay = fitLine([timed], area, basePx, 1, this.spec.lineHeight, (px) => {
      g.font = this.font(px)
      return (x: string) => g.measureText(x).width
    })
    this.layouts.set(key, lay)
    return { ...(lay.rows[0]?.words[0] ?? w), fontPx: lay.fontPx }
  }
}

interface DrawCtx {
  f: FrameContext
  area: { w: number; h: number }
  basePx: number
  scale: number
  x: number
  y0: number
  pulse: number
}

const rowLeft = (align: LyricsSpec['align'], width: number) =>
  align === 'left' ? 0 : align === 'right' ? -width : -width / 2

/** One word around its center (`cx`, `cy`) with an animation state; left-aligned text. */
function drawWord(
  g: Ctx2D,
  text: string,
  cx: number,
  cy: number,
  width: number,
  st: AnimState,
  px: number,
): void {
  g.save()
  g.globalAlpha *= Math.min(st.alpha, 1)
  g.translate(cx, cy + st.dy * px)
  if (st.scale !== 1) g.scale(st.scale, st.scale)
  if (st.blur > 0.002) g.filter = `blur(${(st.blur * px).toFixed(2)}px)`
  g.fillText(text, -width / 2, 0)
  g.restore()
}

/**
 * Wrap words into at most `maxRows` rows of `area.w` with total height ≤ `area.h`, shrinking the
 * font from `basePx` until it fits. `measureAt(px)` sets the font and returns a measurer.
 */
export function fitLine(
  words: TimedWord[],
  area: { w: number; h: number },
  basePx: number,
  maxRows: number,
  lineHeight: number,
  measureAt: (px: number) => (s: string) => number,
): LineLayout {
  const text = words.map((w) => w.text).join(' ')
  let px = basePx
  let rows: string[] = []
  let measure = measureAt(px)
  for (let attempt = 0; attempt < 30; attempt++) {
    rows = wrapText(text, area.w, measure)
    const widest = Math.max(0, ...rows.map((x) => measure(x)))
    if (rows.length <= maxRows && widest <= area.w && rows.length * px * lineHeight <= area.h) break
    px *= 0.92
    measure = measureAt(px)
  }
  return {
    fontPx: px,
    rows: placeWords(rows, words, measure),
    height: rows.length * px * lineHeight,
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
    const spans: WordSpan[] = []
    let prefix = ''
    for (let k = 0; k < count; k++) {
      const w = words[wi++]
      if (!w) break
      const before = prefix ? `${prefix} ` : ''
      const x0 = measure(before)
      prefix = before + w.text
      const chars = Array.from({ length: w.text.length + 1 }, (_, i) =>
        i === 0 ? 0 : measure(w.text.slice(0, i)),
      )
      spans.push({
        id: w.id,
        text: w.text,
        x0,
        x1: measure(prefix),
        start: w.start,
        end: w.end,
        chars,
      })
    }
    return { text, width: measure(text), words: spans }
  })
}
