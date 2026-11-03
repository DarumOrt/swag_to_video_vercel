/**
 * Extension points for effects (implemented by the effects session in `src/effects/`).
 *
 * An effect is listed in `scene.effects` and created by `createEffect` exported from `@/effects`.
 * It may implement any of the hooks below; the engine calls them every frame, in scene order:
 *
 *   time   = effects.remapTime(time)            slow-motion and other time warps
 *   camera = effects.camera(frame, camera)      composed; applied to layers with `camera !== false`
 *   layers (2D, under the camera)
 *   effects.overlay(g, frame)                   2D, screen space, above all layers
 *   effects.post (WebGL2 passes)                over the finished 2D frame, chained
 *
 * Determinism: hooks are pure functions of the FrameContext (frame index, time, timeline, seed).
 * No state carried between frames, no Math.random() — use `frame.rng(salt)`.
 * Import only *types* from `@/render`; runtime helpers come through FrameContext / PostKit.
 */

import type { Ctx2D, FrameContext } from './types'

/** Effect entry in a scene. `params` are effect-specific and described by the effects module. */
export interface EffectSpec {
  /** Unique within the scene; also salts the effect's random seed. */
  id: string
  type: string
  /** Default true. */
  enabled?: boolean
  params?: Record<string, number | string | boolean>
}

/**
 * Camera applied to layers, about the frame center:
 * translate(x·unit, y·unit) · rotate(rotation) · scale(zoom). Identity = { zoom 1, rotation 0, x 0, y 0 }.
 * `unit` is the shorter frame side, so offsets look the same in any format.
 */
export interface CameraTransform {
  zoom: number
  /** Radians, clockwise. */
  rotation: number
  /** Offset in units (fraction of the shorter frame side). */
  x: number
  y: number
  /**
   * 3D lean about the horizontal axis / swing about the vertical axis, radians (optional; missing = 0).
   * With a 3D scene (`director.camera3d`) the engine renders them as true perspective (WebGL pass over
   * the frame); otherwise they are approximated in 2D by squashing the layers (scale by cos).
   */
  tiltX?: number
  tiltY?: number
}

export const IDENTITY_CAMERA: Readonly<CameraTransform> = { zoom: 1, rotation: 0, x: 0, y: 0 }

/** Inputs of a time warp. Feature sampling and lyrics then use the returned time. */
export interface TimeWarpInfo {
  frameIndex: number
  fps: number
  /** Time before any warp, frameIndex / fps. */
  baseTime: number
  timeline: FrameContext['timeline']
}

export interface Effect {
  readonly id: string
  /** Warp the frame time (e.g. slow motion around a word). Receives the output of the previous warp. */
  remapTime?(time: number, info: TimeWarpInfo): number
  /**
   * Contribute to the camera: mutate `camera` in place, composing with what earlier effects set
   * (multiply zoom, add rotation and offsets).
   */
  camera?(frame: FrameContext, camera: CameraTransform): void
  /** Draw above all layers, in screen space (no camera; `frame.camera` is there if needed). */
  overlay?(g: Ctx2D, frame: FrameContext): void
  /** WebGL2 pass over the finished frame. */
  post?: PostPass
  dispose?(): void
}

/** Exported by `@/effects` as `createEffect`. Returns null for unknown types (the engine skips them). */
export type EffectFactory = (spec: EffectSpec, env: { seed: number }) => Effect | null

// ---------------------------------------------------------------------------
// WebGL2 post-processing
// ---------------------------------------------------------------------------

/** A texture you can render into. `framebuffer: null` is the visible canvas. */
export interface RenderTarget {
  framebuffer: WebGLFramebuffer | null
  texture: WebGLTexture | null
  width: number
  height: number
}

export interface ShaderProgram {
  program: WebGLProgram
  use(): void
  /** Cached uniform location (null if the uniform is unused / optimized out). */
  uniform(name: string): WebGLUniformLocation | null
}

/**
 * Helpers for passes. Fragment shaders get `in vec2 vUv;` (0..1, origin bottom-left) from the shared
 * fullscreen vertex shader and must declare `out vec4 outColor;`. Colors are premultiplied alpha.
 */
export interface PostKit {
  gl: WebGL2RenderingContext
  /** Compile a fragment shader (full `#version 300 es` source) with the fullscreen vertex shader. */
  program(fragmentSource: string): ShaderProgram
  /** Offscreen RGBA8 target at `scale` × frame size; resized by the engine with the frame. */
  target(scale?: number): RenderTarget
  /** Bind a target as the draw framebuffer and set the viewport to it. */
  bind(target: RenderTarget): void
  /** Bind `texture` to texture unit `unit` (linear filtering, clamp to edge). */
  texture(unit: number, texture: WebGLTexture | null): void
  /** Draw the fullscreen triangle with the current program. */
  draw(): void
  /** Copy `input` into the bound target unchanged. */
  copy(input: WebGLTexture): void
}

export interface PostIO {
  /** Result of the previous pass (or the 2D frame for the first active pass). */
  input: WebGLTexture
  /** The 2D frame before any pass. */
  source: WebGLTexture
  /** Where this pass must write its result (bind it with kit.bind before the final draw). */
  output: RenderTarget
  width: number
  height: number
}

export interface PostPass {
  /** Compile shaders, create targets. Called once per renderer init. */
  init(kit: PostKit): void
  /** false = skip this frame (cheaper: when no pass is active the GL stage is skipped entirely). */
  active?(frame: FrameContext): boolean
  render(kit: PostKit, io: PostIO, frame: FrameContext): void
  dispose?(gl: WebGL2RenderingContext): void
}

/** Apply a camera transform to a 2D context, about the frame center. */
export function applyCamera(
  g: Ctx2D,
  camera: Readonly<CameraTransform>,
  width: number,
  height: number,
  unit: number,
): void {
  const [sx, sy] = cameraScale(camera)
  if (sx === 1 && sy === 1 && camera.rotation === 0 && camera.x === 0 && camera.y === 0) return
  g.translate(width / 2 + camera.x * unit, height / 2 + camera.y * unit)
  if (camera.rotation !== 0) g.rotate(camera.rotation)
  if (sx !== 1 || sy !== 1) g.scale(sx, sy)
  g.translate(-width / 2, -height / 2)
}

/** Horizontal and vertical scale of a camera: zoom, squashed by tilt (2D stand-in for perspective). */
export function cameraScale(camera: Readonly<CameraTransform>): [number, number] {
  return [camera.zoom * Math.cos(camera.tiltY ?? 0), camera.zoom * Math.cos(camera.tiltX ?? 0)]
}
