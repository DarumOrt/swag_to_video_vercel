/**
 * Kinetic typography for lyrics: words pop in as they are sung, size and weight follow loudness,
 * three layouts (flow / stack / focus), optional grunge jitter and torn letters on beats.
 * Line timing is shared with the karaoke layer (lyricsTiming.ts). Pure function of the frame.
 */

import { FONT_FAMILY, fontStack } from '../fonts'
import type { RectSpec } from '../layout'
import { createRng, hash32 } from '../random'
import type { Ctx2D, FrameContext, Layer, LayerSpecBase } from '../types'
import {
  computeLineTimings,
  ease,
  lineStateAt,
  type LineTiming,
  type TimedWord,
} from './lyricsTiming'
import { wrapText } from './text'

export interface KineticSpec extends LayerSpecBase {
  type: 'kinetic'
  rect: RectSpec
  /** flow = words wrap like text; stack = one word per row; focus = the current word huge. */
  mode: 'flow' | 'stack' | 'focus'
  fontFamily: string
  /** Variable-font weight range; loud words get heavier. */
  weightMin: number
  weightMax: number
  /** Base font size in units; shrinks to fit the rect. */
  fontSize: number
  lineHeight: number
  uppercase: boolean
  align: 'left' | 'center' | 'right'
  color: string
  /** Color of the word being sung (others use `color`). */
  activeColor: string
  /** Opacity of words not sung yet; 0 = they appear only when sung. */
  futureOpacity: number
  /** Pop-in duration and starting scale. */
  appearSec: number
  appearScale: number
  /** 0..1: how much loudness at the word start scales it up. */
  sizeReact: number
  /** Scale punch of the active word on beats (0 = off). */
  beatPunch: number
  /** Grunge: random offset (units) and rotation (degrees) re-rolled on every beat. */
  jitter: number
  jitterRotate: number
  /** Grunge: 0..1 torn-letter slice shift on beats. */
  tear: number
  leadInSec: number
  holdSec: number
  transitionSec: number
}

export const KINETIC_DEFAULTS: Omit<KineticSpec, 'id' | 'type'> = {
  rect: { x: 0, y: 0.15, w: 1, h: 0.5 },
  mode: 'flow',
  fontFamily: fontStack(FONT_FAMILY.grotesk),
  weightMin: 300,
  weightMax: 900,
  fontSize: 0.12,
  lineHeight: 1.05,
  uppercase: false,
  align: 'center',
  color: '#ffffff',
  activeColor: '#ffffff',
  futureOpacity: 0,
  appearSec: 0.18,
  appearScale: 1.35,
  sizeReact: 0.25,
  beatPunch: 0.04,
  jitter: 0,
  jitterRotate: 0,
  tear: 0,
  leadInSec: 0.2,
  holdSec: 0.8,
  transitionSec: 0.25,
}

interface PlacedWord {
  word: TimedWord
  text: string
  /** Center in rect-relative pixels. */
  x: number
  y: number
  width: number
  /** Loudness 0..1 at the word start. */
  loud: number
}

interface KineticLayout {
  fontPx: number
  words: PlacedWord[]
}

export class KineticLayer implements Layer {
  readonly id: string
  private readonly spec: KineticSpec
  private lyrics: unknown = null
  private timings: LineTiming[] = []
  private layoutKey = ''
  private layouts = new Map<string, KineticLayout>()

  constructor(spec: KineticSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const lyrics = f.timeline.lyrics
    if (!lyrics) return
    if (lyrics !== this.lyrics) {
      this.lyrics = lyrics
      this.timings = computeLineTimings(lyrics.lines, { ...s, previewLeadSec: 0 }, true)
      this.layouts.clear()
    }
    const r = f.rect(s.rect)
    const basePx = s.fontSize * f.layout.unit
    const key = `${r.w}|${r.h}|${basePx}`
    if (key !== this.layoutKey) {
      this.layoutKey = key
      this.layouts.clear()
      for (const line of this.timings) this.layout(g, line, r.w, r.h, basePx, f)
    }

    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const t = f.time
    for (const line of this.timings) {
      const state = lineStateAt(line, t, s.transitionSec)
      // Only the current line and the one leaving; no preview of the next line.
      if (!state || state.slot > 0.999 || t < line.appear) continue
      const lay = this.layout(g, line, r.w, r.h, basePx, f)
      const lineAlpha = state.slot < 0 ? 1 + state.slot : 1
      const lift = state.slot < 0 ? state.slot * basePx * 0.6 : 0
      if (s.mode === 'focus') this.drawFocus(g, f, lay, r, lineAlpha)
      else this.drawWords(g, f, lay, r, lineAlpha, lift)
    }
  }

