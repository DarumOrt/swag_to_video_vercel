/**
 * Camera transform → 2D affine matrix. With `cover` the zoom is raised just enough that the
 * shifted / rotated frame still covers the whole viewport (no empty edges on shake or rotation).
 */

import type { CameraTransform } from './types'

/** [a, b, c, d, e, f] as in `setTransform(a, b, c, d, e, f)`. */
export type Matrix2D = [number, number, number, number, number, number]

export interface Viewport {
  width: number
  height: number
  /** Shorter side, px (`layout.unit`). */
  unit: number
}

/** Smallest zoom >= cam.zoom with which the transformed frame covers the viewport. */
export function coverZoom(cam: CameraTransform, vp: Viewport): number {
  const dx = cam.x * vp.unit
  const dy = cam.y * vp.unit
  const cos = Math.cos(cam.rotation)
  const sin = Math.sin(cam.rotation)
  const hw = vp.width / 2
  const hh = vp.height / 2
  let need = 0
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    // Viewport corner relative to the shifted center, rotated back into frame space.
    const qx = sx * hw - dx
    const qy = sy * hh - dy
    const rx = cos * qx + sin * qy
    const ry = -sin * qx + cos * qy
    need = Math.max(need, Math.abs(rx) / hw, Math.abs(ry) / hh)
  }
  return Math.max(cam.zoom, need)
}

export function cameraMatrix(cam: CameraTransform, vp: Viewport, cover = true): Matrix2D {
  const z = cover ? coverZoom(cam, vp) : cam.zoom
  const cx = vp.width / 2
  const cy = vp.height / 2
  const cos = Math.cos(cam.rotation) * z
  const sin = Math.sin(cam.rotation) * z
  const tx = cx + cam.x * vp.unit
  const ty = cy + cam.y * vp.unit
  // translate(tx, ty) · rotate · scale(z) · translate(-cx, -cy)
  return [cos, sin, -sin, cos, tx - cos * cx + sin * cy, ty - sin * cx - cos * cy]
}

export function isIdentityCamera(cam: CameraTransform): boolean {
  return cam.zoom === 1 && cam.x === 0 && cam.y === 0 && cam.rotation === 0
}
