/**
 * Full-screen text, edit style: the word (or the line) as big as the frame allows, turning between
 * horizontal and vertical (90°) by line, word, section or seed, slammed or mask-revealed on the beat,
 * cropped by the frame edges. The letters are a figure: solid, outline, or filled with the picture
 * below (the visualizers show through the letters while the rest of the frame is dimmed), with
 * echo outlines pulsing on beats.
 *
 * Layout comes from the shot when the director picks one (`f.shot.layout`: word / phrase / stack).
 * Line timing is shared with the other text layers (lyricsTiming.ts). Pure function of the frame.
 */

import { FONT_FAMILY, fontStack } from '../fonts'
import type { RectSpec } from '../layout'
import { createRng, hash32 } from '../random'
import type { Ctx2D, FrameContext, Layer, LayerSpecBase } from '../types'
import { computeLineTimings, lineStateAt, type LineTiming, type TimedWord } from './lyricsTiming'
import { wrapText } from './text'

export type FulltextMode = 'word' | 'phrase' | 'stack'
export const FULLTEXT_MODES: readonly FulltextMode[] = ['word', 'phrase', 'stack']

export interface FulltextSpec extends LayerSpecBase {
  type: 'fulltext'
  /** Area the text fills (default: the whole frame). */
  rect: RectSpec
  /**
   * word = the word being sung; phrase = the line, words revealed as sung; stack = one word per row,
   * each stretched to the width. The director's shot layout wins when it is one of these.
   */
  mode: FulltextMode
  /** alternate = every other line / word; random = seeded with `verticalChance`. */
  orientation: 'horizontal' | 'vertical' | 'alternate' | 'random'
  /** Chance of a vertical line / word with orientation 'random' (raised by the director's chaos). */
  verticalChance: number
  /** What turns: whole lines, or each word in word mode. */
  flipBy: 'line' | 'word'
  fontFamily: string
  fontWeight: number
  uppercase: boolean
  /** Long side of the text as a fraction of the side it runs along; > 1 crops at the edges. */
  fill: number
  /** Cap on the text block height, fraction of the cross side (short words do not get absurd). */
  maxHeight: number
  /** Row spacing, × font size. */
  lineHeight: number
  /** solid / outline letters, or `video`: the picture below shows through the letters. */
  fillStyle: 'solid' | 'outline' | 'video'
  color: string
  /** Word being sung (phrase / stack modes). */
  activeColor: string
  /** Opacity of words not sung yet in phrase / stack modes. */
  futureOpacity: number
  /** video: darkening of the frame outside the letters while text is on screen, 0..1. */
  outsideDim: number
  /** video: extra brightness inside the letters, 0..1. */
  videoBoost: number
  strokeColor: string
  /** Outline width in units (0 = none; outline style uses at least a thin one). */
  strokeWidth: number
  /** Echo outlines behind the text, scaled out step by step; they pulse on beats. */
  echoes: number
  echoSpread: number
  echoOpacity: number
  /** slam = scale down onto the frame; mask = slide in through the row box; mixed = per line by seed. */
  entrance: 'slam' | 'mask' | 'mixed'
  appearSec: number
  appearScale: number
  /** Scale punch of the block on beats. */
  beatPunch: number
  /** Beat shake, units. */
  shake: number
  leadInSec: number
  holdSec: number
  transitionSec: number
}

export const FULLTEXT_DEFAULTS: Omit<FulltextSpec, 'id' | 'type'> = {
  rect: { x: 0, y: 0, w: 1, h: 1, space: 'frame' },
  mode: 'word',
  orientation: 'alternate',
  verticalChance: 0.4,
  flipBy: 'line',
  fontFamily: fontStack(FONT_FAMILY.condensed),
  fontWeight: 700,
  uppercase: true,
  fill: 0.92,
  maxHeight: 0.5,
  lineHeight: 0.9,
  fillStyle: 'solid',
  color: '#ffffff',
  activeColor: '#ffffff',
  futureOpacity: 0.15,
  outsideDim: 0.7,
  videoBoost: 0.6,
  strokeColor: '#ffffff',
  strokeWidth: 0,
  echoes: 0,
  echoSpread: 0.08,
  echoOpacity: 0.35,
  entrance: 'mixed',
  appearSec: 0.12,
  appearScale: 1.4,
  beatPunch: 0.06,
  shake: 0.006,
  leadInSec: 0.05,
  holdSec: 0.5,
  transitionSec: 0.12,
}

interface PlacedWord {
  word: TimedWord
  text: string
  /** Center relative to the block center, unrotated pixels. */
  x: number
  y: number
  width: number
  px: number
}

interface Block {
  words: PlacedWord[]
}

