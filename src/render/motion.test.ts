import { describe, expect, it } from 'vitest'
import type { Timeline } from '@/shared'
import { createFakeTimeline } from './dev/fakeTimeline'
import { beatKick, cameraAtDepth, layerMotionAt, sectionLevel } from './motion'
import { beatAt } from './rhythm'

function withSections(base: Timeline): Timeline {
  return {
    ...base,
    audio: {
      ...base.audio,
      sections: [
        { start: 0, end: 4, kind: 'quiet', energy: 0.2 },
        { start: 4, end: 8, kind: 'build', energy: 0.6 },
        { start: 8, end: 20, kind: 'drop', energy: 1 },
      ],
    },
  }
}

const timeline = withSections(createFakeTimeline({ durationSec: 20 }))
const levels = { quiet: 0.2, build: 0.6, drop: 1 }

describe('layer motion', () => {
  it('section level holds inside a section and crossfades at its start', () => {
    expect(sectionLevel(timeline, 2, levels)).toBe(0.2)
    expect(sectionLevel(timeline, 4, levels, 1)).toBeCloseTo(0.2)
    expect(sectionLevel(timeline, 4.5, levels, 1)).toBeCloseTo(0.4)
    expect(sectionLevel(timeline, 5.5, levels, 1)).toBeCloseTo(0.6)
    expect(sectionLevel(timeline, 12, levels)).toBe(1)
    expect(sectionLevel(timeline, 12, undefined)).toBe(1)
  })

  it('beat kick decays after the beat and is pure', () => {
    const at = (t: number) => beatKick(beatAt(timeline, t), 0.18, false)
    const beat = timeline.audio.rhythm.beats[10] ?? 0
    expect(at(beat)).toBeGreaterThan(at(beat + 0.1))
    expect(at(beat + 0.1)).toBeGreaterThan(at(beat + 0.3))
    expect(at(beat + 0.1)).toBe(at(beat + 0.1))
  })

  it('combines sections and beats; no motion = identity', () => {
    const beat = timeline.audio.rhythm.beats.find((b) => b > 9) ?? 9
    const s = layerMotionAt(
      { sections: levels, beatScale: 0.1 },
      timeline,
      beat,
      beatAt(timeline, beat),
    )
    expect(s.alpha).toBe(1)
    expect(s.scale).toBeGreaterThan(1)
    expect(layerMotionAt({}, timeline, 3, beatAt(timeline, 3))).toEqual({ alpha: 1, scale: 1 })
  })

  it('depth scales the camera', () => {
    const c = { zoom: 1.2, rotation: 0.1, x: 0.02, y: -0.01 }
    expect(cameraAtDepth(c, 0)).toEqual({ zoom: 1, rotation: 0, x: 0, y: -0 })
    expect(cameraAtDepth(c, 1)).toEqual(c)
    expect(cameraAtDepth(c, 0.5).zoom).toBeCloseTo(Math.sqrt(1.2))
  })
})
