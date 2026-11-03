/**
 * How lyric text shows up: reveal modes (karaoke fill vs. words / lines appearing), enter / exit
 * animations and the line windows for appearing modes. Pure functions of time, shared by the
 * lyrics and kinetic layers.
 */

import type { LineTiming } from './lyricsTiming'

/**
 * - karaoke — the whole line is shown, sung words are filled;
 * - word — words appear one by one at their timing, earlier ones stay until the line leaves;
 * - word-solo — only the current word is on screen;
 * - line — the whole line appears at once;
 * - typewriter — letters appear within each word's timing;
 * - pop — words pop in with an overshooting scale.
 */
export type TextReveal = 'karaoke' | 'word' | 'word-solo' | 'line' | 'typewriter' | 'pop'
export const TEXT_REVEALS: readonly TextReveal[] = [
  'karaoke',
  'word',
  'word-solo',
  'line',
  'typewriter',
  'pop',
]

export type TextAnim = 'fade' | 'slide-up' | 'scale' | 'blur' | 'none'
export const TEXT_ANIMS: readonly TextAnim[] = ['fade', 'slide-up', 'scale', 'blur', 'none']

/** When a line leaves: after its last word (+ hold, but not after the next line shows), or only when the next line shows. */
export type LineExit = 'line-end' | 'next-line'

/** Drawing modifiers of an animated word / line. */
export interface AnimState {
  alpha: number
  /** Vertical offset in font sizes (+ = down). */
  dy: number
  scale: number
  /** Blur radius in font sizes. */
  blur: number
}

export const STILL: AnimState = { alpha: 1, dy: 0, scale: 1, blur: 0 }

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)
const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3

/**
 * Animation state at `p` = how much of the element is shown (0 = hidden, 1 = in place).
 * Entering slides up from below; leaving (`out`) slides further up.
 */
export function animState(anim: TextAnim, p: number, out = false): AnimState {
  if (anim === 'none') return p > 0 ? STILL : { ...STILL, alpha: 0 }
  const e = easeOutCubic(p)
  const rest = 1 - e
  switch (anim) {
    case 'fade':
      return { ...STILL, alpha: e }
    case 'slide-up':
      return { ...STILL, alpha: e, dy: (out ? -0.45 : 0.45) * rest }
    case 'scale':
      return { ...STILL, alpha: e, scale: out ? 1 + 0.2 * rest : 0.55 + 0.45 * e }
    case 'blur':
      return { ...STILL, alpha: e, blur: 0.22 * rest, scale: 1 + 0.06 * rest }
  }
}

/** Pop-in: overshoots past 1 and settles (back-out easing), quick fade-in. */
export function popState(since: number, durationSec: number): AnimState {
  const p = clamp01(since / Math.max(durationSec, 1e-3))
  if (since < 0) return { ...STILL, alpha: 0 }
  const c1 = 2.6
  const c3 = c1 + 1
  const back = 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2
  return { ...STILL, alpha: clamp01(p * 4), scale: 0.25 + 0.75 * back }
}

/** Typewriter: how many characters are shown (fractional: the next one fades in). */
export function typedChars(w: { start: number; end: number }, length: number, t: number): number {
  if (t < w.start) return 0
  // Very short words still type visibly instead of popping in whole.
  const dur = Math.max(w.end - w.start, 0.06 * length)
  return Math.min(length, ((t - w.start) / dur) * length)
}

/** When a line is on screen in an appearing mode. */
export interface LineWindow {
  /** First visible moment (enter animation starts). */
  show: number
  /** Exit animation starts. */
  hide: number
}

/**
 * Windows of lines (in timing order). `line` reveal shows the line at its lead-in (`appear`),
 * the other modes with its first word. Exit per `exit`; the last line leaves `holdSec` after its end.
 */
export function lineWindows(
  lines: readonly LineTiming[],
  reveal: TextReveal,
  exit: LineExit,
  holdSec: number,
): LineWindow[] {
  const show = lines.map((l) => (reveal === 'line' ? l.appear : l.start))
  return lines.map((l, i) => {
    const s = show[i] ?? l.start
    const next = show[i + 1]
    const afterEnd = l.end + holdSec
    // Never past the next line's show: two lines would overlap in the same place.
    const hide =
      next === undefined ? afterEnd : exit === 'next-line' ? next : Math.min(afterEnd, next)
    return { show: s, hide: Math.max(hide, s) }
  })
}

/** Line-level exit state at `t` (STILL before `hide`, null once fully gone). */
export function lineExitState(
  win: LineWindow,
  t: number,
  anim: TextAnim,
  animSec: number,
): AnimState | null {
  if (t < win.show) return null
  if (t < win.hide) return STILL
  const dur = anim === 'none' ? 0 : Math.max(animSec, 1e-3)
  if (t >= win.hide + dur) return null
  return animState(anim, 1 - (t - win.hide) / dur, true)
}

/** Combine two states (alpha and scale multiply, offsets add). */
export function combine(a: AnimState, b: AnimState): AnimState {
  return {
    alpha: a.alpha * b.alpha,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    blur: a.blur + b.blur,
  }
}
