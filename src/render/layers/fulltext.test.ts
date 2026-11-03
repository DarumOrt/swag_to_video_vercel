import { describe, expect, it } from 'vitest'
import type { RenderCanvas } from '@/shared'
import { createFakeTimeline } from '../dev/fakeTimeline'
import type { EffectFactory } from '../effectsHost'
import { SceneRenderer } from '../SceneRenderer'
import type { SceneInput } from '../scene'
import { createRecordingCanvas } from '../testing/recordingCanvas'
import type { WordBox } from '../words'
import type { FulltextSpec } from './fulltext'

const timeline = createFakeTimeline({ durationSec: 20 })
// A frame inside a sung word (lyrics start at bar 3, one word per beat at 120 bpm).
const FRAME = Math.round((timeline.lyrics!.lines[1]!.words[2]!.start! + 0.1) * 30)

async function wordsAt(spec: Partial<FulltextSpec>, frame = FRAME, size = [1080, 1920]) {
  const boxes: (readonly WordBox[])[] = []
  const factory: EffectFactory = (s) =>
    s.type === 'probe' ? { id: s.id, overlay: (_g, f) => boxes.push(f.words.all()) } : null
  const { canvas, log } = createRecordingCanvas()
  const r = new SceneRenderer({ createEffect: factory, effectFontFamilies: () => [] })
  const scene: SceneInput = {
    layers: [{ id: 'ft', type: 'fulltext', ...spec }],
    effects: [{ id: 'probe', type: 'probe' }],
  }
  await r.init({
    canvas: canvas as unknown as RenderCanvas,
    width: size[0]!,
    height: size[1]!,
    fps: 30,
    timeline,
    scene,
  })
  boxes.length = 0
  log.length = 0
  r.renderFrame(frame)
  const first = structuredClone(log)
  r.renderFrame(frame + 40)
  log.length = 0
  r.renderFrame(frame)
  return { boxes: boxes[0] ?? [], first, again: structuredClone(log) }
}

describe('fulltext layer', () => {
  it('word mode: one huge word spanning most of the frame width', async () => {
    const { boxes } = await wordsAt({ mode: 'word', orientation: 'horizontal', fill: 0.9 })
    expect(boxes).toHaveLength(1)
    const b = boxes[0]!
    expect(b.width).toBeGreaterThan(1080 * 0.5)
    expect(b.width).toBeLessThanOrEqual(1080 * 0.9 * 1.3 + 1)
    expect(b.x).toBeCloseTo(540, 0)
  })

  it('vertical: the word runs along the frame height', async () => {
    const h = (await wordsAt({ mode: 'word', orientation: 'horizontal', maxHeight: 1 })).boxes[0]!
    const v = (await wordsAt({ mode: 'word', orientation: 'vertical', maxHeight: 1 })).boxes[0]!
    expect(h.width).toBeGreaterThan(h.height)
    expect(v.height).toBeGreaterThan(v.width)
    expect(v.height).toBeGreaterThan(h.width)
  })

  it('phrase and stack modes place the line words, stack rows one under another', async () => {
    const phrase = (await wordsAt({ mode: 'phrase', orientation: 'horizontal' })).boxes
    const stack = (await wordsAt({ mode: 'stack', orientation: 'horizontal' })).boxes
    expect(phrase.length).toBeGreaterThan(1)
    expect(stack.length).toBe(phrase.length)
    const ys = stack.map((b) => b.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
  })

  it('is deterministic: the same frame issues the same commands in every style', async () => {
    for (const fillStyle of ['solid', 'outline', 'video'] as const) {
      const r = await wordsAt({ mode: 'stack', fillStyle, echoes: 2, orientation: 'random' })
      expect(r.first.length).toBeGreaterThan(5)
      expect(r.again).toEqual(r.first)
    }
  })

  it('alternate orientation flips between lines', async () => {
    const lines = timeline.lyrics!.lines
    const at = (li: number) => Math.round((lines[li]!.words[1]!.start! + 0.05) * 30)
    const a = (await wordsAt({ mode: 'word', orientation: 'alternate' }, at(0))).boxes[0]!
    const b = (await wordsAt({ mode: 'word', orientation: 'alternate' }, at(1))).boxes[0]!
    expect(a.width > a.height).not.toBe(b.width > b.height)
  })
})
