import { describe, expect, it } from 'vitest'
import type { AudioSection, RenderCanvas, Timeline } from '@/shared'
import { createFakeTimeline } from './dev/fakeTimeline'
import { Director, DIRECTOR_DEFAULTS, layerGroup, neutralShot, normalizeDirector } from './director'
import {
  IDENTITY_CAMERA,
  type CameraTransform,
  type Effect,
  type EffectFactory,
} from './effectsHost'
import { beatAt } from './rhythm'
import { SceneRenderer } from './SceneRenderer'
import type { SceneInput } from './scene'
import { buildPresetScene } from './styles/presets'
import { createRecordingCanvas } from './testing/recordingCanvas'
import type { FrameContext } from './types'

const story = createFakeTimeline({ durationSec: 32, story: true })
const sections = story.audio.sections as AudioSection[]
const mid = (i: number) => {
  const s = sections[i] as AudioSection
  return (s.start + s.end) / 2
}

function cameraAt(d: Director, t: number, timeline: Timeline = story): CameraTransform {
  const c = { ...IDENTITY_CAMERA }
  d.camera(t, beatAt(timeline, t), c)
  return c
}

describe('normalizeDirector', () => {
  it('fills defaults, clamps knobs, keeps null as no director', () => {
    expect(normalizeDirector(null)).toBeNull()
    expect(normalizeDirector({})).toEqual(DIRECTOR_DEFAULTS)
    const d = normalizeDirector({ energy: 3, chaos: -1, transitions: 'nope' as 'cut' })
    expect(d).toMatchObject({ energy: 1, chaos: 0, transitions: 'auto', camera3d: false })
  })

  it('groups layers by type', () => {
    expect(layerGroup('background')).toBe('background')
    expect(layerGroup('fulltext')).toBe('text')
    expect(layerGroup('spectrum-bars')).toBe('visual')
  })
})

describe('Director shots follow the song sections', () => {
  const spec = normalizeDirector({
    energy: 0.6,
    chaos: 0.5,
    scenes: { chorus: { layout: 'stack' }, drop: { layout: 'word' }, intro: { layout: 'phrase' } },
  })!
  const d = new Director(spec, 5, story)

  it('reports role, layout and intensity per section', () => {
    const roles = sections.map((_, i) => d.shotAt(mid(i)).role)
    expect(roles).toEqual(sections.map((s) => s.role))
    expect(d.shotAt(mid(0)).layout).toBe('phrase')
    expect(d.shotAt(mid(3)).layout).toBe('stack')
    expect(d.shotAt(mid(6)).layout).toBe('word')
    // Drops hit harder than intros.
    expect(d.shotAt(mid(6)).intensity).toBeGreaterThan(d.shotAt(mid(0)).intensity)
  })

  it('crossfades into a new section (enter 0 → 1) and dims visuals in the intro', () => {
    const b = (sections[1] as AudioSection).start
    expect(d.shotAt(b).enter).toBe(0)
    expect(d.shotAt(b + spec.transitionSec * 0.5).enter).toBeCloseTo(0.5, 1)
    expect(d.shotAt(b + spec.transitionSec + 0.01).enter).toBe(1)
    expect(d.layerAlpha(mid(0), 'bars', 'visual')).toBeLessThan(1)
    expect(d.layerAlpha(mid(6), 'bars', 'visual')).toBe(1)
    const halfway = d.layerAlpha(b + spec.transitionSec * 0.5, 'bars', 'visual')
    expect(halfway).toBeGreaterThan(d.layerAlpha(mid(0), 'bars', 'visual'))
    expect(halfway).toBeLessThan(d.layerAlpha(mid(1), 'bars', 'visual'))
  })

  it('moves the camera more in drops than in the intro', () => {
    const swing = (i: number) => {
      const s = sections[i] as AudioSection
      let max = 0
      for (let t = s.start + 0.5; t < s.end; t += 0.1) {
        const c = cameraAt(d, t)
        max = Math.max(max, Math.abs(c.x), Math.abs(c.rotation))
      }
      return max
    }
    expect(swing(6)).toBeGreaterThan(swing(0))
  })

  it('3D tilt only with camera3d', () => {
    expect(cameraAt(d, mid(6)).tiltX ?? 0).toBe(0)
    const d3 = new Director({ ...spec, camera3d: true }, 5, story)
    const c = cameraAt(d3, mid(6))
    expect(Math.abs(c.tiltX ?? 0) + Math.abs(c.tiltY ?? 0)).toBeGreaterThan(0.01)
  })

  it('without sections: one verse shot over the whole track', () => {
    const plain = { ...story, audio: { ...story.audio, sections: undefined } }
    const dd = new Director(spec, 5, plain)
    expect(dd.shotAt(10)).toMatchObject({ role: 'verse', index: -1, enter: 1 })
    expect(neutralShot(plain, 10)).toMatchObject({ role: 'verse', intensity: 1, layout: null })
  })
})

