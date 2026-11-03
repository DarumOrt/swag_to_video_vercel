import { describe, expect, it } from 'vitest'
import { frameCountFor } from './output'
import { featureIndexAt, sectionRole, type AudioSection, type FrameFeatures } from './timeline'

const features = { rate: 60, frameCount: 600 } as FrameFeatures

describe('featureIndexAt', () => {
  it('maps time to the feature grid', () => {
    expect(featureIndexAt(features, 0)).toBe(0)
    expect(featureIndexAt(features, 1)).toBe(60)
    expect(featureIndexAt(features, 1.009)).toBe(60)
    expect(featureIndexAt(features, 245 / 60)).toBe(245)
  })

  it('clamps out-of-range times', () => {
    expect(featureIndexAt(features, -1)).toBe(0)
    expect(featureIndexAt(features, 100)).toBe(599)
  })
})

describe('frameCountFor', () => {
  it('rounds partial frames up', () => {
    expect(frameCountFor(10, 30)).toBe(300)
    expect(frameCountFor(10.01, 30)).toBe(301)
  })
})

describe('sectionRole', () => {
  const s = (kind: AudioSection['kind'], role?: AudioSection['role']): AudioSection => ({
    start: 0,
    end: 1,
    kind,
    energy: 0.5,
    role,
  })
  it('prefers the analysed role', () => {
    expect(sectionRole([s('drop', 'chorus')], 0)).toBe('chorus')
  })
  it('guesses from kind and position', () => {
    const list = [s('quiet'), s('normal'), s('build'), s('drop'), s('quiet'), s('normal')]
    expect(list.map((_, i) => sectionRole(list, i))).toEqual([
      'intro',
      'verse',
      'pre-chorus',
      'drop',
      'breakdown',
      'outro',
    ])
  })
})
