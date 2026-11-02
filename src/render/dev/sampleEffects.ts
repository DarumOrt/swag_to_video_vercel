/**
 * Example effects for dev/render.html: exercise every extension point and show the effects session
 * how the API is meant to be used. Not shipped — real effects live in `src/effects/`.
 */

import type { Effect, EffectFactory, PostKit, ShaderProgram } from '../effectsHost'
import type { FrameContext } from '../types'

/** Camera: zoom punch on every beat, scaled by beat strength; a little seeded shake on downbeats. */
function beatZoom(id: string, amount: number): Effect {
  return {
    id,
    camera(f, camera) {
      const env = Math.exp(-f.beat.since / 0.12) * f.beat.strength
      camera.zoom *= 1 + amount * env
      if (f.beat.downbeat && f.beat.since < 0.15) {
        const rng = f.rng('shake')
        camera.x += (rng() - 0.5) * 0.02 * env
        camera.y += (rng() - 0.5) * 0.02 * env
      }
    },
  }
}

/** Overlay: a flash on downbeats. */
function downbeatFlash(id: string): Effect {
  return {
    id,
    overlay(g, f) {
      if (!f.beat.downbeat) return
      const a = 0.25 * Math.exp(-f.beat.since / 0.08)
      if (a < 0.01) return
      g.globalAlpha = a
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, f.layout.width, f.layout.height)
    },
  }
}

/** Post pass: RGB split that kicks on beats (WebGL2). */
function rgbSplit(id: string, amount: number): Effect {
  let program: ShaderProgram | null = null
  const strength = (f: FrameContext) => amount * Math.exp(-f.beat.since / 0.1) * f.beat.strength
  return {
    id,
    post: {
      init(kit: PostKit) {
        program = kit.program(`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
uniform float uShift;
out vec4 outColor;
void main() {
  vec4 c = texture(uInput, vUv);
  float r = texture(uInput, vUv + vec2(uShift, 0.0)).r;
  float b = texture(uInput, vUv - vec2(uShift, 0.0)).b;
  outColor = vec4(r, c.g, b, c.a);
}`)
      },
      active: (f) => strength(f) > 0.0005,
      render(kit, io, f) {
        if (!program) return
        const gl = kit.gl
        program.use()
        kit.texture(0, io.input)
        gl.uniform1i(program.uniform('uInput'), 0)
        gl.uniform1f(program.uniform('uShift'), strength(f))
        kit.bind(io.output)
        kit.draw()
      },
    },
  }
}

export const createSampleEffect: EffectFactory = (spec) => {
  const amount = typeof spec.params?.amount === 'number' ? spec.params.amount : undefined
  switch (spec.type) {
    case 'demo-beat-zoom':
      return beatZoom(spec.id, amount ?? 0.06)
    case 'demo-flash':
      return downbeatFlash(spec.id)
    case 'demo-rgb-split':
      return rgbSplit(spec.id, amount ?? 0.008)
    default:
      return null
  }
}

export const SAMPLE_EFFECTS = [
  { id: 'zoom', type: 'demo-beat-zoom' },
  { id: 'flash', type: 'demo-flash' },
  { id: 'rgb', type: 'demo-rgb-split' },
]