/** Word as drawn this frame. */
interface DrawItem {
  pw: PlacedWord
  alpha: number
  scale: number
  /** Mask entrance: 0..1 slide progress (1 = in place); null = no mask. */
  mask: number | null
  active: boolean
}

/** Share of the cross side a multi-row block may take: room for the camera zoom and the slam. */
const BLOCK_CROSS = 0.7

const visibleWords = (line: LineTiming) => line.words.filter((w) => w.text.trim() !== '')

const easeOut = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1)
  return 1 - (1 - t) * (1 - t) * (1 - t)
}

export class FulltextLayer implements Layer {
  readonly id: string
  private readonly spec: FulltextSpec
  private lyrics: unknown = null
  private timings: LineTiming[] = []
  private sizeKey = ''
  private blocks = new Map<string, Block>()
  private scratch: OffscreenCanvas | null = null

  constructor(spec: FulltextSpec) {
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
      this.blocks.clear()
    }
    const r = f.rect(s.rect)
    const key = `${r.w}|${r.h}`
    if (key !== this.sizeKey) {
      this.sizeKey = key
      this.blocks.clear()
      // Measure every block up front (all modes, both orientations): a frame then never measures
      // text, so it issues the same drawing commands whatever was rendered before it.
      for (const line of this.timings) {
        const words = visibleWords(line)
        for (const vertical of [false, true]) {
          for (const mode of ['phrase', 'stack'] as const)
            this.blockFor(g, line, words, mode, vertical, r)
          for (const w of words) this.blockFor(g, line, [w], 'word', vertical, r)
        }
      }
    }
    const mode = FULLTEXT_MODES.includes(f.shot.layout as FulltextMode)
      ? (f.shot.layout as FulltextMode)
      : s.mode
    const t = f.time
    for (const line of this.timings) {
      const state = lineStateAt(line, t, s.transitionSec)
      if (!state || state.slot > 0.999 || t < line.appear) continue
      this.drawLine(g, f, line, mode, r, state.slot < 0 ? -state.slot : 0)
    }
  }

  private drawLine(
    g: Ctx2D,
    f: FrameContext,
    line: LineTiming,
    mode: FulltextMode,
    r: { x: number; y: number; w: number; h: number },
    leaving: number,
  ) {
    const s = this.spec
    const t = f.time
    let words = visibleWords(line)
    let unit: { id: string; index: number } = { id: line.id, index: line.lineIndex }
    if (mode === 'word') {
      let current = -1
      words.forEach((w, i) => {
        if (w.start <= t) current = i
      })
      const w = words[current]
      if (!w) return
      words = [w]
      if (s.flipBy === 'word') unit = { id: w.id, index: line.lineIndex * 64 + current }
    }
    const vertical = this.isVertical(f, unit)
    const block = this.blockFor(g, line, words, mode, vertical, r)

    // Block motion: beat punch and shake follow the shot intensity; leaving lines blow up and fade.
    const kick = f.beat.index >= 0 ? f.beat.strength * Math.exp(-f.beat.since / 0.12) : 0
    const intensity = f.shot.intensity
    const blockScale = (1 + s.beatPunch * kick * intensity) * (1 + 0.25 * leaving)
    const blockAlpha = 1 - leaving
    if (blockAlpha <= 0.002) return
    const shakeRng = createRng(hash32(f.seed, 'shake', f.beat.index))
    const amp = s.shake * f.layout.unit * kick * intensity * (1 + f.shot.chaos)
    const cx = r.x + r.w / 2 + (shakeRng() - 0.5) * 2 * amp
    const cy = r.y + r.h / 2 + (shakeRng() - 0.5) * 2 * amp
    const angle = vertical ? -Math.PI / 2 : 0
    const entrance =
      s.entrance === 'mixed'
        ? createRng(hash32(f.seed, 'entrance', unit.id))() < 0.5
          ? 'slam'
          : 'mask'
        : s.entrance

    const items: DrawItem[] = []
    for (const pw of block.words) {
      const since = t - pw.word.start
      const sung = since >= 0 || mode === 'word'
      const k = mode === 'word' ? Math.max(since, 0) : since
      const appear = sung ? easeOut(k / Math.max(s.appearSec, 1e-3)) : 0
      const alpha = (sung ? Math.min(1, appear * 2) : s.futureOpacity) * blockAlpha
      if (alpha <= 0.002) continue
      const slam = entrance === 'slam' && sung
      items.push({
        pw,
        alpha,
        scale: slam ? s.appearScale + (1 - s.appearScale) * appear : 1,
        mask: entrance === 'mask' && sung ? appear : null,
        active: sung && t < pw.word.end,
      })
      // Word boxes in frame pixels (before the layer camera), rotated with the block.
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const lx = pw.x * blockScale
      const ly = pw.y * blockScale
      const w = pw.width * blockScale
      const h = pw.px * blockScale
      f.words.place({
        wordId: pw.word.id,
        x: cx + lx * cos - ly * sin,
        y: cy + lx * sin + ly * cos,
        width: vertical ? h : w,
        height: vertical ? w : h,
        start: pw.word.start,
        end: pw.word.end,
      })
    }
    if (items.length === 0) return

    const place = (ctx: Ctx2D) => {
      ctx.translate(cx, cy)
      if (angle) ctx.rotate(angle)
      ctx.scale(blockScale, blockScale)
    }
    const unitPx = f.layout.unit

    // Echoes: outlines scaled out from the block, breathing with the beat.
    if (s.echoes > 0) {
      g.save()
      place(g)
      g.strokeStyle = s.strokeColor
      for (let e = s.echoes; e >= 1; e--) {
        const sc = 1 + e * s.echoSpread * (1 + 0.8 * kick * intensity)
        g.save()
        g.scale(sc, sc)
        g.lineWidth = Math.max(unitPx * 0.002, 1) / sc
        const a = s.echoOpacity * (1 - e / (s.echoes + 1))
        for (const it of items) this.drawWord(g, it, 'stroke', a)
        g.restore()
      }
      g.restore()
    }

    const strokePx = Math.max(
      s.strokeWidth * unitPx,
      s.fillStyle === 'outline' ? unitPx * 0.003 : 0,
    )
    if (s.fillStyle === 'video' && this.drawVideoFill(g, place, items, blockAlpha)) {
      // Picture inside the letters; the active word gets an outline in the active color.
      if (strokePx > 0 || s.activeColor !== s.color) {
        g.save()
        place(g)
        g.lineWidth = Math.max(strokePx, unitPx * 0.002) / blockScale
        for (const it of items) {
          g.strokeStyle = it.active ? s.activeColor : s.strokeColor
          if (strokePx > 0 || it.active) this.drawWord(g, it, 'stroke', 1)
        }
        g.restore()
      }
      return
    }

    g.save()
    place(g)
    for (const it of items) {
      if (s.fillStyle !== 'outline') {
        g.fillStyle = it.active ? s.activeColor : s.color
        this.drawWord(g, it, 'fill', 1)
      }
      if (strokePx > 0) {
        g.strokeStyle = s.fillStyle === 'outline' && it.active ? s.activeColor : s.strokeColor
        g.lineWidth = strokePx
        this.drawWord(g, it, 'stroke', 1)
      }
    }
    g.restore()
  }

  /** One word in block coordinates (context already placed), with its entrance. */
  private drawWord(g: Ctx2D, it: DrawItem, how: 'fill' | 'stroke', alpha: number) {
    const s = this.spec
    const { pw } = it
    g.save()
    g.globalAlpha *= Math.min(it.alpha * alpha, 1)
    g.font = `${s.fontWeight} ${pw.px}px ${s.fontFamily}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.translate(pw.x, pw.y)
    if (it.mask !== null) {
      // Slide up into the row box, clipped by it: the word rises from behind an invisible edge.
      const h = pw.px * s.lineHeight
      g.beginPath()
      g.rect(-pw.width, -h / 2, pw.width * 2, h)
      g.clip()
      g.translate(0, (1 - it.mask) * h)
    }
    if (it.scale !== 1) g.scale(it.scale, it.scale)
    if (how === 'fill') g.fillText(pw.text, 0, 0)
    else g.strokeText(pw.text, 0, 0)
    g.restore()
  }

  /**
   * Letters filled with the frame below: copy the frame, keep it only inside the letters, dim the
   * frame, put the letters back on top. False when it cannot run (no OffscreenCanvas — tests).
   */
  private drawVideoFill(
    g: Ctx2D,
    place: (ctx: Ctx2D) => void,
    items: DrawItem[],
    blockAlpha: number,
  ): boolean {
    const s = this.spec
    const src = g.canvas as unknown
    if (typeof OffscreenCanvas === 'undefined' || typeof src !== 'object' || src === null)
      return false
    if (typeof g.getTransform !== 'function') return false
    const { width, height } = src as { width: number; height: number }
    if (!this.scratch || this.scratch.width !== width || this.scratch.height !== height) {
      this.scratch = new OffscreenCanvas(width, height)
    }
    const m = this.scratch.getContext('2d')
    if (!m) return false
    m.setTransform(1, 0, 0, 1, 0, 0)
    m.globalAlpha = 1
    m.globalCompositeOperation = 'copy'
    m.drawImage(src as CanvasImageSource, 0, 0)
    if (s.videoBoost > 0) {
      m.globalCompositeOperation = 'lighter'
      m.globalAlpha = s.videoBoost
      m.drawImage(src as CanvasImageSource, 0, 0)
    }
    // Keep the copy only inside the letters (same transform as the layer, letters at full alpha).
    m.globalAlpha = 1
    m.globalCompositeOperation = 'destination-in'
    m.setTransform(g.getTransform())
    place(m)
    m.fillStyle = '#ffffff'
    for (const it of items) this.drawWord(m, it, 'fill', 1)

    const layerAlpha = g.globalAlpha
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalCompositeOperation = 'source-over'
    if (s.outsideDim > 0) {
      g.globalAlpha = layerAlpha * s.outsideDim * blockAlpha
      g.fillStyle = '#000000'
      g.fillRect(0, 0, width, height)
    }
    g.globalAlpha = layerAlpha
    g.drawImage(this.scratch, 0, 0)
    g.restore()
    return true
  }

  private isVertical(f: FrameContext, unit: { id: string; index: number }): boolean {
    const s = this.spec
    switch (s.orientation) {
      case 'horizontal':
        return false
      case 'vertical':
        return true
      case 'alternate':
        // Parity flipped per section variant, so sections do not all start the same way.
        return ((unit.index + (f.shot.variant & 1)) & 1) === 1
      case 'random': {
        const p = Math.min(s.verticalChance * (0.6 + 0.8 * f.shot.chaos), 0.95)
        return createRng(hash32(f.seed, 'vertical', unit.id))() < p
      }
    }
  }

  private blockFor(
    g: Ctx2D,
    line: LineTiming,
    words: TimedWord[],
    mode: FulltextMode,
    vertical: boolean,
    r: { w: number; h: number },
  ): Block {
    const s = this.spec
    const key = `${mode}|${vertical ? 'v' : 'h'}|${words[0]?.id ?? ''}|${line.id}`
    const runLen = (vertical ? r.h : r.w) * s.fill
    return this.block(g, key, words, mode, runLen, vertical ? r.w : r.h)
  }

  /** Word positions for a block, measured once per (mode, orientation, size). */
  private block(
    g: Ctx2D,
    key: string,
    words: TimedWord[],
    mode: FulltextMode,
    runLen: number,
    crossLen: number,
  ): Block {
    const cached = this.blocks.get(key)
    if (cached) return cached
    const s = this.spec
    const texts = words.map((w) => (s.uppercase ? w.text.toLocaleUpperCase() : w.text).trim())
    const REF = 100
    g.save()
    g.font = `${s.fontWeight} ${REF}px ${s.fontFamily}`
    const measure = (text: string, px: number) => (g.measureText(text).width * px) / REF
    const maxPx = (crossLen * s.maxHeight) / Math.max(s.lineHeight, 0.5)
    const placed: PlacedWord[] = []

    if (mode === 'stack' || mode === 'word') {
      // Each word stretched to the run length (capped), rows shrunk together to fit the cross side.
      const sizes = texts.map((text) =>
        Math.min((runLen / Math.max(measure(text, REF), 1)) * REF, maxPx),
      )
      const total = sizes.reduce((a, px) => a + px * s.lineHeight, 0)
      const k = Math.min(1, (crossLen * BLOCK_CROSS) / Math.max(total, 1))
      let y = -(total * k) / 2
      texts.forEach((text, i) => {
        const px = (sizes[i] ?? REF) * k
        const h = px * s.lineHeight
        placed.push({ word: words[i]!, text, x: 0, y: y + h / 2, width: measure(text, px), px })
        y += h
      })
    } else {
      // Phrase: wrap to the run length, as large as fits.
      let px = maxPx
      let rows: string[] = []
      for (let attempt = 0; attempt < 30; attempt++) {
        rows = wrapText(texts.join(' '), runLen, (str) => measure(str, px))
        const widest = Math.max(0, ...rows.map((row) => measure(row, px)))
        if (rows.length * px * s.lineHeight <= crossLen * BLOCK_CROSS && widest <= runLen) break
        px *= 0.92
      }
      const lh = px * s.lineHeight
      let wi = 0
      rows.forEach((row, ri) => {
        const y = (ri - (rows.length - 1) / 2) * lh
        const rowW = measure(row, px)
        let prefix = ''
        for (const text of row.split(' ')) {
          const word = words[wi]
          const own = texts[wi++]
          if (!word || own === undefined) break
          const before = prefix ? `${prefix} ` : ''
          const x0 = measure(before, px)
          const w = measure(text, px)
          prefix = before + text
          placed.push({ word, text, x: -rowW / 2 + x0 + w / 2, y, width: w, px })
        }
      })
    }
    g.restore()
    const block = { words: placed }
    this.blocks.set(key, block)
    return block
  }
}
