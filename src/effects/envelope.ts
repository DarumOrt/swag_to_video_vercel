/**
 * Accent timing: the window an accent is active in and its envelope (attack → peak → release).
 *
 *   start = word.start - preRollSec        attack (anticipation), rises 0 → 1
 *   peak  = word.start                      the hit
 *   end   = word.start + durationSec        release, falls 1 → 0
 *
 * With preRollSec = 0 the attack would be instantaneous, which aliases at 24–30 fps, so it is
 * stretched to at least MIN_ATTACK_SEC *after* the hit instead (peak moves slightly later).
 *
 * Range accents (`Accent.endWordId`) hold the peak until the end of the last word, then release:
 *
 *   start → peak (attack) → hold = range end (envelope 1) → end = hold + release
 *
 * The release of a range is `durationSec` capped at RANGE_MAX_RELEASE_SEC, so the accent goes off
 * close to where the user ended it.
 */

import { ease, type CurveId } from './math'

export const MIN_ATTACK_SEC = 1 / 60
export const RANGE_MAX_RELEASE_SEC = 0.35

export interface AccentWindow {
  start: number
  peak: number
  /** Release starts here; equals `peak` for a one-shot accent. */
  hold: number
  end: number
  /** True for a range accent (held over several words). */
  range: boolean
  /** The word's own start/end (end may be null when the word has no end time). */
  wordStart: number
  wordEnd: number | null
}

export interface EnvelopeShape {
  attack: CurveId
  release: CurveId
}

export const DEFAULT_ENVELOPE: EnvelopeShape = { attack: 'ease', release: 'soft' }

export function accentWindow(
  wordStart: number,
  wordEnd: number | null,
  preRollSec: number,
  durationSec: number,
  /** Range end (end of the last word of a range accent); omitted for a one-shot. */
  holdUntil?: number,
): AccentWindow {
  const pre = Math.max(0, preRollSec)
  const dur = Math.max(MIN_ATTACK_SEC * 2, durationSec)
  const peak = pre >= MIN_ATTACK_SEC ? wordStart : wordStart + MIN_ATTACK_SEC
  if (holdUntil !== undefined && Number.isFinite(holdUntil)) {
    const hold = Math.max(peak, holdUntil)
    const release = Math.min(dur, RANGE_MAX_RELEASE_SEC)
    return { start: wordStart - pre, peak, hold, end: hold + release, range: true, wordStart, wordEnd }
  }
  return {
    start: wordStart - pre,
    peak,
    hold: peak,
    end: wordStart + dur,
    range: false,
    wordStart,
    wordEnd,
  }
}

/** True while a range accent holds its peak (between the hit and the range end). */
export function isHolding(w: AccentWindow, t: number): boolean {
  return w.range && t >= w.peak && t < w.hold
}

export function isActive(w: AccentWindow, t: number): boolean {
  return t >= w.start && t < w.end
}

/** Envelope value at time t: 0 outside the window, 1 at the peak. Elastic release may overshoot. */
export function envelopeAt(w: AccentWindow, t: number, shape: EnvelopeShape = DEFAULT_ENVELOPE): number {
  if (t < w.start || t >= w.end) return 0
  if (t < w.peak) return ease(shape.attack, (t - w.start) / (w.peak - w.start))
  if (t < w.hold) return 1
  return 1 - ease(shape.release, (t - w.hold) / (w.end - w.hold))
}

/** Linear progress 0..1 across the whole window. */
export function windowProgress(w: AccentWindow, t: number): number {
  const span = w.end - w.start
  return span > 0 ? Math.min(Math.max((t - w.start) / span, 0), 1) : 1
}
