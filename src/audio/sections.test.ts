import { describe, expect, it } from 'vitest'
import type { AudioSection } from '@/shared'
import { analyzePcm } from './analyze'
import { SCOPE_POINTS, SCOPE_WINDOW_SEC } from './scope'
import { barBoundaries } from './sections'
import { clicks, clickTimes, lcg, pcmOf, silence, sine } from './test/synth'

const SR = 44100
const BPM = 128
const BEAT = 60 / BPM
const BAR = 4 * BEAT

/** A kick: pitch-swept sine with a fast decay. */
function addKick(track: Float32Array, time: number, gain: number) {
  const start = Math.round(time * SR)
  for (let k = 0; k < 0.15 * SR && start + k < track.length; k++) {
    const s = k / SR
    track[start + k] =
      track[start + k]! +
      gain * Math.sin(2 * Math.PI * (45 + 70 * Math.exp(-s * 30)) * s) * Math.exp(-s * 14)
  }
}

/**
 * 8 bars of a quiet pad, 8 bars of a build (hats and a snare roll getting louder, no bass),
 * 16 bars of a drop (kick + bass + hats), then 4 bars of the pad again.
 */
function edmTrack() {
  const bars = { intro: 8, build: 8, drop: 16, outro: 4 }
  const total = bars.intro + bars.build + bars.drop + bars.outro
  const seconds = total * BAR
  const track = silence(SR, seconds)
  const random = lcg(11)
  const pad = sine(SR, seconds, 330, 0.03)
  for (let i = 0; i < track.length; i++) track[i] = pad[i]!

  const buildStart = bars.intro * BAR
  const dropStart = (bars.intro + bars.build) * BAR
  const outroStart = dropStart + bars.drop * BAR
  // Build: 8th-note noise hits, louder and denser toward the drop.
  for (let t = buildStart; t < dropStart - 0.01; t += BEAT / 2) {
    const progress = (t - buildStart) / (dropStart - buildStart)
    const start = Math.round(t * SR)
    for (let k = 0; k < 0.04 * SR; k++) {
      track[start + k] =
        track[start + k]! +
        (0.05 + 0.25 * progress) * (random() * 2 - 1) * Math.exp(-k / (0.01 * SR))
    }
  }
  // Drop: kick on every beat (louder on the bar), sustained bass, hats.
  const bass = sine(SR, outroStart - dropStart, 55, 0.25)
  track.set(
    bass.map((v, i) => v + track[Math.round(dropStart * SR) + i]!),
    Math.round(dropStart * SR),
  )
  let beat = 0
  for (let t = dropStart; t < outroStart - 0.01; t += BEAT) {
    addKick(track, t, beat % 4 === 0 ? 0.7 : 0.45)
    beat++
  }
  const hats = clicks(SR, seconds, clickTimes(2 * BPM, outroStart, dropStart))
  for (let i = 0; i < track.length; i++) track[i] = track[i]! + 0.3 * hats[i]!
  return { track, seconds, buildStart, dropStart, outroStart }
}

function covering(sections: AudioSection[], duration: number) {
  expect(sections[0]!.start).toBe(0)
  expect(sections[sections.length - 1]!.end).toBeCloseTo(duration, 6)
  for (let k = 1; k < sections.length; k++) expect(sections[k]!.start).toBe(sections[k - 1]!.end)
  for (const s of sections) {
    expect(s.end).toBeGreaterThan(s.start)
    expect(s.energy).toBeGreaterThanOrEqual(0)
    expect(s.energy).toBeLessThanOrEqual(1)
  }
}

