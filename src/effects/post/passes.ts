/**
 * Post passes for the render engine's WebGL2 chain (`PostPass` in the effects host).
 * Each pass reads `io.input` and writes `io.output`; uniforms depend only on params and the frame.
 */

import type { FrameContext } from '@/render'
// TODO(render): import from '@/render' once its index re-exports the effects host types.
import type { PostKit, PostPass, RenderTarget, ShaderProgram } from '@/render/effectsHost'
import { hexToRgb } from '../math'
import { num, str, type ParamValues } from '../params'
import { beatPulse } from '../rhythm'
import type { PostDynamics } from '../types'
import { QUALITY_PROFILES, type PostEffectType, type PostQuality } from './settings'
import {
  ACCENTS_FS,
  BLOOM_COMBINE_FS,
  BLUR_FS,
  BRIGHT_FS,
  CHROMA_FS,
  COLOR_GRADE_FS,
  GRAIN_FS,
  SCANLINES_FS,
  VIGNETTE_FS,
} from './shaders'

const BEAT_DECAY_SEC = 0.12
const BEAT_DROP_BOOST = 1.5

type Setter = (gl: WebGL2RenderingContext, p: ShaderProgram, f: FrameContext) => void

/** One fullscreen draw of `fs` from io.input into io.output. */
function singlePass(fs: string, set: Setter, active?: (f: FrameContext) => boolean): PostPass {
  let prog: ShaderProgram | null = null
  return {
    init(kit) {
      prog = kit.program(fs)
    },
    active,
    render(kit, io, f) {
      if (!prog) return
      prog.use()
      kit.texture(0, io.input)
      kit.gl.uniform1i(prog.uniform('uInput'), 0)
      set(kit.gl, prog, f)
      kit.bind(io.output)
      kit.draw()
    },
  }
}

const pulse = (f: FrameContext) => beatPulse(f.timeline.audio, f.baseTime, BEAT_DECAY_SEC, BEAT_DROP_BOOST)

/** Accent pass driven by per-frame dynamics computed by the `accents` effect. */
export function accentsPass(dynamics: (f: FrameContext) => PostDynamics): PostPass {
  return singlePass(
    ACCENTS_FS,
    (gl, p, f) => {
      const d = dynamics(f)
      gl.uniform1f(p.uniform('uRgbSplit'), d.rgbSplit)
      gl.uniform1f(p.uniform('uGlitch'), d.glitch)
      gl.uniform1ui(p.uniform('uGlitchSeed'), d.glitchSeed >>> 0)
      gl.uniform1f(p.uniform('uGlitchSlices'), Math.max(1, d.glitchSlices))
      gl.uniform1f(p.uniform('uHue'), d.hueShift)
      gl.uniform1f(p.uniform('uSaturation'), d.saturation)
      gl.uniform1f(p.uniform('uInvert'), d.invert)
    },
  )
}

function bloomPass(params: ParamValues): PostPass {
  const profile = QUALITY_PROFILES[(str(params, 'quality') || 'medium') as PostQuality]
  let bright: ShaderProgram | null = null
  let blur: ShaderProgram | null = null
  let combine: ShaderProgram | null = null
  let a: RenderTarget | null = null
  let b: RenderTarget | null = null
  const strength = (f: FrameContext) => num(params, 'strength') * (1 + num(params, 'beatPulse') * pulse(f))

  const blurPass = (kit: PostKit, from: RenderTarget, to: RenderTarget, sx: number, sy: number) => {
    kit.bind(to)
    kit.texture(0, from.texture)
    kit.gl.uniform2f(blur?.uniform('uStep') ?? null, sx, sy)
    kit.draw()
  }

  return {
    init(kit) {
      bright = kit.program(BRIGHT_FS)
      blur = kit.program(BLUR_FS)
      combine = kit.program(BLOOM_COMBINE_FS)
      a = kit.target(profile.bloomScale)
      b = kit.target(profile.bloomScale)
    },
    active: (f) => strength(f) > 0.001,
    render(kit, io, f) {
      if (!bright || !blur || !combine || !a || !b) return
      const gl = kit.gl
      bright.use()
      kit.bind(a)
      kit.texture(0, io.input)
      gl.uniform1i(bright.uniform('uInput'), 0)
      gl.uniform2f(bright.uniform('uTexel'), 1 / io.width, 1 / io.height)
      gl.uniform1f(bright.uniform('uThreshold'), num(params, 'threshold'))
      kit.draw()

      // Steps are fractions of the frame height: the glow size does not depend on resolution or
      // quality (quality only changes how finely it is sampled).
      blur.use()
      gl.uniform1i(blur.uniform('uInput'), 0)
      const radius = (0.25 + 1.5 * num(params, 'radius')) * (4 / profile.bloomIterations)
      const aspect = a.height / a.width
      for (let i = 0; i < profile.bloomIterations; i++) {
        const step = 0.0016 * radius * (1 + i)
        blurPass(kit, a, b, step * aspect, 0)
        blurPass(kit, b, a, 0, step)
      }

      combine.use()
      kit.bind(io.output)
      kit.texture(0, io.input)
      kit.texture(1, a.texture)
      gl.uniform1i(combine.uniform('uInput'), 0)
      gl.uniform1i(combine.uniform('uBloom'), 1)
      gl.uniform1f(combine.uniform('uStrength'), strength(f))
      kit.draw()
    },
  }
}

