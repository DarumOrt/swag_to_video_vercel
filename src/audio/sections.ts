import type { AudioSection, SectionKind } from '@/shared'
import { slidingMedian } from './median'
import { clamp01, percentile } from './util'

/*
 * Beat strengths and energy sections, both built on raw per-frame power (not the display-scaled
 * bands), so they do not change when the visual normalization is retuned.
 */

const SILENCE_DB = -200

function toDb(power: ArrayLike<number>): Float32Array {
  const out = new Float32Array(power.length)
  for (let i = 0; i < power.length; i++) {
    const p = power[i]!
    out[i] = p > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(p)) : SILENCE_DB
  }
  return out
}

/** Linear map of `value` from [lo, hi] to 0..1; 0 when the range is degenerate. */
function scaled(value: number, lo: number, hi: number): number {
  return hi > lo ? clamp01((value - lo) / (hi - lo)) : 0
}

// ---------------------------------------------------------------------------
// Beat strength
// ---------------------------------------------------------------------------

/** Kick rise above the running low-band median that counts as full strength. */
const KICK_RANGE_DB = 10
const KICK_BASELINE_SEC = 0.5

/**
 * Strength 0..1 of each beat: kick punch (low-band rise above its running median), low-band level
 * against the track, and onset strength at the beat. Scaled so the track's strong beats (95th
 * percentile) read 1.
 */
