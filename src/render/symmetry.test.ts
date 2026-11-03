/**
 * Centering: every preset in every format keeps its centered layers on the frame's vertical center
 * line, and the centered visualizers draw their content symmetrically inside their rect.
 */

import { describe, expect, it } from 'vitest'
import type { RenderCanvas } from '@/shared'
import { createFakeTimeline } from './dev/fakeTimeline'
import { computeLayout, resolveRect, type PixelRect, type RectSpec } from './layout'
import { SceneRenderer } from './SceneRenderer'
import { normalizeScene, type LayerSpec } from './scene'
import { buildPresetScene, STYLE_PRESETS } from './styles/presets'

const FORMATS: [string, number, number][] = [
  ['9:16', 1080, 1920],
  ['16:9', 1920, 1080],
  ['1:1', 1080, 1080],
  ['4:5', 1080, 1350],
]
const timeline = createFakeTimeline({ durationSec: 20 })

const rectOf = (l: LayerSpec): RectSpec | null =>
  'rect' in l && l.rect && typeof l.rect === 'object' ? (l.rect as RectSpec) : null
const alignOf = (l: LayerSpec): string => ('align' in l ? String(l.align) : 'center')

/** Layers meant to sit on the center line: rect centered in its space, text centered. */
function centeredLayers(scene: ReturnType<typeof normalizeScene>): LayerSpec[] {
  return scene.layers.filter((l) => {
    const r = rectOf(l)
    return r !== null && Math.abs(r.x + r.w / 2 - 0.5) < 1e-6 && alignOf(l) === 'center'
  })
}

const margins = (r: PixelRect, width: number) => ({ left: r.x, right: width - (r.x + r.w) })

describe('preset layout is centered', () => {
  for (const preset of STYLE_PRESETS) {
    for (const [name, w, h] of FORMATS) {
      it(`${preset.id} ${name}: centered rects are symmetric`, () => {
        const scene = normalizeScene(buildPresetScene(preset.id, { title: 'Ночной город' }))
        const layout = computeLayout(w, h, scene.safeArea)
        const layers = centeredLayers(scene)
        expect(layers.length).toBeGreaterThan(1)
        for (const l of layers) {
          const m = margins(resolveRect(rectOf(l) as RectSpec, layout), w)
          expect(Math.abs(m.left - m.right), `${l.id}`).toBeLessThanOrEqual(1)
        }
      })
    }
  }

  it('studio side-by-side goniometer and meters mirror each other', () => {
    for (const [, w, h] of FORMATS) {
      const scene = normalizeScene(buildPresetScene('studio'))
      const layout = computeLayout(w, h, scene.safeArea)
      const get = (id: string) => {
        const l = scene.layers.find((x) => x.id === id)
        return resolveRect(rectOf(l as LayerSpec) as RectSpec, layout)
      }
      const a = margins(get('goniometer'), w)
      const b = margins(get('meters'), w)
      expect(Math.abs(a.left - b.right)).toBeLessThanOrEqual(1)
    }
  })

  it('center space is symmetric, bleed spans the full width', () => {
    for (const [, w, h] of FORMATS) {
      const layout = computeLayout(w, h, 'social')
      const c = margins(layout.center, w)
      expect(Math.abs(c.left - c.right)).toBeLessThanOrEqual(1e-6)
      expect(layout.center.x).toBeGreaterThanOrEqual(layout.safe.x)
      expect(layout.center.x + layout.center.w).toBeLessThanOrEqual(
        layout.safe.x + layout.safe.w + 1e-6,
      )
      expect(layout.bleed).toMatchObject({ x: 0, w, y: layout.safe.y, h: layout.safe.h })
    }
  })
})

// ---------------------------------------------------------------------------
// Content symmetry: a fake 2D context that tracks the transform and the x extent of geometry.
// ---------------------------------------------------------------------------

type M = [number, number, number, number, number, number]
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

