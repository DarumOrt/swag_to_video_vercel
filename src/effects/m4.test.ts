/** Milestone 4: range accents, several accents on a word, the six modes, section moods and transitions. */

import { describe, expect, it } from 'vitest'
import { createFakeTimeline } from '@/render'
import type { Accent, AccentEffectId, AudioSection, Timeline } from '@/shared'
import { ACCENT_EFFECTS } from './accents'
import { accentWindow, envelopeAt, RANGE_MAX_RELEASE_SEC } from './envelope'
import { evaluateAccents, prepareAccents } from './evaluate'
import { createEffect, styleEffects } from './host'
import { EFFECT_STYLE_ORDER } from './presets'
import { applyBeatCamera, BEAT_CAMERA_PARAMS } from './rhythm'
import { resolveParams } from './params'
import { moodAt, NEUTRAL_MOOD, planTransitions, sectionAt, transitionAt, TRANSITION_PARAMS } from './sections'
import { IDENTITY_CAMERA, isNeutralPost } from './types'

const MODES: AccentEffectId[] = ['mono', 'mirror', 'strobe', 'rgb-split', 'vhs', 'camera-orbit']

function words(tl: Timeline) {
  return tl.lyrics!.lines[0]!.words
}

function accent(a: Partial<Accent> & Pick<Accent, 'id' | 'wordId' | 'effect'>): Accent {
  return { preRollSec: 0.05, durationSec: 0.5, intensity: 1, params: {}, ...a }
}

