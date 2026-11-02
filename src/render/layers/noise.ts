/**
 * Film-grain / dirt layer: a seeded noise tile repeated over the frame, re-positioned `refreshHz`
 * times per second, plus optional vertical scratches. Deterministic: tile from the layer seed,
 * offsets from (seed, refresh step).
 */

import { createRng, hash32 } from '../random'
import type { Ctx2D, FrameContext, Layer, LayerSpecBase } from '../types'

export interface NoiseSpec extends LayerSpecBase {
  type: 'noise'
  /** Strength 0..1 (alpha of the noise). */
  amount: number
  /** Grain size in units (fraction of the shorter frame side). */
  grain: number
  monochrome: boolean
  /** How often the pattern jumps, per second; 0 = static. */
  refreshHz: number
  /** Number of vertical scratches per refresh; 0 = none. */
  scratches: number
  scratchColor: string
}

export const NOISE_DEFAULTS: Omit<NoiseSpec, 'id' | 'type'> = {
  amount: 0.18,
  grain: 0.0025,
  monochrome: true,
  refreshHz: 12,
  scratches: 0,
  scratchColor: 'rgba(255,255,255,0.35)',
  blend: 'overlay',
  camera: false,
}

const TILE = 256

export class NoiseLayer implements Layer {
  readonly id: string
  private readonly spec: NoiseSpec
  private tile: OffscreenCanvas | null = null
  private tileSeed = -1

  constructor(spec: NoiseSpec) {
    this.id = spec.id
    this.spec = spec
  }

  draw(g: Ctx2D, f: FrameContext): void {
    const s = this.spec
    if (s.amount <= 0) return
    const { width: w, height: h, unit } = f.layout
    const step = s.refreshHz > 0 ? Math.floor(f.baseTime * s.refreshHz) : 0
    const rng = createRng(hash32(f.seed, 'noise', step))

    const tile = this.ensureTile(f.seed)
    if (tile) {
      const pattern = g.createPattern(tile, 'repeat')
      if (pattern) {
        const scale = Math.max((s.grain * unit) / 1, 0.25)
        pattern.setTransform(
          new DOMMatrix()
            .translateSelf(rng() * TILE * scale, rng() * TILE * scale)
            .scaleSelf(scale),
        )
        g.globalAlpha *= Math.min(s.amount, 1)
        g.fillStyle = pattern
        g.fillRect(0, 0, w, h)
      }
    }

    const count = Math.max(0, Math.floor(s.scratches))
    if (count > 0) {
      g.globalCompositeOperation = 'source-over'
      g.strokeStyle = s.scratchColor
      for (let i = 0; i < count; i++) {
        const x = rng() * w
        const y0 = rng() * h * 0.5
        const len = h * (0.2 + rng() * 0.8)
        g.lineWidth = Math.max(unit * (0.0008 + rng() * 0.0015), 1)
        g.beginPath()
        g.moveTo(x, y0)
        g.lineTo(x + (rng() - 0.5) * unit * 0.01, y0 + len)
        g.stroke()
      }
    }
  }

  private ensureTile(seed: number): OffscreenCanvas | null {
    if (typeof OffscreenCanvas === 'undefined') return null
    if (this.tile && this.tileSeed === seed) return this.tile
    const tile = new OffscreenCanvas(TILE, TILE)
    // CPU-backed for the same reason as the spectrogram image: stable first-frame compositing.
    const ctx = tile.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const img = ctx.createImageData(TILE, TILE)
    const rng = createRng(hash32(seed, 'tile'))
    for (let i = 0; i < TILE * TILE; i++) {
      const v = rng() * 255
      img.data[i * 4] = v
      img.data[i * 4 + 1] = this.spec.monochrome ? v : rng() * 255
      img.data[i * 4 + 2] = this.spec.monochrome ? v : rng() * 255
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    this.tile = tile
    this.tileSeed = seed
    return tile
  }
}
