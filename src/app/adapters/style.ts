/** Style presets from `@/render` (+ matching effect style from `@/effects`) in the shape the UI uses. */
import {
  DEFAULT_STYLE_PRESET,
  STYLE_PRESETS as RENDER_PRESETS,
  getStylePreset,
  normalizeScene,
  type Scene,
  type SceneInput,
} from '@/render'
import { styleEffects } from '@/effects'
import { toSchema } from './convert'
import { defaultValues, resolveValues, type ParamSchema, type ParamValues } from './params'

export interface StylePreset {
  id: string
  name: string
  description: string
  params: readonly ParamSchema[]
  build: (values: ParamValues) => SceneInput
}

export const STYLE_PRESETS: readonly StylePreset[] = RENDER_PRESETS.map((preset) => {
  const params = preset.params.map(toSchema)
  return {
    id: preset.id,
    name: preset.name.ru,
    description: preset.description.ru,
    params,
    build: (values) => ({
      ...preset.build(resolveValues(params, values)),
      effects: styleEffects(preset.effectStyle),
    }),
  }
})

export const DEFAULT_PRESET_ID: string = DEFAULT_STYLE_PRESET

export function findPreset(id: string): StylePreset {
  const real = getStylePreset(id).id
  return STYLE_PRESETS.find((p) => p.id === real) ?? STYLE_PRESETS[0]!
}

export function presetDefaults(id: string): ParamValues {
  return defaultValues(findPreset(id).params)
}

/** Director knobs the user may override on top of the preset (only for presets with a director). */
export interface DirectorOverrides {
  energy?: number
  chaos?: number
  randomness?: number
}

export interface SceneExtras {
  /** Scene seed: the same seed gives the same video. */
  seed?: number
  director?: DirectorOverrides
}

/** Scene for a preset and its values — one object shared by preview and export. */
export function buildScene(presetId: string, values: ParamValues, extras: SceneExtras = {}): Scene {
  const input = findPreset(presetId).build(values)
  const scene = normalizeScene(extras.seed === undefined ? input : { ...input, seed: extras.seed })
  const overrides = extras.director
  if (!scene.director || !overrides) return scene
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const director = { ...scene.director }
  if (overrides.energy !== undefined) director.energy = clamp(overrides.energy)
  if (overrides.chaos !== undefined) director.chaos = clamp(overrides.chaos)
  if (overrides.randomness !== undefined) director.randomness = clamp(overrides.randomness)
  return { ...scene, director }
}
