/**
 * Ready-made frame pipeline around any scene renderer, until the render engine applies effects
 * natively:
 *
 *   fx = compositor.evaluate(frameIndex)          // camera, overlays, post, layerTime
 *   scene.renderFrame(fx.layerTime * fps)          // scene into its own canvas
 *   compositor.compose(sceneCanvas, fx, frameIndex) // camera + overlays (2D) → post (WebGL2) → output
 *
 * Costs one extra full-frame blit for the camera. Without WebGL2 the post chain is skipped and the
 * 2D result is copied into the output canvas.
 */

import type { RenderCanvas, Timeline } from '@/shared'
import { cameraMatrix, isIdentityCamera, type Viewport } from './camera'
import { evaluateEffects, prepareEffects, type EffectsConfig, type PreparedEffects } from './evaluate'
import { DEFAULT_OVERLAY_OPTIONS, drawOverlays, type OverlayOptions } from './overlay'
import { PostProcessor } from './post/PostProcessor'
import type { PostQuality } from './post/settings'
import type { EffectFrame } from './types'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface CompositorOptions {
  quality?: PostQuality
  alpha?: boolean
  preserveDrawingBuffer?: boolean
  overlay?: OverlayOptions
  /** false = never use WebGL2 (2D only, no post). */
  post?: boolean
}

export class EffectsCompositor {
  readonly output: RenderCanvas
  private readonly options: CompositorOptions
  private readonly post: PostProcessor | null
  private readonly out2d: Ctx2D | null
  private work: OffscreenCanvas
  private work2d: OffscreenCanvasRenderingContext2D
  private prepared: PreparedEffects | null = null
  private fps = 30
  private vp: Viewport = { width: 1, height: 1, unit: 1 }

  constructor(output: RenderCanvas, options: CompositorOptions = {}) {
    this.output = output
    this.options = options
    let post: PostProcessor | null = null
    if (options.post !== false) {
      try {
        post = new PostProcessor(output, {
          quality: options.quality,
          alpha: options.alpha,
          preserveDrawingBuffer: options.preserveDrawingBuffer,
        })
      } catch {
        post = null
      }
    }
    this.post = post
    this.out2d = post ? null : (output.getContext('2d', { alpha: options.alpha ?? true }) as Ctx2D | null)
    this.work = new OffscreenCanvas(1, 1)
    this.work2d = must2d(this.work)
  }

  get hasPost(): boolean {
    return this.post !== null
  }

  /** (Re)binds timeline and config; call again when either changes. */
  setup(timeline: Timeline, config: EffectsConfig, fps: number): void {
    this.prepared = prepareEffects(timeline, config)
    this.fps = fps
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    this.vp = { width: w, height: h, unit: Math.min(w, h) }
    this.work = new OffscreenCanvas(w, h)
    this.work2d = must2d(this.work)
    if (this.post) this.post.resize(w, h)
    else {
      this.output.width = w
      this.output.height = h
    }
  }

  setQuality(q: PostQuality): void {
    this.post?.setQuality(q)
  }

  evaluate(frameIndex: number): EffectFrame {
    if (!this.prepared) throw new Error('EffectsCompositor.evaluate() before setup()')
    return evaluateEffects(this.prepared, frameIndex / this.fps)
  }

  /** Composes `scene` (a full-frame image of the scene at fx.layerTime) into the output canvas. */
  compose(scene: CanvasImageSource, fx: EffectFrame, frameIndex: number): void {
    if (!this.prepared) throw new Error('EffectsCompositor.compose() before setup()')
    const g = this.work2d
    const { width, height } = this.vp
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, width, height)
    if (!isIdentityCamera(fx.camera)) g.setTransform(...cameraMatrix(fx.camera, this.vp))
    g.drawImage(scene, 0, 0, width, height)
    drawOverlays(g, fx.overlays, this.vp, this.options.overlay ?? DEFAULT_OVERLAY_OPTIONS)

    if (this.post) {
      this.post.render(this.work, this.prepared.config.post, fx.post, frameIndex)
    } else if (this.out2d) {
      this.out2d.clearRect(0, 0, width, height)
      this.out2d.drawImage(this.work, 0, 0)
    }
  }

  readPixels(): Uint8Array | null {
    return this.post?.readPixels() ?? null
  }

  dispose(): void {
    this.post?.dispose()
    this.prepared = null
  }
}

function must2d(c: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const g = c.getContext('2d')
  if (!g) throw new Error('Canvas 2D context is not available')
  return g
}
