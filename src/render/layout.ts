/**
 * Resolution-independent layout. Scenes describe positions as fractions of the frame (or of the
 * social-media safe area) and sizes in "units" (fraction of the shorter frame side), so the same
 * scene works for 9:16, 16:9, 1:1 and any custom size.
 */

export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

/** Rect in fractions 0..1 of the chosen space. */
export interface RectSpec {
  x: number
  y: number
  w: number
  h: number
  /**
   * - 'safe' (default) — the safe area as is (in portrait it is asymmetric: the action column on
   *   the right is wider than the left margin, so its center is left of the frame center);
   * - 'center' — the safe area made symmetric around the vertical center line (left and right
   *   insets = the larger of the two): use for anything meant to be centered;
   * - 'bleed' — full frame width × safe-area height: edge-to-edge visualizers;
   * - 'frame' — the whole frame.
   */
  space?: RectSpace
}

export type RectSpace = 'safe' | 'center' | 'bleed' | 'frame'

export type SafeAreaMode = 'social' | 'none'

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface Layout {
  width: number
  height: number
  /** Shorter side in pixels — base for sizes (font size 0.1 = 10% of the shorter side). */
  unit: number
  frame: PixelRect
  safe: PixelRect
  /** Safe area, horizontally symmetric around the frame center. */
  center: PixelRect
  /** Full width, safe-area height. */
  bleed: PixelRect
}

/**
 * Safe-area insets as fractions of the frame.
 * Portrait (TikTok / Reels / Shorts): caption and buttons at the bottom, action column on the right.
 */
export function safeAreaInsets(width: number, height: number, mode: SafeAreaMode): Insets {
  if (mode === 'none') return { top: 0, right: 0, bottom: 0, left: 0 }
  const portrait = height / width > 1.3
  if (portrait) return { top: 0.1, right: 0.12, bottom: 0.2, left: 0.05 }
  return { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 }
}

export function computeLayout(width: number, height: number, mode: SafeAreaMode): Layout {
  const i = safeAreaInsets(width, height, mode)
  const side = Math.max(i.left, i.right)
  const y = i.top * height
  const h = (1 - i.top - i.bottom) * height
  return {
    width,
    height,
    unit: Math.min(width, height),
    frame: { x: 0, y: 0, w: width, h: height },
    safe: {
      x: i.left * width,
      y,
      w: (1 - i.left - i.right) * width,
      h,
    },
    center: { x: side * width, y, w: (1 - 2 * side) * width, h },
    bleed: { x: 0, y, w: width, h },
  }
}

export function resolveRect(spec: RectSpec, layout: Layout): PixelRect {
  const base = layout[spec.space ?? 'safe']
  return {
    x: base.x + spec.x * base.w,
    y: base.y + spec.y * base.h,
    w: spec.w * base.w,
    h: spec.h * base.h,
  }
}
