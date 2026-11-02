import { describe, expect, it } from 'vitest'
import type { RenderCanvas } from '@/shared'
import { createFakeTimeline } from '../dev/fakeTimeline'
import { SceneRenderer } from '../SceneRenderer'
import { layerDefaults, normalizeScene, type LayerType } from '../scene'
import { createRecordingCanvas } from '../testing/recordingCanvas'
import { LAYER_SCHEMAS } from './layerSchemas'
import { defaultParams, resolveParams } from './params'
import { buildPresetScene, getStylePreset, presetDefaults, STYLE_PRESETS } from './presets'

const timeline = createFakeTimeline({ durationSec: 20 })

async function renderLog(scene: unknown, width: number, height: number, frame: number) {
  const { canvas, log } = createRecordingCanvas()
  const r = new SceneRenderer()
  await r.init({
    canvas: canvas as unknown as RenderCanvas,
    width,
    height,
    fps: 30,
    timeline,
    scene,
  })
  log.length = 0
  r.renderFrame(frame)
  return structuredClone(log)
}

describe('style presets', () => {
  it('has the four styles, each tied to an effect style', () => {
    expect(STYLE_PRESETS.map((p) => p.id)).toEqual(['studio', 'neon', 'minimal', 'grunge'])
    for (const p of STYLE_PRESETS) expect(p.effectStyle).toBe(p.id)
  })

  it.each(STYLE_PRESETS.map((p) => p.id))('%s builds a valid scene from defaults', (id) => {
    const scene = normalizeScene(buildPresetScene(id))
    expect(scene.layers.length).toBeGreaterThan(2)
  })

  it.each(STYLE_PRESETS.map((p) => p.id))(
    '%s renders the same commands twice in 9:16 and 16:9',
    async (id) => {
      const scene = buildPresetScene(id, { title: 'Ночной город' })
      for (const [w, h] of [
        [1080, 1920],
        [1920, 1080],
      ] as const) {
        const a = await renderLog(scene, w, h, 160)
        const b = await renderLog(scene, w, h, 160)
        expect(a.length).toBeGreaterThan(10)
        expect(b).toEqual(a)
      }
    },
  )

  it('falls back to defaults for invalid knob values', () => {
    const p = getStylePreset('neon')
    const v = resolveParams(p.params, { barCount: 1000, primary: 'red', visual: 'nope' })
    expect(v.barCount).toBe(96)
    expect(v.primary).toBe(presetDefaults(p).primary)
    expect(v.visual).toBe('both')
  })

  it('applies knobs: toggles remove layers, the title lands in the text layer', () => {
    const off = buildPresetScene('studio', { goniometer: false, spectrogram: false })
    const ids = off.layers.map((l) => l.id)
    expect(ids).not.toContain('goniometer')
    expect(ids).not.toContain('spectrogram')
    const titled = buildPresetScene('grunge', { title: 'Привет' })
    expect(titled.layers.find((l) => l.id === 'title')).toMatchObject({ text: 'Привет' })
  })

  it('unknown preset id falls back to neon', () => {
    expect(getStylePreset('nope').id).toBe('neon')
  })
})

describe('layer schemas', () => {
  it('every schema key is a real field of the layer, with a matching default type', () => {
    for (const [type, schema] of Object.entries(LAYER_SCHEMAS)) {
      const defaults = layerDefaults(type as LayerType) as Record<string, unknown>
      for (const p of schema.params) {
        if (p.key === 'text') continue
        expect(defaults, `${type}.${p.key}`).toHaveProperty(p.key)
        const d = defaults[p.key]
        expect(
          typeof d === p.default.constructor.name.toLowerCase() || typeof d === typeof p.default,
        ).toBe(true)
      }
    }
  })

  it('defaults resolve to themselves', () => {
    for (const schema of Object.values(LAYER_SCHEMAS)) {
      const d = defaultParams(schema.params)
      expect(resolveParams(schema.params, d)).toEqual(d)
    }
  })
})