export function beatStrengths(
  beats: Float32Array,
  lowPower: Float64Array,
  flux: Float32Array,
  rate: number,
): Float32Array {
  const out = new Float32Array(beats.length)
  const n = lowPower.length
  if (beats.length === 0 || n === 0) return out

  const lowDb = toDb(lowPower)
  const baseline = new Float32Array(n)
  slidingMedian(lowDb, baseline, n, 0, 1, Math.max(1, Math.round(KICK_BASELINE_SEC * rate)))
  const levelLo = percentile(lowDb, 0.1)
  const levelHi = percentile(lowDb, 0.95)
  const fluxScale = percentile(flux, 0.99)

  // Look from just before the beat to ~70 ms after it (kick attack and body).
  const before = Math.max(1, Math.round(0.017 * rate))
  const after = Math.max(1, Math.round(0.07 * rate))
  const raw = new Float32Array(beats.length)
  for (let k = 0; k < beats.length; k++) {
    const frame = Math.floor(beats[k]! * rate)
    let rise = 0
    let level = SILENCE_DB
    let onset = 0
    for (let i = Math.max(0, frame - before); i <= Math.min(n - 1, frame + after); i++) {
      rise = Math.max(rise, lowDb[i]! - baseline[i]!)
      level = Math.max(level, lowDb[i]!)
      onset = Math.max(onset, flux[i]!)
    }
    raw[k] =
      0.4 * clamp01(rise / KICK_RANGE_DB) +
      0.3 * scaled(level, levelLo, levelHi) +
      0.3 * (fluxScale > 0 ? clamp01(onset / fluxScale) : 0)
  }
  const top = percentile(raw, 0.95)
  if (!(top > 0)) return out
  for (let k = 0; k < raw.length; k++) out[k] = clamp01(raw[k]! / top)
  return out
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Bar length when there is no tempo. */
const FALLBACK_BAR_SEC = 2
/** Smoothed bar energy below this is quiet. */
const QUIET_LEVEL = 0.3
/** A drop: low-band level jumps by this much (0..1 scale) against the previous bars… */
const DROP_LOW_JUMP = 0.3
/** …to at least this energy, coming from bars at least this much quieter. */
const DROP_MIN_ENERGY = 0.6
const DROP_RISE = 0.2
/** Bars compared before a drop candidate. */
const DROP_LOOKBACK_BARS = 4
/** A drop lasts while the energy stays above this, at most DROP_MAX_BARS. */
const DROP_SUSTAIN_ENERGY = 0.5
const DROP_MAX_BARS = 16
/** A build is up to this many bars before a drop with the bass held back by this much. */
const BUILD_MAX_BARS = 8
const BUILD_LOW_GAP = 0.15
/** …and the energy rising: the build starts at the first bar-to-bar step of at least this… */
const BUILD_MIN_STEP = 0.01
/** …and climbs by at least this much in total. */
const BUILD_MIN_RISE = 0.08
/** Minimum section length in bars; shorter runs merge into a neighbor (no flicker). */
const MIN_BARS: Record<SectionKind, number> = { quiet: 2, build: 2, drop: 4, normal: 4 }

/** Bars compared on each side of a split point. */
const SPLIT_WINDOW_BARS = 4
/** Each part of a split is at least this long (a verse or chorus is usually 8+ bars). */
const SPLIT_MIN_BARS = 8
/** Mean energy difference (0..1 scale) between the windows around the split point… */
const SPLIT_MIN_CHANGE = 0.12
/** …and between the two whole parts, so a split separates real levels, not a fill. */
const SPLIT_MIN_PART_CHANGE = 0.1

/**
 * Recursively splits a run at the bar where the mean energy of the bars after it differs most
 * from the bars before it, while both the local step and the whole parts differ enough.
 */
function splitByEnergy(run: Run, energy: Float32Array): Run[] {
  const mean = (from: number, to: number) => {
    let sum = 0
    for (let b = from; b < to; b++) sum += energy[b]!
    return sum / (to - from)
  }
  let best = -1
  let bestChange = SPLIT_MIN_CHANGE
  for (let k = run.first + SPLIT_MIN_BARS; k <= run.last + 1 - SPLIT_MIN_BARS; k++) {
    const change = Math.abs(mean(k, k + SPLIT_WINDOW_BARS) - mean(k - SPLIT_WINDOW_BARS, k))
    if (change > bestChange) {
      bestChange = change
      best = k
    }
  }
  if (best < 0) return [run]
  if (Math.abs(mean(run.first, best) - mean(best, run.last + 1)) < SPLIT_MIN_PART_CHANGE) {
    return [run]
  }
  return [
    ...splitByEnergy({ kind: run.kind, first: run.first, last: best - 1 }, energy),
    ...splitByEnergy({ kind: run.kind, first: best, last: run.last }, energy),
  ]
}

export interface SectionInput {
  durationSec: number
  rate: number
  rms: Float32Array
  lowPower: Float64Array
  bpm: number | null
  downbeats: Float32Array
}

/**
 * Bar boundaries: the detected downbeats, extended with the bar period before the first, after the
 * last and across gaps; fixed 2 s blocks without a tempo. Starts at 0, ends at the duration.
 */
export function barBoundaries(
  durationSec: number,
  bpm: number | null,
  downbeats: Float32Array,
): number[] {
  if (durationSec <= 0) return [0]
  const bar = bpm ? (4 * 60) / bpm : FALLBACK_BAR_SEC
  const anchors = bpm && downbeats.length > 0 ? Array.from(downbeats) : [0]
  const times: number[] = []
  for (let t = anchors[0]! - bar; t > bar * 0.25; t -= bar) times.push(t)
  times.reverse()
  for (let k = 0; k < anchors.length; k++) {
    const t = anchors[k]!
    times.push(t)
    const next = anchors[k + 1]
    const limit = next ?? durationSec
    for (let u = t + bar; u < limit - bar * 0.25; u += bar) times.push(u)
  }
  const out = [0]
  for (const t of times) if (t > out[out.length - 1]! + bar * 0.25 && t < durationSec) out.push(t)
  out.push(durationSec)
  return out
}

interface Run {
  kind: SectionKind
  first: number
  last: number
}

export function detectSections(input: SectionInput): AudioSection[] {
  const { durationSec, rate } = input
  const boundaries = barBoundaries(durationSec, input.bpm, input.downbeats)
  const barCount = boundaries.length - 1
  if (barCount < 1) return []

  // Per-bar loudness and low-band level, dB.
  const energyDb = new Float32Array(barCount)
  const lowDb = new Float32Array(barCount)
  for (let b = 0; b < barCount; b++) {
    const from = Math.floor(boundaries[b]! * rate)
    const to = Math.max(from + 1, Math.min(input.rms.length, Math.floor(boundaries[b + 1]! * rate)))
    let e = 0
    let l = 0
    for (let i = from; i < to; i++) {
      e += input.rms[i]! ** 2
      l += input.lowPower[i]!
    }
    energyDb[b] = e > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(e / (to - from))) : SILENCE_DB
    lowDb[b] = l > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(l / (to - from))) : SILENCE_DB
  }
  if (energyDb.every((v) => v <= SILENCE_DB)) {
    return [{ start: 0, end: durationSec, kind: 'quiet', energy: 0 }]
  }

  // 0..1 against the track; bar energy = loudness and bass together.
  const audible = (values: Float32Array) => values.filter((v) => v > SILENCE_DB)
  const eLo = percentile(audible(energyDb), 0.1)
  const eHi = percentile(audible(energyDb), 0.95)
  const lLo = percentile(audible(lowDb), 0.1)
  const lHi = percentile(audible(lowDb), 0.95)
  // Never stretch less than 12 dB over the scale, so a steady track does not look dramatic.
  const low = new Float32Array(barCount)
  const energy = new Float32Array(barCount)
  for (let b = 0; b < barCount; b++) {
    low[b] = scaled(lowDb[b]!, Math.min(lLo, lHi - 12), lHi)
    energy[b] = 0.5 * scaled(energyDb[b]!, Math.min(eLo, eHi - 12), eHi) + 0.5 * low[b]!
  }
  const smooth = new Float32Array(barCount)
  slidingMedian(energy, smooth, barCount, 0, 1, 1)

  const kinds: SectionKind[] = Array.from({ length: barCount }, (_, b) =>
    smooth[b]! < QUIET_LEVEL ? 'quiet' : 'normal',
  )

  // Drops, then the builds leading into them.
  const pair = (values: Float32Array, b: number) =>
    b + 1 < barCount ? 0.5 * (values[b]! + values[b + 1]!) : values[b]!
  for (let b = DROP_LOOKBACK_BARS; b < barCount; b++) {
    if (kinds[b - 1] === 'drop') continue
    const from = Math.max(0, b - DROP_LOOKBACK_BARS)
    let priorLow = 0
    let priorEnergy = 0
    for (let k = from; k < b; k++) {
      priorLow += low[k]!
      priorEnergy += energy[k]!
    }
    priorLow /= b - from
    priorEnergy /= b - from
    const dropEnergy = pair(energy, b)
    if (
      pair(low, b) - priorLow < DROP_LOW_JUMP ||
      dropEnergy < DROP_MIN_ENERGY ||
      dropEnergy - priorEnergy < DROP_RISE
    ) {
      continue
    }
    let end = b
    while (end < barCount && end - b < DROP_MAX_BARS && smooth[end]! >= DROP_SUSTAIN_ENERGY) {
      kinds[end] = 'drop'
      end++
    }
    if (end === b) continue
    // Build: the bars before the drop with the bass held back, from where the energy starts to
    // climb (a flat lead-in stays what it was).
    const dropLow = pair(low, b)
    let start = b
    while (
      start - 1 >= Math.max(0, b - BUILD_MAX_BARS) &&
      kinds[start - 1] !== 'drop' &&
      low[start - 1]! <= dropLow - BUILD_LOW_GAP
    ) {
      start--
    }
    while (start < b - 1 && energy[start + 1]! - energy[start]! < BUILD_MIN_STEP) start++
    if (b - start >= MIN_BARS.build && energy[b - 1]! - energy[start]! >= BUILD_MIN_RISE) {
      for (let k = start; k < b; k++) kinds[k] = 'build'
    }
    b = end - 1
  }

  // Runs of equal kind; merge the shortest too-short run into its closer-energy neighbor.
  let runs: Run[] = []
  for (let b = 0; b < barCount; b++) {
    const last = runs[runs.length - 1]
    if (last && last.kind === kinds[b]) last.last = b
    else runs.push({ kind: kinds[b]!, first: b, last: b })
  }
  const meanEnergy = (run: Run) => {
    let sum = 0
    for (let b = run.first; b <= run.last; b++) sum += energy[b]!
    return sum / (run.last - run.first + 1)
  }
  for (;;) {
    let shortest = -1
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!
      const bars = run.last - run.first + 1
      if (runs.length > 1 && bars < MIN_BARS[run.kind]) {
        if (shortest < 0 || bars < runs[shortest]!.last - runs[shortest]!.first + 1) shortest = r
      }
    }
    if (shortest < 0) break
    const run = runs[shortest]!
    const prev = runs[shortest - 1]
    const next = runs[shortest + 1]
    const e = meanEnergy(run)
    const target =
      prev && (!next || Math.abs(meanEnergy(prev) - e) <= Math.abs(meanEnergy(next) - e))
        ? prev
        : next!
    target.first = Math.min(target.first, run.first)
    target.last = Math.max(target.last, run.last)
    runs.splice(shortest, 1)
    // Neighbors of the same kind become one run.
    const merged: Run[] = []
    for (const r of runs) {
      const last = merged[merged.length - 1]
      if (last && last.kind === r.kind) last.last = r.last
      else merged.push({ ...r })
    }
    runs = merged
  }

  // Split long runs where the energy level changes (verse vs. chorus keep their kind but get
  // their own energy).
  runs = runs.flatMap((run) => splitByEnergy(run, energy))

  return runs.map((run) => ({
    start: boundaries[run.first]!,
    end: boundaries[run.last + 1]!,
    kind: run.kind,
    energy: Math.round(meanEnergy(run) * 1000) / 1000,
  }))
}