/** Creates the pass for a post effect type with resolved params. */
export function createPostPass(type: PostEffectType, params: ParamValues): PostPass {
  const n = (k: string) => num(params, k)
  switch (type) {
    case 'bloom':
      return bloomPass(params)
    case 'chromatic-aberration': {
      const amount = (f: FrameContext) => n('amount') + n('beatPulse') * pulse(f)
      return singlePass(
        CHROMA_FS,
        (gl, p, f) => gl.uniform1f(p.uniform('uAmount'), amount(f)),
        (f) => amount(f) > 1e-5,
      )
    }
    case 'color-grade':
      return singlePass(COLOR_GRADE_FS, (gl, p) => {
        gl.uniform1f(p.uniform('uExposure'), n('exposure'))
        gl.uniform1f(p.uniform('uContrast'), n('contrast'))
        gl.uniform1f(p.uniform('uSaturation'), n('saturation'))
        gl.uniform1f(p.uniform('uTemperature'), n('temperature'))
        gl.uniform1f(p.uniform('uTint'), n('tint'))
        gl.uniform1f(p.uniform('uLift'), n('lift'))
        gl.uniform3fv(p.uniform('uShadowTint'), hexToRgb(str(params, 'shadowTint')))
        gl.uniform3fv(p.uniform('uHighlightTint'), hexToRgb(str(params, 'highlightTint')))
        gl.uniform1f(p.uniform('uToning'), n('toning'))
      })
    case 'vignette':
      return singlePass(
        VIGNETTE_FS,
        (gl, p, f) => {
          gl.uniform2f(p.uniform('uRes'), f.layout.width, f.layout.height)
          gl.uniform1f(p.uniform('uAmount'), n('amount'))
          gl.uniform1f(p.uniform('uSoftness'), n('softness'))
        },
        () => n('amount') > 0,
      )
    case 'scanlines':
      return singlePass(
        SCANLINES_FS,
        (gl, p, f) => {
          gl.uniform2f(p.uniform('uRes'), f.layout.width, f.layout.height)
          gl.uniform1ui(p.uniform('uFrame'), f.frameIndex >>> 0)
          gl.uniform1f(p.uniform('uAmount'), n('amount'))
          gl.uniform1f(p.uniform('uDensity'), Math.max(n('density'), 0.05))
          gl.uniform1f(p.uniform('uWobble'), n('wobble'))
          gl.uniform1f(p.uniform('uNoise'), n('noise'))
        },
        () => n('amount') > 0 || n('wobble') > 0 || n('noise') > 0,
      )
    case 'grain':
      return singlePass(
        GRAIN_FS,
        (gl, p, f) => {
          gl.uniform2f(p.uniform('uRes'), f.layout.width, f.layout.height)
          gl.uniform1ui(p.uniform('uFrame'), f.frameIndex >>> 0)
          gl.uniform1f(p.uniform('uAmount'), n('amount'))
          gl.uniform1f(p.uniform('uSize'), Math.max(n('size'), 0.5))
        },
        () => n('amount') > 0,
      )
  }
}
