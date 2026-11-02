/**
 * WebGL2 test renderer, shaped like the planned post-processing pipeline:
 * 2D layer (OffscreenCanvas) → texture → fragment shader → the export canvas (WebGL2 is the last pass).
 *
 * The frame index is drawn as 12 binary squares along the top edge, so a decoded export can be
 * checked frame by frame (`frameBitsAt`): a stale, blank or shifted capture shows up as a mismatch.
 * Options come through `scene` (so dev workers can receive them too).
 */

import type { FrameRate, FrameRenderer, RendererInit } from '@/shared'

export interface TestWebglOptions {
  /** WebGL context attribute. With false the drawing buffer may be cleared once the task yields. */
  preserveDrawingBuffer?: boolean
  /** Yield to the event loop (setTimeout 0) between drawing and resolving renderFrame. */
  yieldAfterDraw?: boolean
}

export const FRAME_BITS = 12

/** Geometry of the bit squares for a canvas of `width`: centre x of bit i and the row's centre y. */
export function bitGeometry(width: number) {
  const size = Math.round(width / 18)
  const step = Math.round(width / (FRAME_BITS + 2))
  return {
    size,
    centreY: Math.round(size / 2) + 4,
    centreX: (i: number) => step + i * step,
    left: (i: number) => step + i * step - Math.round(size / 2),
  }
}

const VERTEX = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 uv;
void main() {
  vec2 p = P[gl_VertexID];
  uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`

// Mild "post effect": a time-varying tint and a vignette below the bit row, so the shader pass
// visibly matters but never flips a bit.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D layer;
uniform float time;
out vec4 color;
void main() {
  vec3 c = texture(layer, uv).rgb;
  float bitRow = step(0.92, uv.y);
  vec2 d = uv - 0.5;
  float vignette = mix(1.0 - 0.6 * dot(d, d), 1.0, bitRow);
  vec3 tint = mix(vec3(1.0), 0.75 + 0.25 * vec3(sin(time), sin(time + 2.1), sin(time + 4.2)), 1.0 - bitRow);
  color = vec4(c * vignette * tint, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed')
  }
  return shader
}

export class TestWebglRenderer implements FrameRenderer {
  private gl: WebGL2RenderingContext | null = null
  private layer: OffscreenCanvas | null = null
  private g: OffscreenCanvasRenderingContext2D | null = null
  private texture: WebGLTexture | null = null
  private timeUniform: WebGLUniformLocation | null = null
  private options: TestWebglOptions = {}
  private width = 0
  private height = 0
  private fps: FrameRate = 30

  async init(init: RendererInit): Promise<void> {
    this.options = (init.scene as TestWebglOptions | null) ?? {}
    this.width = init.width
    this.height = init.height
    this.fps = init.fps
    const gl = init.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: this.options.preserveDrawingBuffer ?? false,
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl

    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed')
    }
    gl.useProgram(program)
    this.timeUniform = gl.getUniformLocation(program, 'time')

    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

    this.layer = new OffscreenCanvas(init.width, init.height)
    this.g = this.layer.getContext('2d', { alpha: false })
    gl.viewport(0, 0, init.width, init.height)
  }

  async renderFrame(frameIndex: number): Promise<void> {
    const { gl, g, layer } = this
    if (!gl || !g || !layer) throw new Error('renderFrame() before init()')
    const { width: w, height: h, fps } = this
    const t = frameIndex / fps

    // 2D layer: background, a moving bar, the frame index in binary.
    g.fillStyle = `hsl(${(t * 50) % 360} 55% 35%)`
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#ffd400'
    g.fillRect(((frameIndex % fps) / fps) * w, h * 0.5, Math.max(4, w / fps), h * 0.1)
    const bits = bitGeometry(w)
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, bits.size + 8)
    for (let i = 0; i < FRAME_BITS; i++) {
      g.fillStyle = (frameIndex >> i) & 1 ? '#fff' : '#202020'
      g.fillRect(bits.left(i), 4, bits.size, bits.size)
    }

    // WebGL pass into the export canvas.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer)
    gl.uniform1f(this.timeUniform, t)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    if (this.options.yieldAfterDraw) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.gl?.viewport(0, 0, width, height)
  }

  dispose(): void {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    this.gl = null
    this.g = null
    this.layer = null
  }
}

/**
 * Reads the frame index back from an RGBA image of the frame (any scale of the original width).
 * Returns null when the bit row is missing (e.g. a blank capture).
 */
export function frameBitsAt(
  data: Uint8ClampedArray,
  width: number,
  sourceWidth: number,
): number | null {
  const scale = width / sourceWidth
  const bits = bitGeometry(sourceWidth)
  const y = Math.round(bits.centreY * scale)
  let value = 0
  for (let i = 0; i < FRAME_BITS; i++) {
    const x = Math.round(bits.centreX(i) * scale)
    const p = (y * width + x) * 4
    const luma = (data[p]! + data[p + 1]! + data[p + 2]!) / 3
    if (luma > 128) {
      value |= 1 << i
    } else if (luma < 8) {
      return null // the off-squares are dark grey (#202020), pure black means no bit row at all
    }
  }
  return value
}
