/** Camera tilt, effects driven by the director shot, and the "edit" style (cuts, beat tilt, drop bursts). */

import { describe, expect, it } from 'vitest'
import { createFakeTimeline, type ShotState } from '@/render'
import { sectionRole, type Timeline } from '@/shared'
import { burstAt, BURST_PARAMS } from './bursts'
import { createEffect, styleEffects } from './host'
import { resolveParams } from './params'
import { EFFECT_STYLES } from './presets'
import { applyBeatCamera, BEAT_CAMERA_PARAMS } from './rhythm'
import {
  EDIT_TRANSITION_KINDS,
  moodAt,
  planLineTransitions,
  planTransitions,
  shotMood,
  transitionAt,
  TRANSITION_PARAMS,
} from './sections'
import { IDENTITY_CAMERA, type CameraTransform } from './types'

function story(): Timeline {
  return createFakeTimeline({ durationSec: 120, story: true })
}

/** A shot as the engine's director would give it at time t. */
function shotAt(tl: Timeline, t: number, over: Partial<ShotState> = {}): ShotState {
  const sections = tl.audio.sections ?? []
  const index = Math.max(
    0,
    sections.findIndex((s) => t >= s.start && t < s.end),
  )
  const s = sections[index]!
  return {
    role: sectionRole(sections, index),
    index,
    start: s.start,
    end: s.end,
    progress: (t - s.start) / (s.end - s.start),
    enter: 1,
    variant: 0,
    intensity: 1,
    layout: null,
    energy: 0,
    chaos: 0,
    ...over,
  }
}

function frame(tl: Timeline, t: number, shot?: ShotState) {
  return { timeline: tl, baseTime: t, shot } as never
}

describe('camera tilt', () => {
  const tl = story()
  const w = tl.lyrics!.lines[1]!.words[0]!
  tl.accents = [
    { id: 'o', wordId: w.id, effect: 'camera-orbit', preRollSec: 0.1, durationSec: 1.5, intensity: 1, params: {} },
  ]
  const t = w.start! + 0.3

  it('camera-orbit writes tiltX/tiltY when the host has them', () => {
    const e = createEffect({ id: 'acc', type: 'accents' }, { seed: 1 })!
    const cam: CameraTransform = { ...IDENTITY_CAMERA }
    e.camera!(frame(tl, t, shotAt(tl, t)), cam)
    expect(Math.abs(cam.tiltX ?? 0) + Math.abs(cam.tiltY ?? 0)).toBeGreaterThan(0.01)
    // No homography in the accent pass then.
    expect(e.post!.active!(frame(tl, t, shotAt(tl, t)))).toBe(false)
  })

  it('falls back to the shader homography on a host without tilt', () => {
    const e = createEffect({ id: 'acc', type: 'accents' }, { seed: 1 })!
    const cam: CameraTransform = { ...IDENTITY_CAMERA }
    e.camera!(frame(tl, t), cam)
    expect(cam.tiltX ?? 0).toBe(0)
    expect(cam.tiltY ?? 0).toBe(0)
    expect(e.post!.active!(frame(tl, t))).toBe(true)
  })

  it('beat camera nods in depth only with the tilt param', () => {
    const beat = tl.audio.rhythm.beats[40]! + 0.01
    const run = (tilt: number) => {
      const cam: CameraTransform = { ...IDENTITY_CAMERA }
      applyBeatCamera(tl.audio, beat, resolveParams(BEAT_CAMERA_PARAMS, { tilt }), 3, cam)
      return cam
    }
    expect(run(0).tiltX).toBeUndefined()
    expect(Math.abs(run(6).tiltX ?? 0) + Math.abs(run(6).tiltY ?? 0)).toBeGreaterThan(0)
  })
})

describe('effects follow the director shot', () => {
  const tl = story()
  const sections = tl.audio.sections!
  const k = sections.findIndex((_, i) => i > 0 && sectionRole(sections, i) !== sectionRole(sections, i - 1))
  const cut = sections[k]!.start

  it('the mood crossfades with shot.enter, not our own clock', () => {
    const t = cut + 0.05
    const prev = moodAt(tl.audio, sections[k - 1]!.end - 0.01).energy
    const full = shotMood(tl.audio, shotAt(tl, t, { enter: 1, variant: 7 }), t).energy
    const half = shotMood(tl.audio, shotAt(tl, t, { enter: 0.5, variant: 7 }), t).energy
    expect(half).toBeCloseTo((prev + full) / 2, 5)
    // Without a director the own crossfade applies (same as moodAt).
    expect(shotMood(tl.audio, shotAt(tl, t), t).energy).toBeCloseTo(moodAt(tl.audio, t).energy, 5)
  })

  it('shot intensity scales the beat camera and the transitions', () => {
    const t = tl.audio.rhythm.beats[60]! + 0.01
    const params = resolveParams(BEAT_CAMERA_PARAMS, {})
    const zoom = (intensity: number) => {
      const cam = { ...IDENTITY_CAMERA }
      applyBeatCamera(tl.audio, t, params, 1, cam, shotAt(tl, t, { intensity, variant: 1 }))
      return cam.zoom - 1
    }
    expect(zoom(1.5)).toBeGreaterThan(zoom(1) * 1.3)

    const plan = planTransitions(sections, 2, 'whip-zoom')
    const tp = resolveParams(TRANSITION_PARAMS, { kinds: 'whip-zoom' })
    const at = plan[0]!.time - 0.05
    const z = (gain: number) => transitionAt(plan, at, tp, 2, gain).camera.zoom - 1
    expect(z(1)).toBeGreaterThan(0)
    expect(z(0.5)).toBeCloseTo(z(1) / 2, 5)
  })
})

