import { describe, expect, it } from 'vitest'
import { accentWindow, envelopeAt, isActive, MIN_ATTACK_SEC, windowProgress } from './envelope'
import { ease, type CurveId } from './math'

describe('accentWindow', () => {
  it('spans pre-roll before the word to duration after it', () => {
    const w = accentWindow(10, 10.5, 0.2, 0.4)
    expect(w.start).toBeCloseTo(9.8)
    expect(w.peak).toBe(10)
    expect(w.end).toBeCloseTo(10.4)
  })

  it('moves the peak slightly after the word when there is no pre-roll', () => {
    const w = accentWindow(5, null, 0, 0.3)
    expect(w.start).toBe(5)
    expect(w.peak).toBeCloseTo(5 + MIN_ATTACK_SEC)
  })

  it('treats negative values as zero / minimal', () => {
    const w = accentWindow(1, 2, -1, -1)
    expect(w.start).toBe(1)
    expect(w.end).toBeGreaterThan(w.peak)
  })
})

describe('envelopeAt', () => {
  const w = accentWindow(10, 11, 0.2, 0.5)

  it('is 0 outside the window and 1 at the peak', () => {
    expect(envelopeAt(w, 9.79)).toBe(0)
    expect(envelopeAt(w, 10.5)).toBe(0)
    expect(envelopeAt(w, 10)).toBeCloseTo(1)
    expect(isActive(w, 10.49)).toBe(true)
    expect(isActive(w, 10.5)).toBe(false)
  })

  it('rises during the attack and falls during the release', () => {
    const shape = { attack: 'linear', release: 'linear' } as const
    expect(envelopeAt(w, 9.9, shape)).toBeCloseTo(0.5)
    expect(envelopeAt(w, 10.25, shape)).toBeCloseTo(0.5)
    let prev = -1
    for (let t = 9.8; t < 10; t += 0.01) {
      const v = envelopeAt(w, t, shape)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('progress covers the window linearly', () => {
    expect(windowProgress(w, 9.8)).toBe(0)
    expect(windowProgress(w, 10.5)).toBe(1)
    expect(windowProgress(w, 10.15)).toBeCloseTo(0.5)
  })
})

describe('ease', () => {
  it.each<CurveId>(['linear', 'ease', 'sharp', 'soft', 'elastic'])('%s maps 0→0 and 1→1', (c) => {
    expect(ease(c, 0)).toBeCloseTo(0)
    expect(ease(c, 1)).toBeCloseTo(1)
    expect(ease(c, -5)).toBeCloseTo(0)
    expect(ease(c, 5)).toBeCloseTo(1)
  })
})
