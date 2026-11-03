/**
 * The render engine: draws frame N of a scene into a canvas (HTMLCanvasElement or OffscreenCanvas).
 * Canvas 2D compositing; each layer draws inside save()/restore() with its opacity and blend mode.
 * Effects (effectsHost.ts) warp time, move the camera, draw overlays and run WebGL2 post passes.
 */

import * as effectsModule from '@/effects'
import type { FrameRate, FrameRenderer, RenderCanvas, RendererInit, Timeline } from '@/shared'
import { Director, layerGroup, neutralShot, type LayerGroup, type ShotState } from './director'
import {
  applyCamera,
  IDENTITY_CAMERA,
  type CameraTransform,
  type Effect,
  type EffectFactory,
  type EffectSpec,
  type PostPass,
} from './effectsHost'
import { embeddedFamiliesIn, loadEmbeddedFonts } from './fonts'
import { computeLayout, resolveRect, type Layout } from './layout'
import { cameraAtDepth, layerMotionAt, type LayerMotion } from './motion'
import { createPerspectivePass, hasTilt } from './perspective'
import { PostChain } from './post'
import { createRng, hash32 } from './random'
import { createLayer } from './registry'
import { beatAt, sectionAt } from './rhythm'
import { featurePosition, frameTime, sampleSeries, sampleSpectrum } from './sampling'
import { normalizeScene, type Scene } from './scene'
import type { Ctx2D, FrameContext, Layer } from './types'
import { emptyFrameWords, WordCollector, type FrameWords } from './words'

interface LayerEntry {
  id: string
  layer: Layer
  opacity: number
  blend: GlobalCompositeOperation
  camera: boolean
  motion: LayerMotion | null
  group: LayerGroup
  seed: number
}

interface EffectEntry {
  effect: Effect
  seed: number
}

export interface SceneRendererOptions {
  /**
   * Keep the canvas on the CPU rasterizer. Use when pixels are read back with getImageData
   * (pixel tests, hashing). Chrome moves a GPU canvas to the CPU after the first readback, and the
   * two rasterizers anti-alias slightly differently, so mixing them breaks pixel equality.
   */
  willReadFrequently?: boolean
  /**
   * Canvas alpha channel. Default true (transparent export needs it). An opaque canvas is cheaper
   * to turn into a VideoFrame for H.264, which has no alpha anyway.
   */
  alpha?: boolean
  /** Effect factory override (tests). Default: `createEffect` from `@/effects`. */
  createEffect?: EffectFactory
  /** Font families an effect draws with (tests). Default: `effectFontFamilies` from `@/effects`. */
  effectFontFamilies?: EffectFontFamilies
}

type EffectFontFamilies = (spec: EffectSpec) => string[]

/** `createEffect` from `@/effects` once the effects module exports it; until then no effects. */
function defaultEffectFactory(): EffectFactory {
  const fn = (effectsModule as { createEffect?: EffectFactory }).createEffect
  return typeof fn === 'function' ? fn : () => null
}

function defaultEffectFonts(): EffectFontFamilies {
  const fn = (effectsModule as { effectFontFamilies?: EffectFontFamilies }).effectFontFamilies
  return typeof fn === 'function' ? fn : () => []
}

export class SceneRenderer implements FrameRenderer {
  private readonly options: SceneRendererOptions
  private canvas: RenderCanvas | null = null
  private g: Ctx2D | null = null
  private fps: FrameRate = 30
  private timeline: Timeline | null = null
  private scene: Scene | null = null
  private layout: Layout | null = null
  private layers: LayerEntry[] = []
  private effects: EffectEntry[] = []
  private post: PostChain | null = null
  private director: Director | null = null
  /** The post chain renders tilt as true perspective (else layers get a 2D squash). */
  private perspective = false

  constructor(options: SceneRendererOptions = {}) {
    this.options = options
  }

