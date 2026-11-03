import { describe, expect, it } from 'vitest'
import type { LyricWord, RenderCanvas, Timeline } from '@/shared'
import { createFakeTimeline } from '../dev/fakeTimeline'
import type { EffectFactory } from '../effectsHost'
import { computeLayout } from '../layout'
import { SceneRenderer } from '../SceneRenderer'
import type { SceneInput } from '../scene'
import { createRecordingCanvas } from '../testing/recordingCanvas'
import type { WordBox } from '../words'
import type { KineticSpec } from './kinetic'
import type { LyricsSpec } from './lyrics'
import { computeLineTimings } from './lyricsTiming'
import { animState, lineWindows, popState, typedChars } from './textReveal'

const FPS = 30
const word = (id: string, text: string, start: number, end: number): LyricWord => ({
  id,
  text,
  start,
  end,
  confidence: null,
  timingSource: 'manual',
})

// L0: three words 1..2.5 s; L1: two words 3..4 s; L2: one short word after a pause.
const base = createFakeTimeline({ durationSec: 10 })
const timeline: Timeline = {
  ...base,
  lyrics: {
    language: 'ru',
    lines: [
      {
        id: 'L0',
        words: [
          word('a', 'привет', 1, 1.6),
          word('b', 'ночной', 1.6, 2),
          word('c', 'город', 2, 2.5),
        ],
      },
      { id: 'L1', words: [word('d', 'свет', 3, 3.5), word('e', 'горит', 3.5, 4)] },
      { id: 'L2', words: [word('f', 'да', 6, 6.4)] },
    ],
  },
}

const frameAt = (t: number) => Math.round(t * FPS)

async function render(
  layer: Record<string, unknown>,
  t: number,
  size: [number, number] = [1080, 1920],
) {
  const boxes: (readonly WordBox[])[] = []
  const factory: EffectFactory = (s) =>
    s.type === 'probe' ? { id: s.id, overlay: (_g, f) => boxes.push([...f.words.all()]) } : null
  const { canvas, log } = createRecordingCanvas()
  const r = new SceneRenderer({ createEffect: factory, effectFontFamilies: () => [] })
  const scene: SceneInput = {
    layers: [{ id: 'txt', ...layer } as SceneInput['layers'][number]],
    effects: [{ id: 'probe', type: 'probe' }],
  }
  await r.init({
    canvas: canvas as unknown as RenderCanvas,
    width: size[0],
    height: size[1],
    fps: FPS,
    timeline,
    scene,
  })
  boxes.length = 0
  log.length = 0
  r.renderFrame(frameAt(t))
  const first = structuredClone(log)
  const words = boxes[0] ?? []
  r.renderFrame(frameAt(t) + 37)
  log.length = 0
  r.renderFrame(frameAt(t))
  const texts = first.filter((c) => c[0] === 'fillText').map((c) => c[1] as string)
  r.dispose()
  return { ids: words.map((b) => b.wordId), words, texts, first, again: structuredClone(log) }
}

const lyrics = (spec: Partial<LyricsSpec>) => ({ type: 'lyrics', pulse: null, ...spec })
const kinetic = (spec: Partial<KineticSpec>) => ({ type: 'kinetic', ...spec })

