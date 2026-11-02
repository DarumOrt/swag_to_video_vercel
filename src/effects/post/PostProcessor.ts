/**
 * WebGL2 post chain. Takes the composed frame (any TexImageSource: the scene's 2D canvas,
 * an OffscreenCanvas, an ImageBitmap, a VideoFrame) and draws the processed frame into its own
 * canvas (HTMLCanvasElement or OffscreenCanvas — works in a worker).
 *
 *   source ─► bright pass (downscaled) ─► blur H/V × N ─┐
 *      └──────────────────────────────────────────────► composite ─► canvas
 *
 * Output depends only on (source pixels, settings, dynamics, frameIndex).
 */

import type { RenderCanvas } from '@/shared'
import { hexToRgb } from '../math'
import type { PostDynamics } from '../types'
import { BLUR_FS, BRIGHT_FS, COMPOSITE_FS, FULLSCREEN_VS } from './shaders'
import { QUALITY_PROFILES, type PostQuality, type PostSettings } from './settings'

export interface PostProcessorOptions {
  quality?: PostQuality
  /** Canvas alpha channel, default true (transparent export). */
  alpha?: boolean
  /** Keep the drawing buffer after compositing (needed to read pixels later than the same task). */
  preserveDrawingBuffer?: boolean
}

interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

type Uniforms = Record<string, WebGLUniformLocation | null>

/** True when WebGL2 can be created on an OffscreenCanvas here (main thread or worker). */
export function isPostSupported(): boolean {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false
    return new OffscreenCanvas(1, 1).getContext('webgl2') !== null
  } catch {
    return false
  }
}

export class PostProcessor {
  readonly canvas: RenderCanvas
  private readonly gl: WebGL2RenderingContext
  private quality: PostQuality
  private readonly vao: WebGLVertexArrayObject
  private readonly srcTex: WebGLTexture
  private readonly bright: { prog: WebGLProgram; u: Uniforms }
  private readonly blur: { prog: WebGLProgram; u: Uniforms }
  private readonly composite: { prog: WebGLProgram; u: Uniforms }
  private ping: Target | null = null
  private pong: Target | null = null
  private srcW = 0
  private srcH = 0

  constructor(canvas: RenderCanvas, options: PostProcessorOptions = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: options.alpha ?? true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.canvas = canvas
    this.gl = gl
    this.quality = options.quality ?? 'medium'

    this.vao = must(gl.createVertexArray(), 'vertex array')
    this.srcTex = createTexture(gl)
    this.bright = program(gl, BRIGHT_FS, ['uSrc', 'uSrcTexel', 'uThreshold'])
    this.blur = program(gl, BLUR_FS, ['uSrc', 'uStep'])
    this.composite = program(gl, COMPOSITE_FS, [
      'uSrc', 'uBloom', 'uRes', 'uFrame', 'uBloomIntensity', 'uChroma', 'uRgbSplit', 'uGlitch',
      'uGlitchSeed', 'uGlitchSlices', 'uExposure', 'uContrast', 'uSaturation', 'uTemperature',
      'uTint', 'uLift', 'uHue', 'uShadowTint', 'uHighlightTint', 'uToning', 'uInvert', 'uVignette',
      'uVignetteSoftness', 'uGrain', 'uGrainSize', 'uScanlines', 'uScanDensity', 'uWobble', 'uVhsNoise',
    ])
  }

  setQuality(quality: PostQuality): void {
    if (quality === this.quality) return
    this.quality = quality
    this.freeTargets()
  }