describe('edit style', () => {
  const tl = story()
  const sections = tl.audio.sections!
  const lines = tl.lyrics!.lines

  it('is a full style with cuts on lines and drop bursts', () => {
    const fx = styleEffects('edit')
    expect(EFFECT_STYLES.edit.id).toBe('edit')
    const tr = fx.find((e) => e.type === 'section-transitions')!
    expect(tr.params).toMatchObject({ kinds: 'edit' })
    expect(Number(tr.params!.lines)).toBeGreaterThan(0)
    expect(fx.some((e) => e.type === 'drop-bursts')).toBe(true)
    expect(Number(fx.find((e) => e.type === 'beat-camera')!.params!.tilt)).toBeGreaterThan(0)
    for (const e of fx) expect(createEffect(e, { seed: 1 })).not.toBeNull()
  })

  it('plans edit cuts on sections and lines: same seed → same, other seeds → other', () => {
    const plan = (seed: number) => planLineTransitions(sections, lines, seed, 'edit')
    const a = plan(1)
    expect(a).toEqual(plan(1))
    expect(a.some((t) => t.line)).toBe(true)
    expect(a.filter((t) => !t.line)).toEqual(planTransitions(sections, 1, 'edit'))
    for (const t of a) expect(EDIT_TRANSITION_KINDS).toContain(t.kind)
    for (let i = 1; i < a.length; i++) expect(a[i]!.time).toBeGreaterThanOrEqual(a[i - 1]!.time)
    const sig = (seed: number) => plan(seed).map((t) => `${t.kind}${t.direction}`).join()
    expect(new Set([1, 2, 3, 4].map(sig)).size).toBeGreaterThan(1)
    // Every edit kind shows up somewhere across a few seeds.
    const used = new Set([1, 2, 3, 4, 5].flatMap((s) => plan(s).map((t) => t.kind)))
    expect(used.size).toBe(EDIT_TRANSITION_KINDS.length)
  })

  it('line cuts stay away from section cuts and are weaker', () => {
    const a = planLineTransitions(sections, lines, 9, 'edit')
    const cuts = a.filter((t) => !t.line)
    for (const t of a.filter((x) => x.line)) {
      for (const c of cuts) expect(Math.abs(c.time - t.time)).toBeGreaterThanOrEqual(0.6)
      expect(t.strength).toBeLessThan(1)
    }
  })

  it('the transitions effect renders the same frames per seed and other frames for other seeds', () => {
    const spec = styleEffects('edit').find((e) => e.type === 'section-transitions')!
    const times = planLineTransitions(sections, lines, 5, 'edit').flatMap((t) => [t.time - 0.08, t.time + 0.03, t.time + 0.1])
    const run = (seed: number) => {
      const e = createEffect(spec, { seed })!
      return times.map((t) => {
        const cam: CameraTransform = { ...IDENTITY_CAMERA }
        e.camera!(frame(tl, t, shotAt(tl, t)), cam)
        return cam
      })
    }
    expect(run(5)).toEqual(run(5))
    expect(JSON.stringify(run(6))).not.toEqual(JSON.stringify(run(5)))
  })

  it('drop bursts: series only in peak sections, seeded', () => {
    const params = resolveParams(BURST_PARAMS, { sections: 'drop', density: 0.6 })
    const beats = Array.from(tl.audio.rhythm.beats)
    const pattern = (seed: number) =>
      beats.flatMap((b) => [b + 0.01, b + 0.14]).map((t) => {
        const f = burstAt(tl.audio, t, params, seed, shotAt(tl, t))
        return f.kind ? `${f.kind}:${f.flash ? 1 : 0}:${f.post.rgbSplit.toFixed(4)}` : '-'
      })
    const a = pattern(1)
    expect(a).toEqual(pattern(1))
    expect(a.some((x) => x.startsWith('strobe') || x.startsWith('rgb'))).toBe(true)
    expect(pattern(2)).not.toEqual(a)
    // Nothing outside drops.
    beats.forEach((b, i) => {
      const role = shotAt(tl, b + 0.01).role
      if (role !== 'drop') expect(a[i * 2]).toBe('-')
    })
  })
})
