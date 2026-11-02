/**
 * Beat and section lookup at a time. Pure; used by layers (via FrameContext) and effects.
 */

import type { AudioSection, Timeline } from '@/shared'

export interface BeatInfo {
  /** Index of the last beat at or before t; -1 before the first beat (or no beats). */
  index: number
  /** Time of that beat (or 0). */
  time: number
  /** Seconds since that beat. */
  since: number
  /** Position between this beat and the next, 0..1 (0 when unknown). */
  phase: number
  /** 0..1: `rhythm.beatStrength` when present, else the low band at the beat. */
  strength: number
  downbeat: boolean
}

/** Last index i with arr[i] <= t, or -1. */
export function lastIndexAtOrBefore(arr: ArrayLike<number>, t: number): number {
  let lo = 0
  let hi = arr.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((arr[mid] ?? Infinity) <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export function beatAt(timeline: Timeline, t: number): BeatInfo {
  const { beats, downbeats, beatStrength } = timeline.audio.rhythm
  const i = lastIndexAtOrBefore(beats, t + 1e-6)
  if (i < 0) return { index: -1, time: 0, since: t, phase: 0, strength: 0, downbeat: false }
  const time = beats[i] ?? 0
  const next = beats[i + 1]
  const since = Math.max(t - time, 0)
  const phase = next !== undefined && next > time ? Math.min(since / (next - time), 1) : 0
  let strength = beatStrength?.[i]
  if (strength === undefined) {
    const f = timeline.audio.features
    const idx = Math.min(Math.max(Math.floor(time * f.rate + 1e-6), 0), f.frameCount - 1)
    strength = f.bands.low[idx] ?? 0
  }
  const d = lastIndexAtOrBefore(downbeats, time + 1e-6)
  const downbeat = d >= 0 && Math.abs((downbeats[d] ?? -1) - time) < 1e-3
  return { index: i, time, since, phase, strength, downbeat }
}

export function sectionAt(timeline: Timeline, t: number): AudioSection | null {
  const sections = timeline.audio.sections
  if (!sections || sections.length === 0) return null
  // Few sections per track: a linear scan is fine and allocates nothing.
  let found = sections[0] ?? null
  for (const s of sections) {
    if (s.start <= t) found = s
    else break
  }
  return found
}
