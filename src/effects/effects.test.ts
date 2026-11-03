import { describe, expect, it } from 'vitest'
import { createFakeTimeline } from '@/render'
import type { Accent, AccentEffectId, Timeline } from '@/shared'
import { ACCENT_EFFECT_ORDER } from './accents'
import { evaluateAccents, prepareAccents } from './evaluate'
import { createEffect, EFFECT_TYPES, isEffectType, styleEffects } from './host'
import { EFFECT_STYLE_ORDER } from './presets'
import { beatAt, beatFlash, beatPulse, dropAmountAt } from './rhythm'
import { resolveParams } from './params'
import { BEAT_FLASH_PARAMS } from './rhythm'
import { IDENTITY_CAMERA, isNeutralPost } from './types'

/** Fake timeline (120 bpm, words one per beat from 4 s) with one accent of `effect` on word w0-2. */
function withAccent(effect: AccentEffectId, extra: Partial<Accent> = {}): { tl: Timeline; hit: number } {
  const tl = createFakeTimeline({ durationSec: 20 })
  const word = tl.lyrics?.lines[0]?.words[2]
  if (!word?.start) throw new Error('fake timeline has no words')
  tl.accents = [
    { id: 'a1', wordId: word.id, effect, preRollSec: 0.05, durationSec: 0.6, intensity: 1, params: {}, ...extra },
  ]
  return { tl, hit: word.start }
}

describe('evaluateAccents', () => {
  it('skips accents on unknown or untimed words', () => {
    const tl = createFakeTimeline({ durationSec: 20 })
    const w = tl.lyrics!.lines[0]!.words[0]!
    w.start = null
    tl.accents = [
      { id: 'x', wordId: 'nope', effect: 'flash', preRollSec: 0, durationSec: 1, intensity: 1, params: {} },
      { id: 'y', wordId: w.id, effect: 'flash', preRollSec: 0, durationSec: 1, intensity: 1, params: {} },
    ]
    expect(prepareAccents(tl).accents).toHaveLength(0)
  })

  it('is neutral outside the accent window', () => {
    const { tl, hit } = withAccent('zoom-punch')
    const p = prepareAccents(tl)
    for (const t of [hit - 0.2, hit + 0.7]) {
      const f = evaluateAccents(p, t)
      expect(f.camera).toEqual(IDENTITY_CAMERA)
      expect(f.overlays).toHaveLength(0)
      expect(isNeutralPost(f.post)).toBe(true)
      expect(f.timeLag).toBe(0)
      expect(f.active).toHaveLength(0)
    }
  })

  const t = 0.02
  it.each<[AccentEffectId, (f: ReturnType<typeof evaluateAccents>) => boolean]>([
    ['zoom-punch', (f) => f.camera.zoom > 1.1],
    ['shake', (f) => f.camera.x !== 0 || f.camera.y !== 0],
    ['glitch', (f) => f.post.glitch > 0 || f.post.rgbSplit !== 0],
    ['flash', (f) => f.overlays.some((o) => o.kind === 'flash' && o.alpha > 0.5)],
    ['palette-shift', (f) => f.post.hueShift !== 0],
    ['particle-burst', (f) => f.overlays.some((o) => o.kind === 'particles' && o.count > 10)],
    ['fullscreen-word', (f) => f.overlays.some((o) => o.kind === 'word' && o.text.length > 0)],
    ['slow-motion', (f) => f.timeLag > 0],
    ['invert', (f) => f.post.invert === 1],
  ])('%s contributes around the hit', (effect, check) => {
    const { tl, hit } = withAccent(effect)
    const f = evaluateAccents(prepareAccents(tl), hit + (effect === 'slow-motion' ? 0.2 : t))
    expect(check(f)).toBe(true)
    expect(f.active[0]?.effect).toBe(effect)
  })

  it('is deterministic: a frame does not depend on which frames came before', () => {
    for (const effect of ACCENT_EFFECT_ORDER) {
      const { tl, hit } = withAccent(effect)
      const times = [hit + 0.1, hit - 0.03, hit + 0.3, hit + 0.1]
      const a = evaluateAccents(prepareAccents(tl, { seed: 5 }), times[0]!)
      const p = prepareAccents(tl, { seed: 5 })
      const frames = times.map((x) => evaluateAccents(p, x))
      expect(frames[3]).toEqual(a)
    }
  })

  it('particles depend on the seed', () => {
    const { tl, hit } = withAccent('particle-burst')
    const a = evaluateAccents(prepareAccents(tl, { seed: 1 }), hit + 0.2).overlays[0]
    const b = evaluateAccents(prepareAccents(tl, { seed: 2 }), hit + 0.2).overlays[0]
    expect(a?.kind === 'particles' && b?.kind === 'particles' && a.data[0] !== b.data[0]).toBe(true)
  })

  it('slow-motion never runs time backwards and is back in sync after the window', () => {
    const { tl, hit } = withAccent('slow-motion', { durationSec: 1.2, params: { amount: 0.9 } })
    const p = prepareAccents(tl)
    let prev = -Infinity
    for (let x = hit - 0.5; x < hit + 1.6; x += 1 / 60) {
      const layerTime = x - evaluateAccents(p, x).timeLag
      expect(layerTime).toBeGreaterThanOrEqual(prev)
      prev = layerTime
    }
    expect(evaluateAccents(p, hit + 1.25).timeLag).toBe(0)
  })

  it('style defaults apply under the accent params', () => {
    const { tl, hit } = withAccent('flash')
    const f = evaluateAccents(prepareAccents(tl, { style: 'neon' }), hit + t)
    expect(f.overlays[0]).toMatchObject({ kind: 'flash', color: '#ff4fd8' })
    tl.accents[0]!.params = { color: '#00ff00' }
    const g = evaluateAccents(prepareAccents(tl, { style: 'neon' }), hit + t)
    expect(g.overlays[0]).toMatchObject({ color: '#00ff00' })
  })
})

