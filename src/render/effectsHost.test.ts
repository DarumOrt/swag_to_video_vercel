import { describe, expect, it } from 'vitest'
import type { RenderCanvas, Timeline } from '@/shared'
import { createFakeTimeline } from './dev/fakeTimeline'
import type { Effect, EffectFactory } from './effectsHost'
import { beatAt, lastIndexAtOrBefore, sectionAt } from './rhythm'
import { SceneRenderer } from './SceneRenderer'
import { createRecordingCanvas } from './testing/recordingCanvas'

const timeline = createFakeTimeline({ durationSec: 20 })

async function setup(factory: EffectFactory, effects: { id: string; type: string }[]) {
  const { canvas, log } = createRecordingCanvas()
  const r = new SceneRenderer({ createEffect: factory })
  await r.init({
    canvas: canvas as unknown as RenderCanvas,
    width: 1080,
    height: 1920,
    fps: 30,
    timeline,
    scene: {
      layers: [
        { id: 'bg', type: 'background' },
        { id: 't', type: 'text', text: 'x' },
      ],
      effects,
    },
  })
  return {
    render(frame: number) {
      log.length = 0
      r.renderFrame(frame)
      return structuredClone(log)
    },
  }
}

describe('effect hooks', () => {
  it('composes the camera and applies it to layers except the background', async () => {
    const zoom = (k: number): Effect => ({ id: 'z', camera: (_f, cam) => void (cam.zoom *= k) })
    const { render } = await setup(
      (spec) => (spec.type === 'zoom' ? zoom(spec.id === 'a' ? 2 : 1.5) : null),
      [
        { id: 'a', type: 'zoom' },
        { id: 'b', type: 'zoom' },
        { id: 'c', type: 'unknown' },
      ],
    )
    const log = render(10)
    const scales = log.filter((c) => c[0] === 'scale' && c[1] === 3)
    // One camera scale (2 × 1.5) for the text layer; the background has none.
    expect(scales.length).toBe(1)
  })

  it('draws overlays after layers, in screen space', async () => {
    const { render } = await setup(
      () => ({ id: 'o', overlay: (g) => g.fillRect(1, 2, 3, 4) }),
      [{ id: 'o', type: 'overlay' }],
    )
    const log = render(5)
    const overlay = log.findIndex((c) => c[0] === 'fillRect' && c[1] === 1 && c[4] === 4)
    const lastText = log.map((c) => c[0]).lastIndexOf('fillText')
    expect(overlay).toBeGreaterThan(lastText)
  })

  it('passes warped time to layers and keeps the base time', async () => {
    const seen: [number, number][] = []
    const { render } = await setup(
      () => ({
        id: 'slow',
        remapTime: (t) => t / 2,
        overlay: (_g, f) => void seen.push([f.time, f.baseTime]),
      }),
      [{ id: 's', type: 'slow' }],
    )
    seen.length = 0
    render(60)
    expect(seen).toEqual([[1, 2]])
  })

  it('gives each effect a seeded rng that depends on the frame', async () => {
    const draws: number[] = []
    const { render } = await setup(
      () => ({ id: 'r', overlay: (_g, f) => void draws.push(f.rng('x')()) }),
      [{ id: 'r', type: 'r' }],
    )
    draws.length = 0
    render(7)
    render(8)
    render(7)
    expect(draws[0]).toBe(draws[2])
    expect(draws[0]).not.toBe(draws[1])
  })
})

describe('rhythm lookup', () => {
  it('binary-searches sorted arrays', () => {
    const a = Float32Array.from([0, 1, 2, 3])
    expect(lastIndexAtOrBefore(a, -1)).toBe(-1)
    expect(lastIndexAtOrBefore(a, 1.5)).toBe(1)
    expect(lastIndexAtOrBefore(a, 9)).toBe(3)
  })

  it('reports beat phase, strength and downbeats', () => {
    const b = beatAt(timeline, 2.25) // 120 bpm: beat 4 at 2.0 s is a downbeat
    expect(b.index).toBe(4)
    expect(b.downbeat).toBe(true)
    expect(b.phase).toBeCloseTo(0.5)
    expect(b.strength).toBeGreaterThan(0)
    expect(beatAt(timeline, 2.6).downbeat).toBe(false)
  })

  it('falls back to the low band without beatStrength, and handles no sections', () => {
    const bare: Timeline = {
      ...timeline,
      audio: {
        ...timeline.audio,
        sections: undefined,
        rhythm: { ...timeline.audio.rhythm, beatStrength: undefined },
      },
    }
    expect(beatAt(bare, 4.01).strength).toBeGreaterThan(0)
    expect(sectionAt(bare, 5)).toBeNull()
    expect(sectionAt(timeline, 0)?.kind).toBe('quiet')
    expect(sectionAt(timeline, 9)?.kind).toBe('drop')
  })
})