  private drawWords(
    g: Ctx2D,
    f: FrameContext,
    lay: KineticLayout,
    r: { x: number; y: number },
    lineAlpha: number,
    lift: number,
  ) {
    const s = this.spec
    const t = f.time
    for (const pw of lay.words) {
      const since = t - pw.word.start
      const sung = since >= 0
      const appear = sung ? ease(since / Math.max(s.appearSec, 1e-3)) : 0
      const alpha = (sung ? appear : s.futureOpacity) * lineAlpha
      if (alpha <= 0.002) continue
      const active = sung && t < pw.word.end
      const pop = sung ? s.appearScale + (1 - s.appearScale) * appear : 1
      const loudScale = 1 + s.sizeReact * pw.loud
      const punch = active ? 1 + s.beatPunch * Math.exp(-f.beat.since / 0.12) * f.beat.strength : 1
      const weight = sung ? s.weightMin + (s.weightMax - s.weightMin) * pw.loud : s.weightMin
      this.drawWord(g, f, pw, {
        x: r.x + pw.x,
        y: r.y + pw.y + lift,
        scale: pop * loudScale * punch,
        alpha,
        weight,
        px: lay.fontPx,
        color: active ? s.activeColor : s.color,
      })
    }
  }

  private drawFocus(
    g: Ctx2D,
    f: FrameContext,
    lay: KineticLayout,
    r: { x: number; y: number },
    lineAlpha: number,
  ) {
    const s = this.spec
    const t = f.time
    // The current word (last started) big in the center; the previous one small above it.
    let current = -1
    lay.words.forEach((pw, i) => {
      if (pw.word.start <= t) current = i
    })
    if (current < 0) return
    const pw = lay.words[current]
    if (!pw) return
    const since = t - pw.word.start
    const appear = ease(since / Math.max(s.appearSec, 1e-3))
    const punch = 1 + s.beatPunch * Math.exp(-f.beat.since / 0.12) * f.beat.strength
    this.drawWord(g, f, pw, {
      x: r.x + pw.x,
      y: r.y + pw.y,
      scale: (s.appearScale + (1 - s.appearScale) * appear) * (1 + s.sizeReact * pw.loud) * punch,
      alpha: appear * lineAlpha,
      weight: s.weightMin + (s.weightMax - s.weightMin) * pw.loud,
      px: lay.fontPx,
      color: t < pw.word.end ? s.activeColor : s.color,
    })
    const prev = lay.words[current - 1]
    if (prev) {
      this.drawWord(g, f, prev, {
        x: r.x + pw.x,
        y: r.y + pw.y - lay.fontPx * 1.1,
        scale: 0.42,
        alpha: 0.5 * lineAlpha * (1 - appear * 0.5),
        weight: s.weightMin,
        px: lay.fontPx,
        color: s.color,
      })
    }
  }

  private drawWord(
    g: Ctx2D,
    f: FrameContext,
    pw: PlacedWord,
    o: {
      x: number
      y: number
      scale: number
      alpha: number
      weight: number
      px: number
      color: string
    },
  ) {
    const s = this.spec
    const unit = f.layout.unit
    g.save()
    g.globalAlpha *= Math.min(o.alpha, 1)
    let x = o.x
    let y = o.y
    let rot = 0
    if (s.jitter > 0 || s.jitterRotate > 0) {
      // Re-rolled on every beat: still within a beat, jumps on the hit.
      const rng = createRng(hash32(f.seed, pw.word.id, f.beat.index))
      x += (rng() - 0.5) * 2 * s.jitter * unit
      y += (rng() - 0.5) * 2 * s.jitter * unit
      rot = ((rng() - 0.5) * 2 * s.jitterRotate * Math.PI) / 180
    }
    f.words.place({
      wordId: pw.word.id,
      x,
      y,
      width: pw.width * o.scale,
      height: o.px * o.scale,
      start: pw.word.start,
      end: pw.word.end,
    })
    g.translate(x, y)
    if (rot) g.rotate(rot)
    g.scale(o.scale, o.scale)
    g.font = `${Math.round(o.weight)} ${o.px}px ${s.fontFamily}`
    g.fillStyle = o.color

    const tear = s.tear * Math.exp(-f.beat.since / 0.15) * f.beat.strength
    if (tear > 0.01) {
      // Torn letters: top and bottom halves slide apart horizontally.
      const shift = tear * o.px * 0.35
      const w = pw.width * 1.5 + o.px
      for (const [y0, dx] of [
        [-o.px, -shift],
        [0, shift],
      ] as const) {
        g.save()
        g.beginPath()
        g.rect(-w / 2, y0 + (y0 < 0 ? o.px * 0.08 : 0), w, o.px)
        g.clip()
        g.fillText(pw.text, dx, 0)
        g.restore()
      }
    } else {
      g.fillText(pw.text, 0, 0)
    }
    g.restore()
  }

