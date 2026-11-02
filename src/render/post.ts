/**
 * WebGL2 post-processing chain over the finished 2D frame.
 *
 * The 2D frame (the output canvas itself) is uploaded as a texture, the active passes run with
 * ping-pong targets, the last one renders into the GL canvas, and the result is drawn back onto the
 * output canvas. The output canvas always keeps its 2D context, so callers (preview, VideoFrame in
 * export) see no difference. Works with OffscreenCanvas in workers.
 */

import type { PostKit, PostPass, RenderTarget, ShaderProgram } from './effectsHost'
import type { Ctx2D, FrameContext } from './types'

const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  // Fullscreen triangle from gl_VertexID, no buffers.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const COPY = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
out vec4 outColor;
void main() { outColor = texture(uInput, vUv); }`

interface ManagedTarget extends RenderTarget {
  scale: number
}

export class PostChain {
  private readonly canvas: OffscreenCanvas
  private readonly gl: WebGL2RenderingContext
  private readonly kit: PostKit
  private readonly vao: WebGLVertexArrayObject
  private readonly sourceTex: WebGLTexture
  private readonly pingPong: [ManagedTarget, ManagedTarget]
  private readonly managed: ManagedTarget[] = []
  private readonly programs: WebGLProgram[] = []
  private readonly copy: ShaderProgram
  private width: number
  private height: number

  private readonly passes: PostPass[]

  /**
   * Output canvas is CPU-backed (`willReadFrequently`, pixel tests): bring the result back with
   * readPixels + putImageData. drawImage of a GL canvas would temporarily switch the output to the
   * GPU rasterizer, so the next frame would rasterize differently from the same frame later.
   */
  private readonly cpuOutput: boolean
  private readback: Uint8Array = new Uint8Array(0)

  constructor(passes: PostPass[], width: number, height: number, cpuOutput = false) {
    this.passes = passes
    this.cpuOutput = cpuOutput
    this.width = width
    this.height = height
    this.canvas = new OffscreenCanvas(width, height)
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL2 is not available for post-processing')
    this.gl = gl
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('WebGL2: createVertexArray failed')
    this.vao = vao
    this.sourceTex = this.createTexture()
    this.kit = this.createKit()
    this.copy = this.kit.program(COPY)
    this.pingPong = [this.managedTarget(1), this.managedTarget(1)]
    for (const pass of passes) pass.init(this.kit)
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
    for (const t of this.managed) this.allocate(t)
  }

  /**
   * Run the full upload → draw → draw-back path once. The very first GL → 2D transfer in Chrome
   * rounds slightly differently (±1–4 levels) from later ones; warming up at init keeps frame N
   * identical no matter which frames were rendered before it.
   */
  warmUp(output: Ctx2D): void {
    const gl = this.gl
    this.upload(output)
    this.kit.bind({ framebuffer: null, texture: null, width: this.width, height: this.height })
    this.kit.copy(this.sourceTex)
    this.drawBack(output)
    gl.flush()
  }

  /** Run active passes over `output`'s current content and draw the result back. Returns false if none ran. */
  apply(output: Ctx2D, frame: FrameContext): boolean {
    const active = this.passes.filter((p) => p.active?.(frame) ?? true)
    if (active.length === 0) return false
    const { width, height } = this

    this.upload(output)

    const screen: RenderTarget = { framebuffer: null, texture: null, width, height }
    let input = this.sourceTex
    active.forEach((pass, i) => {
      const last = i === active.length - 1
      const out: RenderTarget = last ? screen : this.pingPong[i % 2 === 0 ? 0 : 1]
      this.kit.bind(out)
      pass.render(this.kit, { input, source: this.sourceTex, output: out, width, height }, frame)
      if (!last && out.texture) input = out.texture
    })

    this.drawBack(output)
    return true
  }

  private upload(output: Ctx2D): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, output.canvas)
    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)
  }

  private drawBack(output: Ctx2D): void {
    if (this.cpuOutput) {
      this.drawBackCpu(output)
      return
    }
    output.save()
    output.setTransform(1, 0, 0, 1, 0, 0)
    output.globalAlpha = 1
    output.globalCompositeOperation = 'copy'
    output.drawImage(this.canvas, 0, 0)
    output.restore()
  }

  private drawBackCpu(output: Ctx2D): void {
    const gl = this.gl
    const { width: w, height: h } = this
    if (this.readback.length !== w * h * 4) this.readback = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.readback)
    const img = output.createImageData(w, h)
    const src = this.readback
    const dst = img.data
    for (let y = 0; y < h; y++) {
      // GL rows are bottom-up; ImageData is straight (not premultiplied) alpha.
      const from = (h - 1 - y) * w * 4
      const to = y * w * 4
      for (let i = 0; i < w * 4; i += 4) {
        const a = src[from + i + 3] ?? 0
        const k = a > 0 ? 255 / a : 0
        dst[to + i] = (src[from + i] ?? 0) * k
        dst[to + i + 1] = (src[from + i + 1] ?? 0) * k
        dst[to + i + 2] = (src[from + i + 2] ?? 0) * k
        dst[to + i + 3] = a
      }
    }
    output.putImageData(img, 0, 0)
  }

  dispose(): void {
    const gl = this.gl
    for (const pass of this.passes) pass.dispose?.(gl)
    for (const t of this.managed) {
      gl.deleteFramebuffer(t.framebuffer)
      gl.deleteTexture(t.texture)
    }
    for (const p of this.programs) gl.deleteProgram(p)
    gl.deleteTexture(this.sourceTex)
    gl.deleteVertexArray(this.vao)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private createKit(): PostKit {
    const gl = this.gl
    return {
      gl,
      program: (source) => this.compile(source),
      target: (scale = 1) => this.managedTarget(scale),
      bind: (t) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer)
        gl.viewport(0, 0, t.width, t.height)
      },
      texture: (unit, tex) => {
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, tex)
      },
      draw: () => {
        gl.bindVertexArray(this.vao)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
      copy: (input) => {
        this.copy.use()
        gl.uniform1i(this.copy.uniform('uInput'), 0)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, input)
        gl.bindVertexArray(this.vao)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
    }
  }

  private compile(fragmentSource: string): ShaderProgram {
    const gl = this.gl
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)
      if (!s) throw new Error('WebGL2: createShader failed')
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile error: ${gl.getShaderInfoLog(s) ?? ''}`)
      }
      return s
    }
    const program = gl.createProgram()
    const vs = shader(gl.VERTEX_SHADER, VERTEX)
    const fs = shader(gl.FRAGMENT_SHADER, fragmentSource)
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link error: ${gl.getProgramInfoLog(program) ?? ''}`)
    }
    this.programs.push(program)
    const uniforms = new Map<string, WebGLUniformLocation | null>()
    return {
      program,
      use: () => gl.useProgram(program),
      uniform: (name) => {
        if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name))
        return uniforms.get(name) ?? null
      },
    }
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()
    if (!tex) throw new Error('WebGL2: createTexture failed')
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private managedTarget(scale: number): ManagedTarget {
    const gl = this.gl
    const fb = gl.createFramebuffer()
    const t: ManagedTarget = {
      framebuffer: fb,
      texture: this.createTexture(),
      width: 0,
      height: 0,
      scale,
    }
    this.allocate(t)
    this.managed.push(t)
    return t
  }

  private allocate(t: ManagedTarget): void {
    const gl = this.gl
    t.width = Math.max(1, Math.round(this.width * t.scale))
    t.height = Math.max(1, Math.round(this.height * t.scale))
    gl.bindTexture(gl.TEXTURE_2D, t.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, t.width, t.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }
}
