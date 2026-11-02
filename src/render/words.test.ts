import { describe, expect, it } from 'vitest'
import type { RenderCanvas } from '@/shared'
import { createFakeTimeline } from './dev/fakeTimeline'
import type { Effect, EffectFactory } from './effectsHost'
import type { LayerSpecInput } from './scene'
import { SceneRenderer } from './SceneRenderer'
import { createRecordingCanvas } from './testing/recordingCanvas'
import { projectWord, WordCollector, type WordBox, type WordPlacement } from './words'

const word = (id: string, x: number, y: number, start = 0, end = 1): WordPlacement => ({
  wordId: id,
  x,
  y,
  width: 100,
  height: 40,
  start,
  end,
})

describe('projectWord', () => {
  it('keeps positions without a camera', () => {
    expect(projectWord(word('a', 10, 20), 'l', null, 1080, 1920, 1080)).toMatchObject({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
    })
  })

  it('applies zoom, rotation and offset about the frame center like applyCamera', () => {
    const cam = { zoom: 2, rotation: Math.PI / 2, x: 0.1, y: 0 }
    const b = projectWord(word('a', 640, 960), 'l', cam, 1080, 1920, 1080)
    // 100 px right of center → ×2 → rotated 90° clockwise (y down) → 200 px below; +108 px in x.
    expect(b.x).toBeCloseTo(540 + 108)
    expect(b.y).toBeCloseTo(960 + 200)
    expect(b.width).toBeCloseTo(80)
    expect(b.height).toBeCloseTo(200)
  })
})

describe('WordCollector', () => {
  it('returns the topmost box of a word and the active word by time', () => {
    const c = new WordCollector(1080, 1920, 1080)
    c.scope('lyrics', null).place(word('a', 1, 1, 0, 1))
    c.scope('lyrics', null).place(word('b', 2, 2, 1, 2))
    c.scope('kinetic', null).place(word('a', 3, 3, 0, 1))
    const v = c.view()
    expect(v.get('a')?.layerId).toBe('kinetic')
    expect(v.get('zzz')).toBeNull()
    expect(v.active(0.5)?.x).toBe(3)
    expect(v.active(1.5)?.wordId).toBe('b')
    // Between words: the last one that started.
    expect(v.active(5)?.wordId).toBe('b')
    expect(v.active(-1)).toBeNull()
    expect(v.all()).toHaveLength(3)
  })
})

describe('word positions in the engine', () => {
  const timeline = createFakeTimeline({ durationSec: 8 })
  // Fake lyrics: word w0-0 "свет" from 4.0 s; frame 126 = 4.2 s.
  const frame = 126

  async function capture(layers: LayerSpecInput[], camera?: (zoom: number) => void) {
    const seen: { camera: WordBox[]; overlay: WordBox[]; active: WordBox | null } = {
      camera: [],
      overlay: [],
      active: null,
    }
    const fx: Effect = {
      id: 'probe',
      camera(f, cam) {
        seen.camera = [...f.words.all()]
        if (camera) camera((cam.zoom *= 2))
      },
      overlay(_g, f) {
        seen.overlay = [...f.words.all()]
        seen.active = f.words.active(f.time)
      },
    }
    const factory: EffectFactory = () => fx
    const { canvas } = createRecordingCanvas()
    const r = new SceneRenderer({ createEffect: factory })
    await r.init({
      canvas: canvas as unknown as RenderCanvas,
      width: 1080,
      height: 1920,
      fps: 30,
      timeline,
      scene: { layers, effects: [{ id: 'probe', type: 'probe' }] },
    })
    r.renderFrame(frame)
    return seen
  }

  it('gives overlays the active karaoke word inside the frame', async () => {
    const seen = await capture([{ id: 'lyrics', type: 'lyrics' }])
    expect(seen.camera).toEqual([])
    const a = seen.active
    expect(a?.wordId).toBe('w0-0')
    expect(a?.layerId).toBe('lyrics')
    expect(a!.x).toBeGreaterThan(0)
    expect(a!.x).toBeLessThan(1080)
    // Lyrics rect is y 0.27–0.53 of the safe area: the word sits in the upper half.
    expect(a!.y).toBeGreaterThan(300)
    expect(a!.y).toBeLessThan(1100)
    expect(a!.width).toBeGreaterThan(0)
    // The rest of the line (and the preview line) is there too, left of / below the active word.
    const next = seen.overlay.find((b) => b.wordId === 'w0-1')
    expect(next!.x).toBeGreaterThan(a!.x)
  })

  it('reports kinetic words, through the camera', async () => {
    const plain = await capture([{ id: 'k', type: 'kinetic' }])
    const zoomed = await capture([{ id: 'k', type: 'kinetic' }], () => {})
    const a = plain.active!
    const b = zoomed.active!
    expect(a.wordId).toBe('w0-0')
    expect(b.wordId).toBe('w0-0')
    // Zoom ×2 about the center doubles the offset from the center and the size.
    expect(b.x - 540).toBeCloseTo((a.x - 540) * 2)
    expect(b.y - 960).toBeCloseTo((a.y - 960) * 2)
    expect(b.width).toBeCloseTo(a.width * 2)
  })

  it('is the same on a repeated frame', async () => {
    const one = await capture([{ id: 'lyrics', type: 'lyrics' }])
    const two = await capture([{ id: 'lyrics', type: 'lyrics' }])
    expect(two.overlay).toEqual(one.overlay)
  })
})