  /** Output size; the source may have a different size (it is scaled). */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    this.freeTargets()
  }

  render(
    source: TexImageSource,
    settings: PostSettings,
    dyn: PostDynamics,
    frameIndex: number,
  ): void {
    const gl = this.gl
    const W = this.canvas.width
    const H = this.canvas.height
    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)

    // Upload the frame.
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    const [sw, sh] = sourceSize(source, W, H)
    this.srcW = sw
    this.srcH = sh

    // Bloom.
    const bloomIntensity = settings.bloom.intensity * Math.max(dyn.bloomBoost, 0)
    const bloomTex = bloomIntensity > 0.001 ? this.renderBloom(settings) : this.srcTex

    // Composite.
    const c = this.composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    gl.useProgram(c.prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.uniform1i(c.u.uSrc ?? null, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bloomTex)
    gl.uniform1i(c.u.uBloom ?? null, 1)
    const f1 = (name: string, v: number) => gl.uniform1f(c.u[name] ?? null, v)
    const col = settings.color
    gl.uniform2f(c.u.uRes ?? null, W, H)
    gl.uniform1ui(c.u.uFrame ?? null, frameIndex >>> 0)
    f1('uBloomIntensity', bloomTex === this.srcTex ? 0 : bloomIntensity)
    f1('uChroma', settings.chroma.amount + dyn.chroma)
    f1('uRgbSplit', dyn.rgbSplit)
    f1('uGlitch', dyn.glitch)
    gl.uniform1ui(c.u.uGlitchSeed ?? null, dyn.glitchSeed >>> 0)
    f1('uGlitchSlices', Math.max(1, dyn.glitchSlices))
    f1('uExposure', col.exposure + dyn.exposure)
    f1('uContrast', col.contrast)
    f1('uSaturation', Math.max(0, col.saturation + dyn.saturation))
    f1('uTemperature', col.temperature)
    f1('uTint', col.tint)
    f1('uLift', col.lift)
    f1('uHue', dyn.hueShift)
    gl.uniform3fv(c.u.uShadowTint ?? null, hexToRgb(col.shadowTint))
    gl.uniform3fv(c.u.uHighlightTint ?? null, hexToRgb(col.highlightTint))
    f1('uToning', col.toning)
    f1('uInvert', dyn.invert)
    f1('uVignette', settings.vignette.amount)
    f1('uVignetteSoftness', settings.vignette.softness)
    f1('uGrain', settings.grain.amount)
    f1('uGrainSize', Math.max(settings.grain.size, 0.5))
    f1('uScanlines', settings.vhs.scanlines)
    f1('uScanDensity', Math.max(settings.vhs.density, 0.05))
    f1('uWobble', settings.vhs.wobble)
    f1('uVhsNoise', settings.vhs.noise)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** RGBA pixels of the last frame, rows bottom-up (for hashing / tests). */
  readPixels(): Uint8Array {
    const gl = this.gl
    const out = new Uint8Array(this.canvas.width * this.canvas.height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out)
    return out
  }

  dispose(): void {
    const gl = this.gl
    this.freeTargets()
    gl.deleteTexture(this.srcTex)
    gl.deleteVertexArray(this.vao)
    for (const p of [this.bright, this.blur, this.composite]) gl.deleteProgram(p.prog)
  }

  private renderBloom(settings: PostSettings): WebGLTexture {
    const gl = this.gl
    const profile = QUALITY_PROFILES[this.quality]
    const [a, b] = this.targets(profile.bloomScale)

    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo)
    gl.viewport(0, 0, a.w, a.h)
    gl.useProgram(this.bright.prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.uniform1i(this.bright.u.uSrc ?? null, 0)
    gl.uniform2f(this.bright.u.uSrcTexel ?? null, 1 / this.srcW, 1 / this.srcH)
    gl.uniform1f(this.bright.u.uThreshold ?? null, settings.bloom.threshold)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Steps are fractions of the frame height, so the glow size does not depend on resolution or
    // quality (quality only changes how finely it is sampled). They grow per iteration.
    gl.useProgram(this.blur.prog)
    gl.uniform1i(this.blur.u.uSrc ?? null, 0)
    const radius = (0.25 + 1.5 * settings.bloom.radius) * (4 / profile.bloomIterations)
    const aspect = a.h / a.w
    for (let i = 0; i < profile.bloomIterations; i++) {
      const step = 0.0016 * radius * (1 + i)
      this.blurPass(a, b, step * aspect, 0)
      this.blurPass(b, a, 0, step)
    }
    return a.tex
  }

  private blurPass(from: Target, to: Target, sx: number, sy: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo)
    gl.viewport(0, 0, to.w, to.h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, from.tex)
    gl.uniform2f(this.blur.u.uStep ?? null, sx, sy)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private targets(scale: number): [Target, Target] {
    const w = Math.max(1, Math.round(this.canvas.width * scale))
    const h = Math.max(1, Math.round(this.canvas.height * scale))
    if (!this.ping || !this.pong || this.ping.w !== w || this.ping.h !== h) {
      this.freeTargets()
      this.ping = createTarget(this.gl, w, h)
      this.pong = createTarget(this.gl, w, h)
    }
    return [this.ping, this.pong]
  }

  private freeTargets(): void {
    for (const t of [this.ping, this.pong]) {
      if (!t) continue
      this.gl.deleteFramebuffer(t.fbo)
      this.gl.deleteTexture(t.tex)
    }
    this.ping = null
    this.pong = null
  }
}

function sourceSize(s: TexImageSource, fallbackW: number, fallbackH: number): [number, number] {
  if (typeof VideoFrame !== 'undefined' && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight]
  const any = s as { width?: number; height?: number }
  return [any.width || fallbackW, any.height || fallbackH]
}

function must<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`WebGL2: could not create ${what}`)
  return v
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = must(gl.createTexture(), 'texture')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

function createTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = createTexture(gl)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  const fbo = must(gl.createFramebuffer(), 'framebuffer')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fbo, w, h }
}

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const sh = must(gl.createShader(type), 'shader')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`Shader compile error: ${log}`)
  }
  return sh
}

function program(gl: WebGL2RenderingContext, fs: string, names: string[]): { prog: WebGLProgram; u: Uniforms } {
  const prog = must(gl.createProgram(), 'program')
  const v = compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VS)
  const f = compile(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(prog, v)
  gl.attachShader(prog, f)
  gl.linkProgram(prog)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`)
  }
  const u: Uniforms = {}
  for (const n of names) u[n] = gl.getUniformLocation(prog, n)
  return { prog, u }
}