describe('textReveal helpers', () => {
  it('animations reach the resting state at p = 1 and are hidden at p = 0', () => {
    for (const a of ['fade', 'slide-up', 'scale', 'blur'] as const) {
      expect(animState(a, 1)).toEqual({ alpha: 1, dy: 0, scale: 1, blur: 0 })
      expect(animState(a, 0).alpha).toBe(0)
    }
    expect(animState('slide-up', 0.3).dy).toBeGreaterThan(0)
    expect(animState('slide-up', 0.3, true).dy).toBeLessThan(0)
    expect(animState('none', 0.01).alpha).toBe(1)
  })

  it('pop overshoots and settles', () => {
    expect(popState(-0.1, 0.25).alpha).toBe(0)
    expect(popState(0.17, 0.25).scale).toBeGreaterThan(1.05)
    expect(popState(1, 0.25).scale).toBeCloseTo(1)
  })

  it('typewriter types within the word timing', () => {
    expect(typedChars({ start: 1, end: 2 }, 4, 0.9)).toBe(0)
    expect(typedChars({ start: 1, end: 2 }, 4, 1.5)).toBeCloseTo(2)
    expect(typedChars({ start: 1, end: 2 }, 4, 3)).toBe(4)
  })

  it('line windows: line-end vs next-line, `line` shows at the lead-in', () => {
    const tl = computeLineTimings(timeline.lyrics!.lines, {
      leadInSec: 0.6,
      holdSec: 1.2,
      previewLeadSec: 0,
      transitionSec: 0.3,
    })
    const end = lineWindows(tl, 'word', 'line-end', 1.2)
    expect(end.map((w) => w.show)).toEqual([1, 3, 6])
    end.forEach((w, i) => expect(w.hide).toBeCloseTo([3, 5.2, 7.6][i]!))
    const next = lineWindows(tl, 'word', 'next-line', 1.2)
    expect(next[1]?.hide).toBe(6)
    expect(lineWindows(tl, 'line', 'line-end', 1.2)[0]?.show).toBeCloseTo(0.4)
  })
})

describe('lyrics reveal modes: what is on screen at t', () => {
  it('karaoke shows the whole current line (and the preview)', async () => {
    const { ids } = await render(lyrics({ reveal: 'karaoke' }), 1.7)
    expect(ids).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })

  it('word: words appear at their timing and stay until the line leaves', async () => {
    expect((await render(lyrics({ reveal: 'word' }), 1.7)).ids).toEqual(['a', 'b'])
    expect((await render(lyrics({ reveal: 'word' }), 2.8)).ids).toEqual(['a', 'b', 'c'])
    expect((await render(lyrics({ reveal: 'word' }), 0.9)).ids).toEqual([])
    // Next line: the previous one is gone (no exit animation), only the sung word of L1.
    expect((await render(lyrics({ reveal: 'word', anim: 'none' }), 3.2)).ids).toEqual(['d'])
  })

  it('word-solo: only the current word', async () => {
    expect((await render(lyrics({ reveal: 'word-solo' }), 1.7)).ids).toEqual(['b'])
    expect((await render(lyrics({ reveal: 'word-solo' }), 2.2)).ids).toEqual(['c'])
  })

  it('line: the whole line appears at its lead-in', async () => {
    const r = await render(lyrics({ reveal: 'line', anim: 'none' }), 0.5)
    expect(r.ids).toEqual(['a', 'b', 'c'])
  })

  it('typewriter: letters within the word timing', async () => {
    // 'привет' 1..1.6: half way = 3 letters.
    const r = await render(lyrics({ reveal: 'typewriter' }), 1.3)
    expect(r.texts).toContain('при')
    expect(r.texts).not.toContain('привет')
    expect(r.ids).toEqual(['a'])
  })

  it('pop: the new word overshoots, then settles', async () => {
    const popping = (await render(lyrics({ reveal: 'pop', animSec: 0.25 }), 1 + 5 / FPS)).words
    const settled = (await render(lyrics({ reveal: 'pop', animSec: 0.25 }), 1.55)).words
    expect(popping[0]!.width).toBeGreaterThan(settled[0]!.width * 1.03)
  })

  it('slide-up enters from below', async () => {
    const mid = (await render(lyrics({ reveal: 'word', anim: 'slide-up' }), 1 + 2 / FPS)).words
    const rest = (await render(lyrics({ reveal: 'word', anim: 'slide-up' }), 1.5)).words
    expect(mid[0]!.y).toBeGreaterThan(rest[0]!.y + 5)
  })

  it('exit: next-line keeps the line through the pause, line-end does not', async () => {
    expect((await render(lyrics({ reveal: 'word', exit: 'line-end' }), 5.5)).ids).toEqual([])
    expect((await render(lyrics({ reveal: 'word', exit: 'next-line' }), 5.5)).ids).toEqual([
      'd',
      'e',
    ])
  })

  it('short one-word lines work in every mode', async () => {
    for (const reveal of ['karaoke', 'word', 'word-solo', 'line', 'typewriter', 'pop'] as const) {
      const r = await render(lyrics({ reveal, anim: 'none' }), 6.3)
      expect(r.ids, reveal).toContain('f')
    }
  })

  it('is deterministic in every mode and animation', async () => {
    for (const reveal of ['karaoke', 'word', 'word-solo', 'line', 'typewriter', 'pop'] as const) {
      for (const anim of ['fade', 'blur', 'slide-up'] as const) {
        const r = await render(lyrics({ reveal, anim }), 1.62)
        expect(r.first.length, `${reveal}/${anim}`).toBeGreaterThan(3)
        expect(r.again, `${reveal}/${anim}`).toEqual(r.first)
      }
    }
  })
})