  /** Word positions for a line (rect-relative centers), measured at the heaviest weight. Cached. */
  private layout(
    g: Ctx2D,
    line: LineTiming,
    width: number,
    height: number,
    basePx: number,
    f: FrameContext,
  ): KineticLayout {
    const cached = this.layouts.get(line.id)
    if (cached) return cached
    const s = this.spec
    const words = line.words
      .map((w) => ({ w, text: (s.uppercase ? w.text.toLocaleUpperCase() : w.text).trim() }))
      .filter((x) => x.text !== '')
    const feat = f.timeline.audio.features
    const loudAt = (time: number) => {
      const i = Math.min(Math.max(Math.floor(time * feat.rate), 0), feat.frameCount - 1)
      return Math.min(Math.max(((feat.rms[i] ?? 0) - 0.1) / 0.5, 0), 1)
    }
    // Lay out at the largest size a word can be drawn (pop-in × loudness), so neighbours never
    // collide and the block never leaves the rect; words are drawn at `px` × their own scale.
    const maxScale = Math.max(s.appearScale, 1) * (1 + s.sizeReact)
    const font = (px: number) => `${s.weightMax} ${px * maxScale}px ${s.fontFamily}`
    const measure = (text: string) => g.measureText(text).width
    let px = basePx
    let rows: string[][] = []
    for (let attempt = 0; attempt < 24; attempt++) {
      g.font = font(px)
      if (s.mode === 'flow') {
        rows = wrapText(words.map((x) => x.text).join(' '), width, measure).map((row) =>
          row.split(' '),
        )
      } else if (s.mode === 'stack') {
        rows = words.map((x) => [x.text])
      } else {
        rows = [[words.reduce((a, b) => (measure(b.text) > measure(a) ? b.text : a), '')]]
      }
      const widest = Math.max(0, ...rows.map((row) => measure(row.join(' '))))
      const fitsH = rows.length * px * maxScale * s.lineHeight <= height
      if (widest <= width && fitsH) break
      px *= 0.9
    }
    g.font = font(px)
    const lh = px * maxScale * s.lineHeight
    const placed: PlacedWord[] = []
    if (s.mode === 'focus') {
      for (const x of words) {
        placed.push({
          word: x.w,
          text: x.text,
          x: width / 2,
          y: height / 2,
          width: measure(x.text) / maxScale,
          loud: loudAt(x.w.start),
        })
      }
    } else {
      let wi = 0
      const top = height / 2 - (rows.length * lh) / 2
      rows.forEach((row, ri) => {
        const rowW = measure(row.join(' '))
        const left =
          s.align === 'left' ? 0 : s.align === 'right' ? width - rowW : (width - rowW) / 2
        let prefix = ''
        for (const text of row) {
          const x = words[wi++]
          if (!x) break
          const before = prefix ? `${prefix} ` : ''
          const x0 = measure(before)
          const w = measure(text)
          prefix = before + text
          placed.push({
            word: x.w,
            text,
            x: left + x0 + w / 2,
            y: top + lh * (ri + 0.5),
            width: w / maxScale,
            loud: loudAt(x.w.start),
          })
        }
      })
    }
    const layout = { fontPx: px, words: placed }
    this.layouts.set(line.id, layout)
    return layout
  }
}
