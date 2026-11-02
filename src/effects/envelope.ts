/**
 * Accent timing: the window an accent is active in and its envelope (attack → peak → release).
 *
 *   start = word.start - preRollSec        attack (anticipation), rises 0 → 1
 *   peak  = word.start                      the hit
 *   end   = word.start + durationSec        release, falls 1 → 0
 *
 * With preRollSec = 0 the attack would be instantaneous, which aliases at 24–30 fps, so it is
 * stretched to at least MIN_ATTACK_SEC *after* the hit instead (peak moves slightly later).
 */

import { ease, type CurveId } from './math'

export const MIN_ATTACK_SEC = 1 / 60

export interface AccentWindow {
  start: number
  peak: number
  end: number
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
): AccentWindow {
  const pre = Math.max(0, preRollSec)
  const dur = Math.max(MIN_ATTACK_SEC * 2, durationSec)
  const peak = pre >= MIN_ATTACK_SEC ? wordStart : wordStart + MIN_ATTACK_SEC
  return {
    start: wordStart - pre,
    peak,
    end: wordStart + dur,
    wordStart,
    wordEnd,
  }
}

export function isActive(w: AccentWindow, t: number): boolean {
  return t >= w.start && t < w.end
}

/** Envelope value at time t: 0 outside the window, 1 at the peak. Elastic release may overshoot. */
export function envelopeAt(w: AccentWindow, t: number, shape: EnvelopeShape = DEFAULT_ENVELOPE): number {
  if (t < w.start || t >= w.end) return 0
  if (t < w.peak) return ease(shape.attack, (t - w.start) / (w.peak - w.start))
  return 1 - ease(shape.release, (t - w.peak) / (w.end - w.peak))
}

/** Linear progress 0..1 across the whole window. */
export function windowProgress(w: AccentWindow, t: number): number {
  const span = w.end - w.start
  return span > 0 ? Math.min(Math.max((t - w.start) / span, 0), 1) : 1
}