describe('range accents', () => {
  it('hold the envelope from the first word to the end of the last one, then release', () => {
    const w = accentWindow(4, 4.4, 0.1, 0.8, 6)
    expect(w).toMatchObject({ start: 3.9, peak: 4, hold: 6, range: true })
    expect(w.end).toBeCloseTo(6 + RANGE_MAX_RELEASE_SEC)
    expect(envelopeAt(w, 3.95)).toBeGreaterThan(0)
    expect(envelopeAt(w, 3.95)).toBeLessThan(1)
    for (const t of [4, 5, 5.99]) expect(envelopeAt(w, t)).toBe(1)
    expect(envelopeAt(w, 6.1)).toBeLessThan(1)
    expect(envelopeAt(w, w.end)).toBe(0)
  })

  it('a one-shot window is unchanged (hold = peak)', () => {
    const w = accentWindow(4, 4.4, 0.1, 0.8)
    expect(w).toMatchObject({ peak: 4, hold: 4, range: false })
    expect(w.end).toBeCloseTo(4.8)
  })

  it('cover the words between wordId and endWordId', () => {
    const tl = createFakeTimeline({ durationSec: 20 })
    const ws = words(tl)
    tl.accents = [accent({ id: 'r', wordId: ws[1]!.id, endWordId: ws[4]!.id, effect: 'mono' })]
    const p = prepareAccents(tl).accents[0]!
    expect(p.window.range).toBe(true)
    expect(p.window.hold).toBeCloseTo(ws[4]!.end!)
    const mid = (ws[2]!.start! + ws[3]!.start!) / 2
    const f = evaluateAccents(prepareAccents(tl), mid)
    expect(f.post.mono).toBeGreaterThan(0.5)
    expect(f.active[0]?.holding).toBe(true)
    // Off shortly after the last word.
    const after = evaluateAccents(prepareAccents(tl), ws[4]!.end! + RANGE_MAX_RELEASE_SEC + 0.01)
    expect(after.post.mono).toBe(0)
  })

  it('an end word before the start word falls back to a one-shot', () => {
    const tl = createFakeTimeline({ durationSec: 20 })
    const ws = words(tl)
    tl.accents = [accent({ id: 'r', wordId: ws[3]!.id, endWordId: ws[1]!.id, effect: 'zoom-punch' })]
    expect(prepareAccents(tl).accents[0]!.window.range).toBe(false)
  })

  it('breathe with the beat while holding', () => {
    const tl = createFakeTimeline({ durationSec: 20 })
    const ws = words(tl)
    tl.accents = [
      accent({ id: 'r', wordId: ws[0]!.id, endWordId: ws[5]!.id, effect: 'zoom-punch', params: { breathe: 1 } }),
    ]
    const p = prepareAccents(tl)
    // Words fall on beats: right on a word start the pulse is high, half a beat later it is low.
    const onBeat = evaluateAccents(p, ws[2]!.start! + 0.01).camera.zoom
    const offBeat = evaluateAccents(p, ws[2]!.start! + 0.25).camera.zoom
    expect(onBeat).toBeGreaterThan(offBeat)
    expect(offBeat).toBeGreaterThan(1)
  })

  it('full-screen word follows the current word of the range', () => {
    const tl = createFakeTimeline({ durationSec: 20 })
    const ws = words(tl)
    tl.accents = [accent({ id: 'r', wordId: ws[0]!.id, endWordId: ws[3]!.id, effect: 'fullscreen-word' })]
    const p = prepareAccents(tl)
    const text = (t: number) => evaluateAccents(p, t).overlays.find((o) => o.kind === 'word')
    const at2 = text(ws[2]!.start! + 0.05)
    expect(at2?.kind === 'word' && at2.text).toBe(ws[2]!.text.toLocaleUpperCase().replace(/[.,!?;:…»"')\]]+$/u, ''))
  })
})

describe('several accents on one word', () => {
  function stack(effects: AccentEffectId[], params: Record<string, Accent['params']> = {}) {
    const tl = createFakeTimeline({ durationSec: 20 })
    const w = words(tl)[2]!
    tl.accents = effects.map((effect, i) => accent({ id: `a${i}`, wordId: w.id, effect, params: params[effect] ?? {} }))
    return { tl, hit: w.start! }
  }

  it('compose the camera', () => {
    const one = stack(['zoom-punch'])
    const two = stack(['zoom-punch', 'zoom-punch'])
    const z1 = evaluateAccents(prepareAccents(one.tl), one.hit + 0.02).camera.zoom
    const z2 = evaluateAccents(prepareAccents(two.tl), two.hit + 0.02).camera.zoom
    expect(z2).toBeCloseTo(z1 * z1)
  })

  it('mix post channels without cancelling', () => {
    const { tl, hit } = stack(['glitch', 'rgb-split', 'mono', 'palette-shift'], {
      'rgb-split': { angle: 180 },
    })
    const f = evaluateAccents(prepareAccents(tl), hit + 0.05)
    expect(Math.abs(f.post.rgbSplit)).toBeGreaterThan(0.01)
    expect(f.post.mono).toBeGreaterThan(0)
    expect(f.post.hueShift).not.toBe(0)
    expect(f.active).toHaveLength(4)
  })

  it('stack overlays in a fixed order (word, particles, flash), independent of input order', () => {
    const a = stack(['flash', 'particle-burst', 'fullscreen-word'])
    const b = stack(['fullscreen-word', 'flash', 'particle-burst'])
    const kinds = (tl: Timeline, hit: number) => evaluateAccents(prepareAccents(tl), hit + 0.05).overlays.map((o) => o.kind)
    expect(kinds(a.tl, a.hit)).toEqual(['word', 'particles', 'flash'])
    expect(kinds(b.tl, b.hit)).toEqual(['word', 'particles', 'flash'])
  })
})

describe('modes', () => {
  it.each<[AccentEffectId, (f: ReturnType<typeof evaluateAccents>) => boolean]>([
    ['mono', (f) => f.post.mono > 0.5],
    ['mirror', (f) => f.post.mirror > 0.5 && f.post.mirrorMode === 'kaleido'],
    ['rgb-split', (f) => f.post.rgbSplit !== 0],
    ['vhs', (f) => f.post.vhs > 0.3],
    ['camera-orbit', (f) => (f.camera.tiltX ?? 0) !== 0 || (f.camera.tiltY ?? 0) !== 0],
  ])('%s contributes while active and is neutral outside', (effect, check) => {
    const tl = createFakeTimeline({ durationSec: 20 })
    const w = words(tl)[2]!
    tl.accents = [accent({ id: 'm', wordId: w.id, endWordId: words(tl)[4]!.id, effect })]
    const p = prepareAccents(tl)
    expect(check(evaluateAccents(p, w.start! + 0.3))).toBe(true)
    const off = evaluateAccents(p, w.start! - 1)
    expect(isNeutralPost(off.post)).toBe(true)
    expect(off.camera).toEqual(IDENTITY_CAMERA)
  })

  it('strobe blinks on beat subdivisions', () => {
    const tl = createFakeTimeline({ durationSec: 20 })
    const w = words(tl)[1]!
    tl.accents = [accent({ id: 's', wordId: w.id, endWordId: words(tl)[5]!.id, effect: 'strobe', params: { division: 2, duty: 0.4 } })]
    const p = prepareAccents(tl)
    const beat = w.start! + 0.5 // fake timeline: 120 bpm, one word per beat
    const on = (t: number) => evaluateAccents(p, t).overlays.some((o) => o.kind === 'flash')
    expect(on(beat + 0.02)).toBe(true) // first quarter of the beat
    expect(on(beat + 0.15)).toBe(false) // 0.15 / 0.25 = 0.6 of the subdivision
    expect(on(beat + 0.27)).toBe(true) // second subdivision
  })

  it('every mode has RU and EN texts and defaults', () => {
    for (const id of MODES) {
      const def = ACCENT_EFFECTS[id]
      expect(def.label.ru && def.label.en && def.description.ru && def.description.en).toBeTruthy()
      for (const spec of def.params) expect(spec.label.ru && spec.label.en).toBeTruthy()
      expect(def.defaults.durationSec).toBeGreaterThan(0)
    }
  })
})

describe('section moods', () => {
  const sections: AudioSection[] = [
    { start: 0, end: 8, kind: 'quiet', energy: 0.3 },
    { start: 8, end: 16, kind: 'build', energy: 0.6 },
    { start: 16, end: 24, kind: 'drop', energy: 1 },
    { start: 24, end: 32, kind: 'quiet', energy: 0.3, role: 'bridge' },
    { start: 32, end: 40, kind: 'drop', energy: 1 },
  ]
  const tl = createFakeTimeline({ durationSec: 40 })
  tl.audio.sections = sections

  it('restrained intro, growing build, maximum drop, another character in the bridge', () => {
    expect(sectionAt(tl.audio, 2)?.role).toBe('intro')
    expect(sectionAt(tl.audio, 26)?.role).toBe('bridge')
    const intro = moodAt(tl.audio, 4).energy
    const buildEarly = moodAt(tl.audio, 9).energy
    const buildLate = moodAt(tl.audio, 15.9).energy
    const drop = moodAt(tl.audio, 20).energy
    expect(intro).toBeLessThan(buildEarly)
    expect(buildEarly).toBeLessThan(buildLate)
    expect(buildLate).toBeLessThan(drop)
    expect(moodAt(tl.audio, 28).temperature).toBeLessThan(0)
    expect(moodAt(tl.audio, 28).saturation).toBeLessThan(0)
  })

  it('crossfades at boundaries and is neutral without sections', () => {
    const before = moodAt(tl.audio, 15.99).energy
    const just = moodAt(tl.audio, 16.05).energy
    const settled = moodAt(tl.audio, 17).energy
    expect(just).toBeGreaterThanOrEqual(before - 1e-6)
    expect(just).toBeLessThan(settled)
    const bare = createFakeTimeline({ durationSec: 10 })
    delete bare.audio.sections
    expect(moodAt(bare.audio, 5)).toEqual(NEUTRAL_MOOD)
  })

  it('beat camera swings less in the intro than in the drop', () => {
    const params = resolveParams(BEAT_CAMERA_PARAMS, { dropBoost: 1 })
    const zoomAt = (t: number) => {
      const cam = { ...IDENTITY_CAMERA }
      applyBeatCamera(tl.audio, t, params, 1, cam)
      return cam.zoom
    }
    // Same beat phase (just after a downbeat) in intro and drop.
    expect(zoomAt(2.01) - 1).toBeLessThan((zoomAt(18.01) - 1) * 0.5)
  })

  it('style effects follow sections and include transitions', () => {
    for (const id of EFFECT_STYLE_ORDER) {
      expect(styleEffects(id).some((e) => e.type === 'section-transitions')).toBe(true)
    }
  })
})

describe('section transitions', () => {
  const sections: AudioSection[] = Array.from({ length: 12 }, (_, i) => ({
    start: i * 8,
    end: (i + 1) * 8,
    kind: (['normal', 'build', 'drop', 'quiet'] as const)[i % 4]!,
    energy: 0.5,
  }))
  const params = resolveParams(TRANSITION_PARAMS, {})

  it('one per boundary, same seed → same plan, another seed → another plan', () => {
    const a = planTransitions(sections, 1)
    expect(a).toHaveLength(sections.length - 1)
    expect(planTransitions(sections, 1)).toEqual(a)
    const kinds = (seed: number) => planTransitions(sections, seed).map((t) => `${t.kind}${t.direction}`)
    expect(kinds(2)).not.toEqual(kinds(1))
  })

  it('respects the allowed set', () => {
    for (const t of planTransitions(sections, 7, 'clean')) expect(['flash', 'zoom']).toContain(t.kind)
  })

  it('acts only around the cut', () => {
    const plan = planTransitions(sections, 3)
    const first = plan[0]!
    const near = transitionAt(plan, first.time + 0.05, params, 3)
    const changed = near.flash !== null || !isNeutralPost(near.post) || near.camera.zoom !== 1 || near.camera.x !== 0
    expect(changed).toBe(true)
    const far = transitionAt(plan, first.time + 3, params, 3)
    expect(far.flash).toBeNull()
    expect(far.camera).toEqual(IDENTITY_CAMERA)
    expect(isNeutralPost(far.post)).toBe(true)
  })

  it('the scene effect is deterministic per seed and differs between seeds', () => {
    const tl = createFakeTimeline({ durationSec: 96 })
    tl.audio.sections = sections
    const camAt = (seed: number, t: number) => {
      const e = createEffect({ id: 'tr', type: 'section-transitions' }, { seed })!
      const cam = { ...IDENTITY_CAMERA }
      e.camera?.({ timeline: tl, baseTime: t } as never, cam)
      return cam
    }
    const times = sections.slice(1).flatMap((s) => [s.start - 0.1, s.start + 0.1])
    const run = (seed: number) => times.map((t) => camAt(seed, t))
    expect(run(5)).toEqual(run(5))
    const differs = [11, 12, 13].some((seed) => JSON.stringify(run(seed)) !== JSON.stringify(run(5)))
    expect(differs).toBe(true)
  })
})