  async init(options: RendererInit): Promise<void> {
    this.dispose()
    const g = options.canvas.getContext('2d', {
      alpha: this.options.alpha ?? true,
      willReadFrequently: this.options.willReadFrequently ?? false,
    }) as Ctx2D | null
    if (!g) throw new Error('Canvas 2D context is not available')
    this.canvas = options.canvas
    this.g = g
    this.fps = options.fps
    this.timeline = options.timeline
    const scene = normalizeScene(options.scene)
    // Fonts first: a frame drawn before they load would silently use a system font.
    const effectFonts = this.options.effectFontFamilies ?? defaultEffectFonts()
    await loadEmbeddedFonts(embeddedFamiliesIn(sceneFontFamilies(scene, effectFonts)))
    this.scene = scene
    this.layers = scene.layers
      .filter((spec) => spec.enabled !== false)
      .map((spec) => ({
        id: spec.id,
        layer: createLayer(spec),
        opacity: spec.opacity ?? 1,
        blend: spec.blend ?? 'source-over',
        camera: spec.camera ?? spec.type !== 'background',
        motion: spec.motion ?? null,
        group: layerGroup(spec.type),
        seed: hash32(scene.seed, spec.id),
      }))

    const factory = this.options.createEffect ?? defaultEffectFactory()
    this.effects = scene.effects
      .filter((spec) => spec.enabled !== false)
      .flatMap((spec) => {
        const seed = hash32(scene.seed, 'fx', spec.id)
        const effect = factory(spec, { seed })
        return effect ? [{ effect, seed }] : []
      })
    // Section transitions belong to the effects when the scene has them; the director then only
    // changes shots.
    const externalTransitions =
      this.effects.length > 0 &&
      scene.effects.some((e) => e.enabled !== false && e.type === 'section-transitions')
    this.director = scene.director
      ? new Director(scene.director, scene.seed, options.timeline, {
          transitions: !externalTransitions,
        })
      : null
    const passes = this.effects.flatMap((e) => (e.effect.post ? [e.effect.post] : []))
    const make = (list: PostPass[]) =>
      new PostChain(
        list,
        Math.round(options.width),
        Math.round(options.height),
        this.options.willReadFrequently ?? false,
      )
    if (scene.director?.camera3d && typeof OffscreenCanvas !== 'undefined') {
      // 3D camera: perspective first, then the effects' passes. Without WebGL2 tilt stays 2D.
      try {
        this.post = make([createPerspectivePass(), ...passes])
        this.perspective = true
      } catch {
        this.post = null
      }
    }
    if (!this.post && passes.length > 0) this.post = make(passes)
    this.resize(options.width, options.height)
    if (this.post) this.post.warmUp(g)
    // Warm-up frame. Chrome takes a different path the first time a source (offscreen image,
    // pattern, GL canvas) is composited, rounding a few levels differently; drawing one throwaway
    // frame here keeps frame N identical whatever was rendered before it. Also lays out text.
    this.renderFrame(0)
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  resize(width: number, height: number): void {
    if (!this.canvas || !this.scene) throw new Error('SceneRenderer.resize() before init()')
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    this.layout = computeLayout(w, h, this.scene.safeArea)
    this.post?.resize(w, h)
  }

  renderFrame(frameIndex: number): void {
    const { g, timeline, layout } = this
    if (!g || !timeline || !layout) throw new Error('SceneRenderer.renderFrame() before init()')

    // 1. Time warps.
    const baseTime = frameTime(frameIndex, this.fps)
    let time = baseTime
    for (const { effect } of this.effects) {
      if (effect.remapTime) {
        time = effect.remapTime(time, { frameIndex, fps: this.fps, baseTime, timeline })
      }
    }

    // 2. Camera: the director's shot camera, then the effects compose on top.
    const camera: CameraTransform = { ...IDENTITY_CAMERA }
    const words = new WordCollector(layout.width, layout.height, layout.unit)
    const director = this.director
    const base = createFrameContext(timeline, layout, frameIndex, this.fps, {
      time: time === baseTime ? undefined : time,
      camera,
      words: words.view(),
      shot: director?.shotAt(time),
    })
    director?.camera(time, base.beat, camera)
    for (const { effect, seed } of this.effects) effect.camera?.({ ...base, seed }, camera)
    // Tilt rendered by the perspective pass: layers get the flat camera.
    const layerCamera: CameraTransform =
      this.perspective && hasTilt(camera) ? { ...camera, tiltX: 0, tiltY: 0 } : camera
    const intensity = base.shot.intensity

    // 3. Layers.
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, layout.width, layout.height)
    for (const entry of this.layers) {
      if (entry.opacity <= 0) continue
      let alpha = entry.opacity
      if (director) alpha *= director.layerAlpha(time, entry.id, entry.group)
      if (alpha <= 0) continue
      let cam: CameraTransform | null = entry.camera ? layerCamera : null
      if (entry.motion) {
        const m = entry.motion
        const state = layerMotionAt(m, timeline, time, base.beat)
        alpha = Math.min(alpha * state.alpha, 1)
        if (alpha <= 0) continue
        if (cam && m.depth !== undefined) cam = cameraAtDepth(cam, m.depth)
        // Beat kicks follow the shot intensity (quiet intro: softer, drop: harder).
        const scale = 1 + (state.scale - 1) * intensity
        if (scale !== 1) {
          cam = scaleCamera(cam ?? IDENTITY_CAMERA, scale, m.origin ?? [0.5, 0.5], layout)
        }
      }
      g.save()
      g.globalAlpha = alpha
      g.globalCompositeOperation = entry.blend
      if (cam) applyCamera(g, cam, layout.width, layout.height, layout.unit)
      const scoped = words.scope(entry.id, cam)
      entry.layer.draw(g, { ...base, seed: entry.seed, words: scoped })
      g.restore()
    }

    // 4. Transitions between sections, effect overlays, then 5. post passes over the frame.
    if (director) {
      g.save()
      director.overlay(g, time, layout.width, layout.height)
      g.restore()
    }
    for (const { effect, seed } of this.effects) {
      if (!effect.overlay) continue
      g.save()
      effect.overlay(g, { ...base, seed })
      g.restore()
    }
    this.post?.apply(g, base)
  }

