/**
 * Layer contract of the render engine. Visualizers implement `Layer`, effects implement `Effect`
 * (effectsHost.ts); both import these types with `import type` only — runtime helpers reach them
 * through `FrameContext`.
 */

import type { AudioSection, Timeline } from '@/shared'
import type { CameraTransform } from './effectsHost'
import type { Layout, PixelRect, RectSpec } from './layout'
import type { BeatInfo } from './rhythm'
import type { FrameWords } from './words'

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Fields shared by every layer spec in a scene. */
export interface LayerSpecBase {
  /** Unique within the scene; also salts the layer's random seed. */
  id: string
  type: string
  /** Default true. */
  enabled?: boolean
  /** Follow the effects camera (zoom, shake...). Default true; backgrounds default to false. */
  camera?: boolean
  /** 0..1, default 1. */
  opacity?: number
  /** Canvas composite operation, default 'source-over'. */
  blend?: GlobalCompositeOperation
}

/** Which audio band drives a reaction, and how strongly. */
export interface BandReaction {
  band: 'low' | 'mid' | 'high'
  /** 0 = no reaction. Meaning is layer-specific (scale, brightness...). */
  amount: number
}

/** Everything a layer may depend on when drawing a frame. Nothing else is allowed. */
export interface FrameContext {
  frameIndex: number
  fps: number
  /** Frame time in seconds after time warps (slow motion); equals `baseTime` without them. */
  time: number
  /** frameIndex / fps, seconds, before any time warp. */
  baseTime: number
  /** Fractional position on the feature grid (see `featurePosition`). */
  featurePos: number
  timeline: Timeline
  layout: Layout
  /** Scene seed mixed with the layer (or effect) id. */
  seed: number
  /** Camera for this frame, after all effects contributed. Layers get it already applied. */
  camera: Readonly<CameraTransform>
  /** Beat at `time` (index, phase, strength...). */
  beat: BeatInfo
  /** Energy section at `time`, null when the analysis has none. */
  section: AudioSection | null
  /** Seeded RNG for this frame: same (seed, frame, salt) → same sequence. */
  rng(salt?: string | number): () => number
  /** Feature series value at the current frame (linear interpolation). */
  sample(series: ArrayLike<number>): number
  /** Band energy 0..1 at the current frame. */
  band(band: BandReaction['band']): number
  /** Spectrum row at a feature-grid position, written into `out` (length = spectrum.binCount). */
  spectrumAt(pos: number, out: Float32Array): void
  rect(spec: RectSpec): PixelRect
  /**
   * Lyric words drawn in this frame, in screen pixels (words.ts). Text layers `place()` the words
   * they draw; effects read them in `overlay` / `post` to aim at a word.
   */
  words: FrameWords
}

export interface Layer {
  readonly id: string
  /** Draw the frame. The engine wraps this in save()/restore() and sets opacity and blend. */
  draw(g: Ctx2D, frame: FrameContext): void
  dispose?(): void
}
