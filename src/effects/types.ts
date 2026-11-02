/**
 * What the effects module produces for one frame. `evaluateEffects` returns plain data; the render
 * engine applies it in three places:
 *
 *   camera   — transform around the scene layers (zoom, offset, rotation),
 *   layerTime — time the scene layers are drawn at (slow-motion remaps it),
 *   overlays — drawn on top of the layers in screen space (`drawOverlays`),
 *   post     — per-frame uniforms of the WebGL2 post chain (`PostProcessor.render`).
 */

import type { AccentEffectId } from '@/shared'

/** Camera around the frame center. Offsets are fractions of `layout.unit` (the shorter side). */
export interface CameraTransform {
  /** 1 = no zoom. */
  zoom: number
  x: number
  y: number
  /** Radians, clockwise. */
  rotation: number
}

export const IDENTITY_CAMERA: Readonly<CameraTransform> = { zoom: 1, x: 0, y: 0, rotation: 0 }

export interface FlashOverlay {
  kind: 'flash'
  color: string
  alpha: number
  blend: 'normal' | 'screen' | 'add'
}

/** Particles around an origin. Positions and sizes are in units (`layout.unit`), y points down. */
export interface ParticleOverlay {
  kind: 'particles'
  shape: 'dot' | 'spark' | 'square'
  /** Origin in frame fractions (0..1 of width / height). */
  originX: number
  originY: number
  /** Packed [x, y, size, alpha, heading, colorMix] per particle, `count` used. */
  data: Float32Array
  count: number
  color: string
  color2: string
  glow: boolean
}

export const PARTICLE_STRIDE = 6

export interface WordOverlay {
  kind: 'word'
  text: string
  color: string
  /** Fraction of the frame width the word should fill. */
  fill: number
  /** Scale on top of the fitted size. */
  scale: number
  alpha: number
  /** Dark veil behind the word, 0..1. */
  dim: number
  outline: boolean
  /** Vertical offset in frame heights. */
  offsetY: number
}

export type OverlayItem = FlashOverlay | ParticleOverlay | WordOverlay

/** Per-frame inputs of the post chain on top of the preset's static settings. */
export interface PostDynamics {
  /** Horizontal RGB split, fraction of the frame width. */
  rgbSplit: number
  /** Slice displacement strength 0..1 (glitch). */
  glitch: number
  /** Changes when the glitch pattern should jump. */
  glitchSeed: number
  glitchSlices: number
  /** 0..1 mix with the inverted image. */
  invert: number
  /** Hue rotation, radians. */
  hueShift: number
  /** Added saturation, -1..1. */
  saturation: number
  /** Multiplier on bloom intensity, 1 = preset value. */
  bloomBoost: number
  /** Added chromatic aberration, fraction of the frame width. */
  chroma: number
  /** Exposure added in stops. */
  exposure: number
}

export const NEUTRAL_POST: Readonly<PostDynamics> = {
  rgbSplit: 0,
  glitch: 0,
  glitchSeed: 0,
  glitchSlices: 8,
  invert: 0,
  hueShift: 0,
  saturation: 0,
  bloomBoost: 1,
  chroma: 0,
  exposure: 0,
}

export interface ActiveAccentInfo {
  accentId: string
  effect: AccentEffectId
  /** Envelope value 0..1 times intensity. */
  level: number
}

export interface EffectFrame {
  time: number
  /** Time the scene layers should be drawn at (equals `time` unless slow-motion is active). */
  layerTime: number
  camera: CameraTransform
  /** Bottom to top. */
  overlays: OverlayItem[]
  post: PostDynamics
  /** Beat pulse 0..1 (for layers that want to react). */
  beat: number
  /** 0..1 inside a `drop` section. */
  drop: number
  active: ActiveAccentInfo[]
}
