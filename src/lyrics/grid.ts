/**
 * BPM grid: pulls line (and word) starts onto subdivisions of the detected beats.
 *
 * The grid is built between neighbouring beats, not from a single BPM, so tempo drift does not
 * accumulate: every beat interval is split into equal parts. Before the first and after the last
 * beat the neighbouring interval is extended.
 */
import type { LyricWord, Lyrics, Rhythm, TimingSource } from '@/shared'
import { flattenWords, withWords } from './model'
import { DEFAULT_TIMING, sanitizeTimings } from './timing'

/** Grid step as a fraction of the bar (4/4): 4 = beats, 8 = eighths, 16 = sixteenths. */
export type GridDivision = 4 | 8 | 16

export const GRID_DIVISIONS: readonly GridDivision[] = [4, 8, 16]

export type GridMode = 'lines' | 'words' | 'both'

export interface GridSnapOptions {
  division: GridDivision
  /** 0 = no pull, 1 = land exactly on the grid line. */
  strength: number
  /** `lines`: first word of each line; `words`: every word; `both`: line starts at full strength, other words at half. */
  mode: GridMode
  /** Max distance a start may travel, seconds. */
  maxShiftSec: number
  minWordSec: number
  /** Which timings may move. User-made ('manual', 'tap', 'imported') stay put by default. */
  sources: readonly TimingSource[]
}

export const DEFAULT_GRID_SNAP: GridSnapOptions = {
  division: 8,
  strength: 0.8,
  mode: 'lines',
  maxShiftSec: 0.12,
  minWordSec: DEFAULT_TIMING.minWordSec,
  sources: ['whisper', 'aligned', 'interpolated', 'snapped'],
}

/** In `both` mode non-line-start words are pulled with this share of `strength`. */
const INNER_WORD_FACTOR = 0.5

/** Fit score from which the front may switch the grid on by itself (and offer it as the default). */
export const GRID_AUTO_THRESHOLD = 0.5

/** Fewer timed words than this give no reliable fit. */
const MIN_FIT_WORDS = 8

type Beats = ArrayLike<number>

/** Nearest grid line to `t` for `sub` parts per beat, or null if there are fewer than 2 beats. */
export function nearestGridTime(beats: Beats, sub: number, t: number): number | null {
  const n = beats.length
  if (n < 2 || sub < 1) return null
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid]! <= t) lo = mid + 1
    else hi = mid
  }
  // beats[i] <= t < beats[i + 1] with i clamped so that both ends exist (extrapolates at the edges).
  const i = Math.min(Math.max(lo - 1, 0), n - 2)
  const a = beats[i]!
  const step = (beats[i + 1]! - a) / sub
  if (!(step > 0)) return null
  return a + Math.round((t - a) / step) * step
}

function stepAt(beats: Beats, sub: number, t: number): number {
  let i = 0
  while (i < beats.length - 2 && beats[i + 1]! <= t) i++
  return (beats[i + 1]! - beats[i]!) / sub
}

/**
 * Moves eligible word starts toward the nearest grid line (marks them 'snapped').
 * A move is skipped if it would pass the neighbouring words or exceed `maxShiftSec`.
 * The previous word's end is trimmed to the new start; the word's own end stays unless the word
 * would get shorter than `minWordSec`. Run it after `snapToOnsets`.
 */
export function snapToBeatGrid(
  lyrics: Lyrics,
  rhythm: Pick<Rhythm, 'beats'>,
  options: Partial<GridSnapOptions> = {},
): Lyrics {
  const { division, strength, mode, maxShiftSec, minWordSec, sources } = {
    ...DEFAULT_GRID_SNAP,
    ...options,
  }
  const sub = division / 4
  const beats = rhythm.beats
  if (beats.length < 2 || strength <= 0) return lyrics

  const words: LyricWord[] = []
  const firstOfLine = new Set<string>()
  for (const line of lyrics.lines) {
    const first = line.words[0]
    if (first) firstOfLine.add(first.id)
    for (const w of line.words) words.push({ ...w })
  }

  words.forEach((word, i) => {
    if (word.start === null) return
    const isLineStart = firstOfLine.has(word.id)
    if (mode === 'lines' && !isLineStart) return
    const k = mode === 'both' && !isLineStart ? strength * INNER_WORD_FACTOR : strength
    if (!word.timingSource || !sources.includes(word.timingSource)) return
    const target = nearestGridTime(beats, sub, word.start)
    if (target === null) return
    const shift = target - word.start
    if (Math.abs(shift) < 1e-4 || Math.abs(shift) > maxShiftSec) return
    const start = word.start + shift * Math.min(k, 1)

    const prev = words[i - 1]
    const next = words[i + 1]
    let lower = -Infinity
    if (prev?.start != null) lower = prev.start + minWordSec
    if (prev?.end != null && !(prev.timingSource && sources.includes(prev.timingSource))) {
      lower = Math.max(lower, prev.end)
    }
    const upper = next?.start != null ? next.start - 2 * minWordSec : Infinity
    if (start < lower || start > upper) return

    word.start = start
    word.timingSource = 'snapped'
    if (word.end !== null && word.end < start + minWordSec) word.end = start + minWordSec
    if (prev && prev.end !== null && prev.end > start) prev.end = start
  })
  return withWords(lyrics, sanitizeTimings(words, minWordSec))
}

export interface BeatGridFit {
  /** 0..1: 0 = starts fall where chance would put them, 1 = every start sits on a grid line. */
  score: number
  /** Coarsest division that fits well (score ≥ 0.6), else the best-fitting one; 4 when nothing fits. */
  suggestedDivision: GridDivision
  /** Fit of each division. */
  byDivision: Record<GridDivision, number>
  wordCount: number
}

/** Fit of one division, 0..1. Normalised so uniformly random starts score ~0. */
function fitOf(starts: readonly number[], beats: Beats, division: GridDivision): number {
  const sub = division / 4
  let sum = 0
  let n = 0
  for (const t of starts) {
    const g = nearestGridTime(beats, sub, t)
    if (g === null) continue
    const step = stepAt(beats, sub, t)
    // Random offsets average step / 4 away from the nearest line.
    sum += Math.min(Math.abs(g - t) / (step / 4), 2)
    n++
  }
  return n === 0 ? 0 : Math.min(Math.max(1 - sum / n, 0), 1)
}

/**
 * How well word starts already sit on the beat grid. The front decides on `score`:
 * `score >= GRID_AUTO_THRESHOLD` → turn the grid on automatically with `suggestedDivision`.
 */
export function beatGridFit(lyrics: Lyrics, rhythm: Pick<Rhythm, 'beats'>): BeatGridFit {
  const starts = flattenWords(lyrics)
    .map((r) => r.word.start)
    .filter((t): t is number => t !== null)
  const byDivision: Record<GridDivision, number> = { 4: 0, 8: 0, 16: 0 }
  if (starts.length < MIN_FIT_WORDS || rhythm.beats.length < 4) {
    return { score: 0, suggestedDivision: 4, byDivision, wordCount: starts.length }
  }
  for (const d of GRID_DIVISIONS) byDivision[d] = fitOf(starts, rhythm.beats, d)
  const good = GRID_DIVISIONS.find((d) => byDivision[d] >= 0.6)
  const best = GRID_DIVISIONS.reduce((a, b) => (byDivision[b] > byDivision[a] ? b : a))
  const suggestedDivision = good ?? (byDivision[best] > 0.3 ? best : 4)
  return {
    score: byDivision[suggestedDivision],
    suggestedDivision,
    byDivision,
    wordCount: starts.length,
  }
}