describe('Director randomness comes only from the seed', () => {
  const spec = normalizeDirector({ chaos: 0.8, randomness: 1, camera3d: true })!

  it('same seed → same shots, camera and transitions', () => {
    const a = new Director(spec, 42, story)
    const b = new Director(spec, 42, story)
    for (let t = 0; t < 32; t += 0.37) {
      expect(b.shotAt(t)).toEqual(a.shotAt(t))
      expect(cameraAt(b, t)).toEqual(cameraAt(a, t))
      expect(b.transitionAt(t)).toEqual(a.transitionAt(t))
    }
  })

  it('another seed → another edit', () => {
    const a = new Director(spec, 1, story)
    const b = new Director(spec, 2, story)
    let diff = 0
    for (let t = 0; t < 32; t += 0.5) {
      if (a.shotAt(t).variant !== b.shotAt(t).variant) diff++
      if (cameraAt(a, t).x !== cameraAt(b, t).x) diff++
    }
    expect(diff).toBeGreaterThan(10)
  })

  it('sections of one repeat group share their look', () => {
    const s: AudioSection[] = [
      { kind: 'normal', start: 0, end: 4, energy: 0.6, role: 'verse' },
      { kind: 'drop', start: 4, end: 8, energy: 1, role: 'chorus', repeatGroup: 7 },
      { kind: 'normal', start: 8, end: 12, energy: 0.6, role: 'verse' },
      { kind: 'drop', start: 12, end: 16, energy: 1, role: 'chorus', repeatGroup: 7 },
    ]
    const tl = { ...story, audio: { ...story.audio, sections: s } }
    const d = new Director(
      normalizeDirector({ randomness: 1, scenes: { chorus: { layout: ['a', 'b', 'c', 'd'] } } })!,
      9,
      tl,
    )
    expect(d.shotAt(14).variant).toBe(d.shotAt(6).variant)
    expect(d.shotAt(14).layout).toBe(d.shotAt(6).layout)
    expect(d.shotAt(10).variant).not.toBe(d.shotAt(2).variant)
  })

  it('randomness 0 keeps role defaults', () => {
    const d = new Director(normalizeDirector({ randomness: 0 })!, 3, story)
    // The intro → verse change uses the verse's first transition ('cut'), chorus its first ('flash').
    expect(d.transitionAt((sections[1] as AudioSection).start)).toBeNull()
    expect(d.transitionAt((sections[3] as AudioSection).start)?.kind).toBe('flash')
  })
})

describe('Director transitions', () => {
  it('dips to black on a fade, and leaves transitions to the effects when told to', () => {
    const spec = normalizeDirector({ transitions: 'fade' })!
    const b = (sections[2] as AudioSection).start
    const draws = (d: Director) => {
      const { canvas, log } = createRecordingCanvas()
      d.overlay(canvas.getContext() as never, b, 100, 100)
      return log.filter((x) => x[0] === 'fillRect').length
    }
    expect(draws(new Director(spec, 1, story))).toBe(1)
    expect(draws(new Director(spec, 1, story, { transitions: false }))).toBe(0)
  })
})

describe('SceneRenderer with a director', () => {
  /** Probe effect: records the shot, camera and word count every frame (overlay sees words). */
  function probe() {
    const seen: { role: string; layout: string | null; camera: CameraTransform; words: number }[] =
      []
    const factory: EffectFactory = (spec) =>
      spec.type === 'probe'
        ? ({
            id: spec.id,
            overlay: (_g, f: FrameContext) =>
              seen.push({
                role: f.shot.role,
                layout: f.shot.layout,
                camera: { ...f.camera },
                words: f.words.all().length,
              }),
          } satisfies Effect)
        : null
    return { seen, factory }
  }

  async function render(scene: SceneInput, frames: number[], timeline: Timeline = story) {
    const { canvas, log } = createRecordingCanvas()
    const p = probe()
    const r = new SceneRenderer({ createEffect: p.factory, effectFontFamilies: () => [] })
    await r.init({
      canvas: canvas as unknown as RenderCanvas,
      width: 1080,
      height: 1920,
      fps: 30,
      timeline,
      scene: { ...scene, effects: [{ id: 'probe', type: 'probe' }] },
    })
    p.seen.length = 0
    const logs = frames.map((n) => {
      log.length = 0
      r.renderFrame(n)
      return structuredClone(log)
    })
    r.dispose()
    return { logs, seen: p.seen }
  }

  const frameOf = (i: number) => Math.round(mid(i) * 30)

  it('exposes the shot to layers and effects and moves the camera', async () => {
    const { seen } = await render(buildPresetScene('fullscreen'), [
      frameOf(0),
      frameOf(3),
      frameOf(6),
    ])
    expect(seen.map((s) => s.role)).toEqual(['intro', 'chorus', 'drop'])
    expect(seen[0]?.layout).toBe('phrase')
    expect(seen[2]?.layout).toBe('word')
    expect(seen.some((s) => s.camera.x !== 0 || s.camera.zoom !== 1)).toBe(true)
  })

  it('same seed renders the same commands in any order; a new seed changes the frame', async () => {
    const scene = buildPresetScene('fullscreen')
    const f = frameOf(6)
    const a = await render(scene, [f, frameOf(1), f])
    expect(a.logs[2]).toEqual(a.logs[0])
    const b = await render(scene, [f])
    expect(b.logs[0]).toEqual(a.logs[0])
    const c = await render({ ...scene, seed: 1234 }, [f])
    expect(c.logs[0]).not.toEqual(a.logs[0])
  })

  it('minimal switches the kinetic layout by section (stack/focus vs flow)', async () => {
    const { seen } = await render(buildPresetScene('minimal'), [frameOf(1), frameOf(6)])
    expect(seen[0]?.layout).toBeNull()
    expect(seen[1]?.layout).toBe('focus')
    // Focus shows the current word (and the previous one small); flow shows the whole line so far.
    expect(seen[1]?.words).toBeLessThanOrEqual(2)
    const off = await render(buildPresetScene('minimal', { directed: false }), [frameOf(6)])
    expect(off.seen[0]?.layout).toBeNull()
  })

  it('scenes without a director keep the neutral shot', async () => {
    const scene = buildPresetScene('studio')
    const { seen } = await render({ ...scene, director: null }, [frameOf(3)])
    expect(seen[0]?.role).toBe('chorus')
    expect(seen[0]?.camera).toEqual(IDENTITY_CAMERA)
  })
})