describe('sections', () => {
  it('finds quiet → build → drop → quiet in a synthetic EDM track', () => {
    const { track, seconds, buildStart, dropStart, outroStart } = edmTrack()
    const analysis = analyzePcm(pcmOf(SR, track, track))
    const sections = analysis.sections!
    covering(sections, seconds)

    const kinds = sections.map((s) => s.kind)
    expect(kinds).toEqual(['quiet', 'build', 'drop', 'quiet'])
    const [intro, build, drop, outro] = sections as [
      AudioSection,
      AudioSection,
      AudioSection,
      AudioSection,
    ]
    // Boundaries within a bar of the truth.
    expect(Math.abs(build.start - buildStart)).toBeLessThan(BAR + 0.1)
    expect(Math.abs(drop.start - dropStart)).toBeLessThan(0.5)
    expect(Math.abs(outro.start - outroStart)).toBeLessThan(BAR + 0.1)
    expect(drop.energy).toBeGreaterThan(build.energy)
    expect(build.energy).toBeGreaterThan(intro.energy)
  })

  it('reads silence as one quiet section', () => {
    const quiet = silence(SR, 6)
    const analysis = analyzePcm(pcmOf(SR, quiet, quiet))
    expect(analysis.sections).toEqual([{ start: 0, end: 6, kind: 'quiet', energy: 0 }])
  })

  it('keeps a steady loop in one section (no flicker)', () => {
    const seconds = 16 * BAR
    const track = sine(SR, seconds, 55, 0.25)
    for (let t = 0; t < seconds - 0.01; t += BEAT) addKick(track, t, 0.5)
    const sections = analyzePcm(pcmOf(SR, track)).sections!
    covering(sections, seconds)
    expect(sections.length).toBe(1)
    expect(sections[0]!.kind).toBe('normal')
  })

  it('builds a bar grid from downbeats, filling the edges and gaps', () => {
    const grid = barBoundaries(20, 120, Float32Array.from([3, 5, 13]))
    expect(grid).toEqual([0, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 20])
    expect(barBoundaries(5, null, new Float32Array(0))).toEqual([0, 2, 4, 5])
  })
})

describe('beatStrength', () => {
  it('has one value per beat and favors the accented kicks', () => {
    const { track } = edmTrack()
    const { rhythm } = analyzePcm(pcmOf(SR, track, track))
    expect(rhythm.beatStrength!.length).toBe(rhythm.beats.length)
    expect(rhythm.beats.length).toBeGreaterThan(40)
    for (const v of rhythm.beatStrength!) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    // Inside the drop: bar-start kicks are louder than the others.
    const dropStart = 16 * BAR
    let accented = 0
    let accentedCount = 0
    let plain = 0
    let plainCount = 0
    rhythm.beats.forEach((t, k) => {
      if (t < dropStart + BAR || t > dropStart + 15 * BAR) return
      const onBar =
        Math.abs(((t - dropStart) / BAR) % 1) < 0.05 || Math.abs(((t - dropStart) / BAR) % 1) > 0.95
      if (onBar) {
        accented += rhythm.beatStrength![k]!
        accentedCount++
      } else {
        plain += rhythm.beatStrength![k]!
        plainCount++
      }
    })
    expect(accentedCount).toBeGreaterThan(5)
    expect(accented / accentedCount).toBeGreaterThan(plain / plainCount + 0.05)
  })

  it('is empty without beats', () => {
    const quiet = silence(SR, 3)
    expect(analyzePcm(pcmOf(SR, quiet)).rhythm.beatStrength).toEqual(new Float32Array(0))
  })
})

describe('scope', () => {
  it('stores the waveform ending at each frame center', () => {
    const seconds = 1
    const left = sine(SR, seconds, 100, 0.8)
    const right = left.map((v) => -v)
    const { features } = analyzePcm(pcmOf(SR, left, right))
    const scope = features.scope!
    expect(scope.pointsPerFrame).toBe(SCOPE_POINTS)
    expect(scope.windowSec).toBe(SCOPE_WINDOW_SEC)
    expect(scope.left.length).toBe(features.frameCount * SCOPE_POINTS)

    // Last point of frame 30 ≈ the signal just before (30.5) / 60 s; right is the inverse.
    const frame = 30
    const last = scope.left[frame * SCOPE_POINTS + SCOPE_POINTS - 1]!
    const time = (frame + 0.5) / features.rate - SCOPE_WINDOW_SEC / SCOPE_POINTS / 2
    expect(last).toBeCloseTo(0.8 * Math.sin(2 * Math.PI * 100 * time), 1)
    expect(scope.right[frame * SCOPE_POINTS + 5]).toBeCloseTo(
      -scope.left[frame * SCOPE_POINTS + 5]!,
      6,
    )
    let max = 0
    for (const v of scope.left) max = Math.max(max, Math.abs(v))
    expect(max).toBeLessThanOrEqual(0.8)
    expect(max).toBeGreaterThan(0.75)
  })

  it('is zero before the track starts', () => {
    const { features } = analyzePcm(pcmOf(SR, sine(SR, 0.5, 200, 0.5)))
    // Frame 0 window starts 32 ms before t = 0: the first ~third of points is padding.
    expect(features.scope!.left[0]).toBe(0)
  })
})