function boundsCanvas() {
  let m: M = [1, 0, 0, 1, 0, 0]
  const stack: M[] = []
  const box = { minX: Infinity, maxX: -Infinity }
  const state: Record<string, unknown> = { font: '10px sans-serif', textAlign: 'start' }
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10)
  const measure = (s: string) => s.length * px() * 0.55
  const point = (x: number, y: number) => {
    const sx = m[0] * x + m[2] * y + m[4]
    box.minX = Math.min(box.minX, sx)
    box.maxX = Math.max(box.maxX, sx)
  }
  const rect = (x: number, y: number, w: number, h: number) => {
    point(x, y)
    point(x + w, y)
    point(x, y + h)
    point(x + w, y + h)
  }
  const text = (s: string, x: number, y: number) => {
    const w = measure(s)
    const a = String(state.textAlign)
    const left = a === 'center' ? x - w / 2 : a === 'right' || a === 'end' ? x - w : x
    point(left, y)
    point(left + w, y)
  }
  const gradient = () => ({ addColorStop: () => {} })
  const api: Record<string, (...a: number[]) => unknown> = {
    save: () => stack.push(m),
    restore: () => {
      m = stack.pop() ?? [1, 0, 0, 1, 0, 0]
    },
    translate: (x, y) => (m = mul(m, [1, 0, 0, 1, x, y])),
    scale: (x, y) => (m = mul(m, [x, 0, 0, y, 0, 0])),
    rotate: (r) => (m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0])),
    setTransform: (a, b, c, d, e, f) => (m = [a, b, c, d, e, f]),
    moveTo: (x, y) => point(x, y),
    lineTo: (x, y) => point(x, y),
    quadraticCurveTo: (cx, cy, x, y) => {
      point(cx, cy)
      point(x, y)
    },
    rect,
    roundRect: (x, y, w, h) => rect(x, y, w, h),
    fillRect: rect,
    strokeRect: rect,
    createLinearGradient: gradient,
    createRadialGradient: gradient,
  }
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop === 'measureText') return (s: string) => ({ width: measure(s) })
      if (prop === 'fillText' || prop === 'strokeText') return text
      if (prop in api) return api[prop]
      if (prop in target) return target[prop]
      return () => {}
    },
    set(target, prop: string, value) {
      target[prop] = value
      return true
    },
  })
  return {
    canvas: { width: 0, height: 0, getContext: () => ctx },
    box,
    reset() {
      box.minX = Infinity
      box.maxX = -Infinity
    },
  }
}

/** Centered visualizers whose drawing should be mirror-symmetric in x within the rect. */
const CONTENT_TYPES = new Set([
  'spectrum-bars',
  'spectrum-curve',
  'oscilloscope',
  'goniometer',
  'waveform',
  'text',
  'lyrics',
  'kinetic',
])

/** Neutralize data-dependent asymmetry that is intended (random jitter, data points). */
function forContentCheck(l: LayerSpec): LayerSpec {
  if (l.type === 'goniometer') return { ...l, grid: true, labels: false, gain: 0 }
  if (l.type === 'kinetic') return { ...l, jitter: 0, jitterRotate: 0, tear: 0 }
  // Appearing modes draw a line partially on purpose (only the words sung so far): check the whole line.
  if (l.type === 'lyrics') return { ...l, reveal: 'line', anim: 'none' }
  return l
}

describe('centered visualizers draw symmetrically inside their rect', () => {
  for (const preset of STYLE_PRESETS) {
    for (const [name, w, h] of FORMATS) {
      it(`${preset.id} ${name}`, async () => {
        const scene = normalizeScene(buildPresetScene(preset.id, { title: 'Ночной город' }))
        const layout = computeLayout(w, h, scene.safeArea)
        const layers = centeredLayers(scene).filter((l) => CONTENT_TYPES.has(l.type))
        expect(layers.length).toBeGreaterThan(0)
        for (const layer of layers) {
          const fake = boundsCanvas()
          const r = new SceneRenderer()
          await r.init({
            canvas: fake.canvas as unknown as RenderCanvas,
            width: w,
            height: h,
            fps: 30,
            timeline,
            // Layout check: no director camera (its drift is meant to be off-center).
            scene: { ...scene, layers: [forContentCheck(layer)], effects: [], director: null },
          })
          // Several frames: quiet / loud, on and off the beat.
          for (const frame of [45, 160, 301]) {
            fake.reset()
            r.renderFrame(frame)
            if (!Number.isFinite(fake.box.minX)) continue // nothing drawn (e.g. no lyric line)
            // clearRect is not tracked, so the box covers only what the layer drew.
            const rect = resolveRect(rectOf(layer) as RectSpec, layout)
            const left = fake.box.minX - rect.x
            const right = rect.x + rect.w - fake.box.maxX
            expect(Math.abs(left - right), `${layer.id} @${frame}`).toBeLessThanOrEqual(1)
          }
          r.dispose()
        }
      })
    }
  }
})