  dispose(): void {
    for (const entry of this.layers) entry.layer.dispose?.()
    for (const entry of this.effects) entry.effect.dispose?.()
    this.post?.dispose()
    this.post = null
    this.director = null
    this.perspective = false
    this.layers = []
    this.effects = []
    this.canvas = null
    this.g = null
    this.timeline = null
    this.scene = null
    this.layout = null
  }
}

/**
 * Camera followed by a scale `s` around `origin` (frame fractions), as one camera transform, so
 * word boxes (words.scope) see exactly what is drawn.
 */
function scaleCamera(
  c: Readonly<CameraTransform>,
  s: number,
  origin: [number, number],
  layout: Layout,
): CameraTransform {
  const cx = layout.width / 2
  const cy = layout.height / 2
  const ox = origin[0] * layout.width
  const oy = origin[1] * layout.height
  return {
    ...c,
    zoom: c.zoom * s,
    rotation: c.rotation,
    x: ((ox - cx) * (1 - s)) / layout.unit + s * c.x,
    y: ((oy - cy) * (1 - s)) / layout.unit + s * c.y,
  }
}

/** Font families of the scene's layers and effects (e.g. the accents' full-screen word). */
export function sceneFontFamilies(scene: Scene, effectFonts: EffectFontFamilies): string[] {
  const layers = scene.layers.flatMap((l) => ('fontFamily' in l ? [l.fontFamily] : []))
  return [...layers, ...scene.effects.flatMap((e) => effectFonts(e))]
}

/** Per-frame context: the only inputs layers and effects may use. */
export function createFrameContext(
  timeline: Timeline,
  layout: Layout,
  frameIndex: number,
  fps: number,
  extra: {
    time?: number
    camera?: Readonly<CameraTransform>
    words?: FrameWords
    shot?: ShotState
  } = {},
): FrameContext {
  const features = timeline.audio.features
  const baseTime = frameTime(frameIndex, fps)
  const time = extra.time ?? baseTime
  // Without a warp, the exact integer path (frameIndex * rate / fps) keeps grid alignment.
  const pos =
    extra.time === undefined
      ? featurePosition(features, frameIndex, fps)
      : Math.min(Math.max(time * features.rate, 0), Math.max(features.frameCount - 1, 0))
  return {
    frameIndex,
    fps,
    time,
    baseTime,
    featurePos: pos,
    timeline,
    layout,
    seed: 0,
    camera: extra.camera ?? IDENTITY_CAMERA,
    beat: beatAt(timeline, time),
    section: sectionAt(timeline, time),
    shot: extra.shot ?? neutralShot(timeline, time),
    sample: (series) => sampleSeries(series, pos),
    band: (band) => sampleSeries(features.bands[band], pos),
    spectrumAt: (p, out) => sampleSpectrum(features, p, out),
    rect: (spec) => resolveRect(spec, layout),
    words: extra.words ?? emptyFrameWords(),
    rng(salt = 0) {
      return createRng(hash32(this.seed, frameIndex, salt))
    },
  }
}
