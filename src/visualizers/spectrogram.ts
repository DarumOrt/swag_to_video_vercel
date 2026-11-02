/**
 * Spectrogram waterfall: the last `historySec` of the spectrum as a scrolling color image.
 * Rebuilt from the timeline every frame (no history state), drawn through a small offscreen image
 * scaled up with smoothing — cheap at any output size.
 */

import type { Ctx2D, FrameContext, Layer, LayerSpecBase, RectSpec } from '@/render'
import { buildColorLut, drawGrid, type ColorStopSpec } from './common'
import { binPosition } from './spectrumMath'

export interface SpectrogramSpec extends LayerSpecBase {
  type: 'spectrogram'
  rect: RectSpec
  historySec: number
  minHz: number
  maxHz: number
  /** 'up' = newest row at the bottom, scrolling up; 'left' = newest column at the right. */
  direction: 'up' | 'left'
  /** Hex color stops for values 0..1. */
  colormap: ColorStopSpec[]
  gamma: number
  grid: boolean
  gridColor: string
}

export const SPECTROGRAM_DEFAULTS: Omit<SpectrogramSpec, 'id' | 'type'> = {
  rect: { x: 0, y: 0.55, w: 1, h: 0.3, space: 'bleed' },
  historySec: 6,
  minHz: 30,
  maxHz: 16000,
  direction: 'left',
  colormap: [
    { offset: 0, color: '#00000000' },
    { offset: 0.35, color: '#3b0764' },
    { offset: 0.6, color: '#db2777' },
    { offset: 0.85, color: '#fbbf24' },
    { offset: 1, color: '#fffbeb' },
  ],
  gamma: 1.4,
  grid: false,
  gridColor: 'rgba(255,255,255,0.12)',
}

const MAX_COLUMNS = 128

export class SpectrogramLayer implements Layer {
  readonly id: string
  private readonly spec: SpectrogramSpec
  private readonly lut: Uint8ClampedArray
  private image: OffscreenCanvas | null = null
  private imageCtx: OffscreenCanvasRenderingContext2D | null = null
  private pixels: ImageData | null = null
  private row = new Float32Array(0)
  /**
   * Colored rows by feature index (ring buffer). A row depends only on its index, so caching is
   * safe for determinism; sequential playback computes one new row per feature frame.
   */
  private rowCache: { keys: Int32Array; rgba: Uint8ClampedArray; bins: number; geometry: string } =
    {
      keys: new Int32Array(0),
      rgba: new Uint8ClampedArray(0),
      bins: 0,
      geometry: '',
    }

  constructor(spec: SpectrogramSpec) {
    this.id = spec.id
    this.spec = spec
    this.lut = buildColorLut(spec.colormap)
  }

  draw(g: Ctx2D, f: FrameContext): void {
    if (typeof OffscreenCanvas === 'undefined') return
    const s = this.spec
    const features = f.timeline.audio.features
    const grid = features.spectrum
    const history = Math.max(2, Math.min(Math.round(s.historySec * features.rate), 1024))
    const p0 = Math.max(binPosition(grid, Math.max(s.minHz, grid.minHz)), 0)
    const p1 = Math.min(binPosition(grid, Math.min(s.maxHz, grid.maxHz)), grid.binCount - 1)
    const bins = Math.max(2, Math.min(Math.round(p1 - p0) + 1, MAX_COLUMNS))
    const up = s.direction === 'up'
    const w = up ? bins : history
    const h = up ? history : bins
    this.ensureImage(w, h)
    if (!this.pixels || !this.image || !this.imageCtx) return
    if (this.row.length !== grid.binCount) this.row = new Float32Array(grid.binCount)

    const data = this.pixels.data
    const cache = this.ensureRowCache(history, bins, `${p0}|${p1}|${grid.binCount}`)
    const newest = Math.floor(f.featurePos)
    for (let k = 0; k < history; k++) {
      const idx = newest - (history - 1 - k)
      const rgba = idx < 0 ? null : this.coloredRow(f, idx, cache, bins, p0, p1, grid.binCount)
      for (let b = 0; b < bins; b++) {
        // up: x = bin, y = time (newest at bottom); left: x = time (newest right), y = bin (low at bottom).
        const px = up ? b : k
        const py = up ? k : bins - 1 - b
        const o = (py * w + px) * 4
        if (!rgba) {
          data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0
          continue
        }
        const src = rgba.offset + b * 4
        data[o] = rgba.data[src] ?? 0
        data[o + 1] = rgba.data[src + 1] ?? 0
        data[o + 2] = rgba.data[src + 2] ?? 0
        data[o + 3] = rgba.data[src + 3] ?? 0
      }
    }
    this.imageCtx.putImageData(this.pixels, 0, 0)

    const r = f.rect(s.rect)
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(this.image, r.x, r.y, r.w, r.h)
    if (s.grid) drawGrid(g, r, f.layout.unit, { color: s.gridColor, lineWidth: 0.0015 }, 6, 4)
  }

  private ensureRowCache(slots: number, bins: number, geometry: string) {
    const c = this.rowCache
    if (c.keys.length !== slots || c.bins !== bins || c.geometry !== geometry) {
      this.rowCache = {
        keys: new Int32Array(slots).fill(-1),
        rgba: new Uint8ClampedArray(slots * bins * 4),
        bins,
        geometry,
      }
    }
    return this.rowCache
  }

  /** RGBA of feature row `idx` (cached in the ring buffer). */
  private coloredRow(
    f: FrameContext,
    idx: number,
    cache: SpectrogramLayer['rowCache'],
    bins: number,
    p0: number,
    p1: number,
    binCount: number,
  ): { data: Uint8ClampedArray; offset: number } {
    const slot = idx % cache.keys.length
    const offset = slot * bins * 4
    if (cache.keys[slot] === idx) return { data: cache.rgba, offset }
    f.spectrumAt(idx, this.row)
    for (let b = 0; b < bins; b++) {
      const pos = p0 + ((p1 - p0) * b) / (bins - 1)
      const i0 = Math.floor(pos)
      const i1 = Math.min(i0 + 1, binCount - 1)
      const a = this.row[i0] ?? 0
      const v = a + ((this.row[i1] ?? 0) - a) * (pos - i0)
      const c = Math.round(Math.pow(Math.min(Math.max(v, 0), 1), this.spec.gamma) * 255) * 4
      cache.rgba[offset + b * 4] = this.lut[c] ?? 0
      cache.rgba[offset + b * 4 + 1] = this.lut[c + 1] ?? 0
      cache.rgba[offset + b * 4 + 2] = this.lut[c + 2] ?? 0
      cache.rgba[offset + b * 4 + 3] = this.lut[c + 3] ?? 0
    }
    cache.keys[slot] = idx
    return { data: cache.rgba, offset }
  }

  private ensureImage(w: number, h: number) {
    if (this.image && this.image.width === w && this.image.height === h) return
    this.image = new OffscreenCanvas(w, h)
    // CPU-backed: a GPU canvas is copied differently on its first drawImage than on later ones,
    // which would make the first rendered frame differ by a few levels from the same frame later.
    this.imageCtx = this.image.getContext('2d', { willReadFrequently: true })
    this.pixels = this.imageCtx?.createImageData(w, h) ?? null
  }
}
