/**
 * Small pure helpers: easing curves, seeded noise, color parsing, sorted-array search.
 * Every random value is a function of (seed, salt, index) — never Math.random().
 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export type CurveId = 'linear' | 'ease' | 'sharp' | 'soft' | 'elastic'

/** Easing curve 0..1 → 0..1 (elastic overshoots). `t` is clamped. */
export function ease(curve: CurveId, t: number): number {
  const x = clamp01(t)
  switch (curve) {
    case 'linear':
      return x
    case 'ease':
      return x * x * (3 - 2 * x)
    case 'sharp':
      // Exponential: most of the change happens early.
      return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)
    case 'soft':
      return 1 - (1 - x) * (1 - x) * (1 - x)
    case 'elastic':
      if (x <= 0 || x >= 1) return x
      return Math.pow(2, -9 * x) * Math.sin((x * 9 - 0.75) * ((2 * Math.PI) / 3)) + 1
  }
}

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** 32-bit hash of numbers and strings (FNV-1a over the string form). */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5
  for (const part of parts) {
    const s = typeof part === 'number' ? String(part) : part
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0xff
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Integer → float in [0, 1), a stateless "random" for index `i` under `seed`. */
export function rand(seed: number, i: number): number {
  let t = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b)
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35)
  t ^= t >>> 16
  return (t >>> 0) / 4294967296
}

/** Smooth 1D value noise in -1..1, continuous in `x`. */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const a = rand(seed, i) * 2 - 1
  const b = rand(seed, i + 1) * 2 - 1
  return lerp(a, b, f * f * (3 - 2 * f))
}

// ---------------------------------------------------------------------------
// Sorted arrays
// ---------------------------------------------------------------------------

/** Index of the last element <= x in an ascending array, or -1. */
export function lastIndexAtOrBefore(sorted: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = sorted.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((sorted[mid] ?? Infinity) <= x) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

export type Rgb = [number, number, number]

/** '#rrggbb' → [r, g, b] in 0..1; invalid input → white. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m?.[1]) return [1, 1, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${clamp01(alpha).toFixed(4)})`
}