describe('text scale and auto-fit', () => {
  const safe = computeLayout(1080, 1920, 'social').safe
  const inside = (b: WordBox) =>
    b.x - b.width / 2 >= safe.x - 1 &&
    b.x + b.width / 2 <= safe.x + safe.w + 1 &&
    b.y - b.height / 2 >= safe.y - 1 &&
    b.y + b.height / 2 <= safe.y + safe.h + 1

  it('scales the text', async () => {
    const one = (await render(lyrics({ reveal: 'line', anim: 'none', scale: 1 }), 3.2)).words
    const half = (await render(lyrics({ reveal: 'line', anim: 'none', scale: 0.5 }), 3.2)).words
    expect(half[0]!.width / one[0]!.width).toBeCloseTo(0.5, 1)
  })

  it('at max scale a long line wraps / shrinks and stays inside the safe area', async () => {
    for (const reveal of ['karaoke', 'line', 'word-solo'] as const) {
      for (const size of [
        [1080, 1920],
        [1920, 1080],
        [1080, 1080],
      ] as [number, number][]) {
        const r = await render(
          lyrics({ reveal, anim: 'none', scale: 2.5, showNext: false }),
          2.3,
          size,
        )
        const s = computeLayout(size[0], size[1], 'social').safe
        expect(r.words.length).toBeGreaterThan(0)
        for (const b of r.words) {
          expect(b.x - b.width / 2, `${reveal} ${size}`).toBeGreaterThanOrEqual(s.x - 1)
          expect(b.x + b.width / 2, `${reveal} ${size}`).toBeLessThanOrEqual(s.x + s.w + 1)
          expect(b.y - b.height / 2, `${reveal} ${size}`).toBeGreaterThanOrEqual(s.y - 1)
          expect(b.y + b.height / 2, `${reveal} ${size}`).toBeLessThanOrEqual(s.y + s.h + 1)
        }
      }
    }
  })

  it('wraps scaled-up text to more rows instead of only shrinking', async () => {
    const r = await render(lyrics({ reveal: 'line', anim: 'none', scale: 2.5, maxRows: 2 }), 2.3)
    const rows = new Set(r.words.map((b) => Math.round(b.y)))
    expect(rows.size).toBeGreaterThanOrEqual(2)
    expect(r.words.every(inside)).toBe(true)
  })

  it('kinetic: scale enlarges the words within its rect', async () => {
    const one = (await render(kinetic({ mode: 'focus', anim: 'none' }), 6.3)).words
    const big = (await render(kinetic({ mode: 'focus', anim: 'none', scale: 2 }), 6.3)).words
    expect(big[0]!.height / one[0]!.height).toBeCloseTo(2, 1)
    expect(big.every(inside)).toBe(true)
  })
})

describe('kinetic reveal modes', () => {
  it('line shows every word of the line at once, word only the sung ones', async () => {
    const line = await render(kinetic({ reveal: 'line', anim: 'none' }), 1.2)
    const words = await render(kinetic({ reveal: 'word' }), 1.2)
    expect(line.ids).toEqual(['a', 'b', 'c'])
    expect(words.ids).toEqual(['a'])
  })

  it('typewriter types letters, pop and the other modes are deterministic', async () => {
    expect((await render(kinetic({ reveal: 'typewriter' }), 1.3)).texts).toContain('при')
    for (const reveal of ['word', 'line', 'typewriter', 'pop'] as const) {
      for (const mode of ['flow', 'stack', 'focus'] as const) {
        const r = await render(kinetic({ reveal, mode, anim: 'blur' }), 1.62)
        expect(r.again, `${reveal}/${mode}`).toEqual(r.first)
      }
    }
  })
})
