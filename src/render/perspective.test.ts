import { describe, expect, it } from 'vitest'
import { cameraScale } from './effectsHost'
import { hasTilt, perspectiveCover, unproject } from './perspective'
import { projectWord } from './words'

describe('perspective camera', () => {
  it('is the identity without tilt', () => {
    expect(perspectiveCover(0, 0, 9 / 16)).toBe(1)
    const p = unproject(0.3, -0.4, 0, 0)
    expect(p?.[0]).toBeCloseTo(0.3, 6)
    expect(p?.[1]).toBeCloseTo(-0.4, 6)
    expect(hasTilt({})).toBe(false)
    expect(hasTilt({ tiltY: 0.1 })).toBe(true)
  })

  it('covers the frame: every screen corner lands inside the scaled plane', () => {
    const aspect = 9 / 16
    for (const [tx, ty] of [
      [0.3, 0],
      [0, 0.4],
      [-0.25, 0.3],
    ] as const) {
      const cover = perspectiveCover(tx, ty, aspect)
      expect(cover).toBeGreaterThan(1)
      for (const [x, y] of [
        [-aspect, -1],
        [aspect, 1],
        [aspect, -1],
        [-aspect, 1],
      ] as const) {
        const p = unproject(x, y, tx, ty)!
        expect(Math.abs(p[0] / cover)).toBeLessThanOrEqual(aspect + 1e-9)
        expect(Math.abs(p[1] / cover)).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  it('keystone: the near edge of a tilted plane looks wider than the far edge', () => {
    // Screen width needed to see the plane's top and bottom edges: unproject the screen edges.
    const top = unproject(0.5, 0.8, 0.3, 0)!
    const bottom = unproject(0.5, -0.8, 0.3, 0)!
    expect(Math.abs(top[0])).not.toBeCloseTo(Math.abs(bottom[0]), 3)
  })

  it('2D fallback squashes layers and word boxes alike', () => {
    const cam = { zoom: 1, rotation: 0, x: 0, y: 0, tiltY: Math.PI / 3 }
    expect(cameraScale(cam)[0]).toBeCloseTo(0.5, 6)
    const box = projectWord(
      { wordId: 'w', x: 700, y: 500, width: 200, height: 100, start: 0, end: 1 },
      'l',
      cam,
      1000,
      1000,
      1000,
    )
    expect(box.x).toBeCloseTo(600, 6)
    expect(box.width).toBeCloseTo(100, 6)
    expect(box.height).toBeCloseTo(100, 6)
  })
})