describe('rhythm', () => {
  it('falls back to downbeat = 1, other beats = 0.6 without beatStrength', () => {
    const tl = createFakeTimeline({ durationSec: 10 })
    delete tl.audio.rhythm.beatStrength
    expect(beatAt(tl.audio, 0.01).strength).toBe(1)
    expect(beatAt(tl.audio, 0.51).strength).toBe(0.6)
    expect(beatAt(tl.audio, -1).index).toBe(-1)
  })

  it('uses beatStrength when present', () => {
    const tl = createFakeTimeline({ durationSec: 10 })
    tl.audio.rhythm.beatStrength = new Float32Array(tl.audio.rhythm.beats.length).fill(0.3)
    expect(beatAt(tl.audio, 0.51).strength).toBeCloseTo(0.3)
  })

  it('boosts inside drops and ignores missing sections', () => {
    const tl = createFakeTimeline({ durationSec: 10 })
    delete tl.audio.sections
    expect(dropAmountAt(tl.audio, 5)).toBe(0)
    const plain = beatPulse(tl.audio, 4.01, 0.14, 2)
    tl.audio.sections = [
      { start: 0, end: 4, kind: 'normal', energy: 0.5 },
      { start: 4, end: 8, kind: 'drop', energy: 1 },
    ]
    expect(dropAmountAt(tl.audio, 5)).toBe(1)
    expect(beatPulse(tl.audio, 4.01, 0.14, 2)).toBeCloseTo(plain * 2)
  })

  it('flashes only on strong beats', () => {
    const tl = createFakeTimeline({ durationSec: 10 })
    delete tl.audio.rhythm.beatStrength
    const params = resolveParams(BEAT_FLASH_PARAMS, { amount: 0.5, threshold: 0.9, sectionReact: 0 })
    expect(beatFlash(tl.audio, 2.01, params)?.alpha).toBeGreaterThan(0.3) // downbeat
    expect(beatFlash(tl.audio, 2.51, params)).toBeNull()
  })
})

describe('createEffect', () => {
  it('returns null for unknown types and an effect for every known one', () => {
    expect(createEffect({ id: 'x', type: 'nope' }, { seed: 1 })).toBeNull()
    for (const type of Object.keys(EFFECT_TYPES)) {
      const e = createEffect({ id: type, type }, { seed: 1 })
      expect(e?.id).toBe(type)
    }
  })

  it('style presets use only known effect types', () => {
    for (const id of EFFECT_STYLE_ORDER) {
      for (const spec of styleEffects(id)) expect(isEffectType(spec.type)).toBe(true)
    }
  })

  it('accents effect composes camera and warps time', () => {
    const { tl, hit } = withAccent('zoom-punch')
    const e = createEffect({ id: 'acc', type: 'accents' }, { seed: 1 })!
    const cam = { zoom: 2, rotation: 0, x: 0, y: 0 }
    const frame = { timeline: tl, baseTime: hit + 0.02 } as unknown as Parameters<NonNullable<typeof e.camera>>[0]
    e.camera?.(frame, cam)
    expect(cam.zoom).toBeGreaterThan(2.2)

    const { tl: tl2, hit: hit2 } = withAccent('slow-motion')
    const s = createEffect({ id: 'acc', type: 'accents' }, { seed: 1 })!
    const info = { frameIndex: 0, fps: 60, baseTime: hit2 + 0.2, timeline: tl2 }
    expect(s.remapTime?.(info.baseTime, info)).toBeLessThan(info.baseTime)
  })
})
