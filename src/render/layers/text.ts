/**
 * Static text layer (milestone 1 placeholder for the track title). Kinetic typography comes later.
 */

import { FONT_FAMILY, fontStack } from '../fonts'
import type { RectSpec } from '../layout'
import type { BandReaction, Ctx2D, FrameContext, Layer, LayerSpecBase } from '../types'

export interface TextSpec extends LayerSpecBase {
  type: 'text'
  text: string
  rect: RectSpec
  /** CSS font-family list. Must include faces with Cyrillic glyphs. */
  fontFamily: string
  fontWeight: number
  /** Font size in units (fraction of the shorter frame side). */
  fontSize: number
  /** Line height as a multiple of font size. */
  lineHeight: number
  color: string
  align: 'left' | 'center' | 'right'
  valign: 'top' | 'middle' | 'bottom'
  uppercase: boolean
  /** Pulse: scales the text block around its center by 1 + amount * band. */
  pulse: BandReaction | null
}

export const DEFAULT_FONT_FAMILY = fontStack(FONT_FAMILY.grotesk)

export const TEXT_DEFAULTS: Omit<TextSpec, 'id' | 'type' | 'text'> = {
  rect: { x: 0, y: 0.08, w: 1, h: 0.2, space: 'center' },
  fontFamily: fontStack(FONT_FAMILY.display),
  fontWeight: 800,
  fontSize: 0.075,
  lineHeight: 1.15,
  color: '#ffffff',
  align: 'center',
  valign: 'middle',
  uppercase: true,
  pulse: { band: 'low', amount: 0.04 },
}

/**
 * Greedy word wrap. Explicit '\n' starts a new line; a word wider than `maxWidth` gets a line of its
 * own (never split mid-word).
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && measure(candidate) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

export class TextLayer implements Layer {
  readonly id: string
  private readonly spec: TextSpec
  private cacheKey = ''
  private cache: { lines: string[]; fontPx: number } = { lines: [], fontPx: 0 }

  constructor(spec: TextSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    const text = s.uppercase ? s.text.toLocaleUpperCase() : s.text
    if (!text.trim()) return
    const r = f.rect(s.rect)

    const { lines, fontPx } = this.fit(g, text, r.w, r.h, s.fontSize * f.layout.unit)
    const lh = fontPx * s.lineHeight
    const blockH = lh * lines.length
    const top =
      s.valign === 'top'
        ? r.y
        : s.valign === 'bottom'
          ? r.y + r.h - blockH
          : r.y + (r.h - blockH) / 2
    const x = s.align === 'left' ? r.x : s.align === 'right' ? r.x + r.w : r.x + r.w / 2

    if (s.pulse && s.pulse.amount !== 0) {
      const scale = 1 + s.pulse.amount * f.band(s.pulse.band)
      const cx = r.x + r.w / 2
      const cy = top + blockH / 2
      g.translate(cx, cy)
      g.scale(scale, scale)
      g.translate(-cx, -cy)
    }

    g.font = this.font(fontPx)
    g.fillStyle = s.color
    g.textAlign = s.align
    g.textBaseline = 'middle'
    lines.forEach((line, i) => g.fillText(line, x, top + lh * (i + 0.5)))
  }

  private font(px: number): string {
    return `${this.spec.fontWeight} ${px}px ${this.spec.fontFamily}`
  }

  /** Wrap to width and shrink the font until the block fits the rect height. Cached per size. */
  private fit(
    g: Ctx2D,
    text: string,
    width: number,
    height: number,
    fontPx: number,
  ): { lines: string[]; fontPx: number } {
    const key = `${text}|${width}|${height}|${fontPx}`
    if (key === this.cacheKey) return this.cache
    let px = fontPx
    let lines: string[] = []
    for (let attempt = 0; attempt < 12; attempt++) {
      g.font = this.font(px)
      lines = wrapText(text, width, (t) => g.measureText(t).width)
      const widest = Math.max(...lines.map((l) => g.measureText(l).width))
      if (lines.length * px * this.spec.lineHeight <= height && widest <= width) break
      px *= 0.88
    }
    this.cacheKey = key
    this.cache = { lines, fontPx: px }
    return this.cache
  }
}
