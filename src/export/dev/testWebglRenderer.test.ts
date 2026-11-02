import { describe, expect, it } from 'vitest'
import { bitGeometry, FRAME_BITS, frameBitsAt } from './testWebglRenderer'

/** RGBA image of `width`×`height` filled with `fill`, with the frame index drawn like the renderer. */
function image(width: number, height: number, frameIndex: number | null, fill = 40) {
  const data = new Uint8ClampedArray(width * height * 4).fill(fill)
  if (frameIndex !== null) {
    const bits = bitGeometry(width)
    for (let i = 0; i < FRAME_BITS; i++) {
      const v = (frameIndex >> i) & 1 ? 255 : 32
      for (let y = 4; y < 4 + bits.size; y++) {
        for (let x = bits.left(i); x < bits.left(i) + bits.size; x++) {
          data.fill(v, (y * width + x) * 4, (y * width + x) * 4 + 3)
        }
      }
    }
  }
  return data
}

describe('frameBitsAt', () => {
  it('reads back the frame index', () => {
    for (const n of [0, 1, 5, 89, 4095]) {
      expect(frameBitsAt(image(720, 200, n), 720, 720)).toBe(n)
    }
  })

  it('reports a blank (black) frame as null', () => {
    expect(frameBitsAt(image(720, 200, null, 0), 720, 720)).toBeNull()
  })
})
