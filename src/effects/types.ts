/**
 * Plain data the pure effect logic produces for one frame. The engine adapters in `host.ts` apply
 * it through the render engine's hooks: camera, overlay (2D), post (WebGL2 uniforms), time warp.
 */

import type { AccentEffectId } from '@/shared'

/**
 * Camera around the frame center; offsets in units (fraction of the shorter side).
 * Same shape as `CameraTransform` in the render engine's effects host.
 */
export interface CameraTransform {
  zoom: number
  /** Radians, clockwise. */
  rotation: number
  x: number
  y: number
}

export const IDENTITY_CAMERA: Readonly<CameraTransform> = { zoom: 1, rotation: 0, x: 0, y: 0 }

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
  /** Word the burst belongs to: when it is on screen, the host moves the origin to it. */
  wordId?: string
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

/** Per-frame uniforms of the accent post pass. */
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
}

export const NEUTRAL_POST: Readonly<PostDynamics> = {
  rgbSplit: 0,
  glitch: 0,
  glitchSeed: 0,
  glitchSlices: 8,
  invert: 0,
  hueShift: 0,
  saturation: 0,
}

export function isNeutralPost(p: PostDynamics): boolean {
  return p.rgbSplit === 0 && p.glitch === 0 && p.invert === 0 && p.hueShift === 0 && p.saturation === 0
}

export interface ActiveAccentInfo {
  accentId: string
  effect: AccentEffectId
  /** Envelope value 0..1 times intensity. */
  level: number
}

/** Everything the accents contribute to one frame. */
export interface AccentFrame {
  time: number
  camera: CameraTransform
  /** Bottom to top. */
  overlays: OverlayItem[]
  post: PostDynamics
  /** Seconds the scene lags behind real time (slow-motion); layer time = time - timeLag. */
  timeLag: number
  active: ActiveAccentInfo[]
}
