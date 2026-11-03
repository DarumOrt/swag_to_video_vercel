/**
 * True 3D camera for `CameraTransform.tiltX / tiltY`: the finished frame is a plane rotated in front
 * of a pinhole camera and re-projected in a WebGL pass (keystone, depth). The plane is scaled up just
 * enough that the frame stays covered at every corner, so no empty edges show.
 *
 * Owned by the engine (not an effect): it is the first pass of the post chain and runs only on frames
 * with a non-zero tilt. Layers then get the camera without tilt (no 2D squash on top).
 */

import type { PostPass, ShaderProgram } from './effectsHost'

/** Focal length in half-heights of the frame: ≈ 49° vertical field of view. */
export const PERSPECTIVE_FOCAL = 2.2

const MIN_TILT = 1e-4

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
uniform mat3 uRot;
uniform float uAspect;
uniform float uFocal;
uniform float uCover;
out vec4 outColor;
void main() {
  // Screen point in plane units: x in [-aspect, aspect], y in [-1, 1].
  vec2 s = vUv * 2.0 - 1.0;
  s.x *= uAspect;
  vec3 c = vec3(0.0, 0.0, uFocal);
  vec3 d = vec3(s, -uFocal);
  vec3 n = uRot * vec3(0.0, 0.0, 1.0);
  float dn = dot(d, n);
  float t = -dot(c, n) / dn;
  vec3 local = transpose(uRot) * (c + t * d);
  vec2 uv = vec2(local.x / uAspect, local.y) / uCover * 0.5 + 0.5;
  if (t <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    outColor = vec4(0.0);
  } else {
    outColor = texture(uInput, uv);
  }
}`

/** Rotation matrix Rx(tiltX)·Ry(tiltY), column-major (as WebGL wants it). */
export function tiltMatrix(tiltX: number, tiltY: number): Float32Array {
  const cx = Math.cos(tiltX)
  const sx = Math.sin(tiltX)
  const cy = Math.cos(tiltY)
  const sy = Math.sin(tiltY)
  // Row-major R = Rx · Ry
  const r = [
    [cy, 0, sy],
    [sx * sy, cx, -sx * cy],
    [-cx * sy, sx, cx * cy],
  ]
  const m = new Float32Array(9)
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++) m[col * 3 + row] = r[row]![col]!
  return m
}

/**
 * Plane point seen at screen point (sx, sy) (plane units, see the shader), or null when the ray
 * misses the plane (behind the camera).
 */
export function unproject(
  sx: number,
  sy: number,
  tiltX: number,
  tiltY: number,
  focal = PERSPECTIVE_FOCAL,
): [number, number] | null {
  const m = tiltMatrix(tiltX, tiltY)
  // n = R · (0,0,1) = third column of R.
  const n = [m[6]!, m[7]!, m[8]!]
  const d = [sx, sy, -focal]
  const dn = d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!
  if (Math.abs(dn) < 1e-9) return null
  const t = -(focal * n[2]!) / dn
  if (t <= 0) return null
  const p = [t * d[0]!, t * d[1]!, focal + t * d[2]!]
  // local = Rᵀ · p (columns of R dotted with p).
  return [
    m[0]! * p[0]! + m[1]! * p[1]! + m[2]! * p[2]!,
    m[3]! * p[0]! + m[4]! * p[1]! + m[5]! * p[2]!,
  ]
}

/** Scale of the plane so its frame covers all four screen corners (≥ 1). */
export function perspectiveCover(tiltX: number, tiltY: number, aspect: number): number {
  let cover = 1
  for (const [x, y] of [
    [-aspect, -1],
    [aspect, -1],
    [-aspect, 1],
    [aspect, 1],
  ] as const) {
    const p = unproject(x, y, tiltX, tiltY)
    if (!p) return 4
    cover = Math.max(cover, Math.abs(p[0]) / aspect, Math.abs(p[1]))
  }
  return Math.min(cover, 4)
}

export function hasTilt(c: { tiltX?: number; tiltY?: number }): boolean {
  return Math.abs(c.tiltX ?? 0) > MIN_TILT || Math.abs(c.tiltY ?? 0) > MIN_TILT
}

export function createPerspectivePass(): PostPass {
  let program: ShaderProgram | null = null
  return {
    init(kit) {
      program = kit.program(FRAGMENT)
    },
    active: (frame) => hasTilt(frame.camera),
    render(kit, io, frame) {
      if (!program) return
      const gl = kit.gl
      const tiltX = frame.camera.tiltX ?? 0
      const tiltY = frame.camera.tiltY ?? 0
      const aspect = io.width / io.height
      program.use()
      kit.texture(0, io.input)
      gl.uniform1i(program.uniform('uInput'), 0)
      gl.uniformMatrix3fv(program.uniform('uRot'), false, tiltMatrix(tiltX, tiltY))
      gl.uniform1f(program.uniform('uAspect'), aspect)
      gl.uniform1f(program.uniform('uFocal'), PERSPECTIVE_FOCAL)
      gl.uniform1f(program.uniform('uCover'), perspectiveCover(tiltX, tiltY, aspect))
      kit.draw()
    },
  }
}
