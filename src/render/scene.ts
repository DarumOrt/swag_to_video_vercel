/**
 * Scene format — what `RendererInit.scene` contains. A scene is a seed, a safe-area mode and a
 * stack of layers drawn bottom to top. Layer specs may omit any field that has a default.
 */

import {
  CORRELATION_DEFAULTS,
  GONIOMETER_DEFAULTS,
  LEVEL_METERS_DEFAULTS,
  OSCILLOSCOPE_DEFAULTS,
  SPECTROGRAM_DEFAULTS,
  SPECTRUM_BARS_DEFAULTS,
  SPECTRUM_CURVE_DEFAULTS,
  WAVEFORM_DEFAULTS,
  type CorrelationSpec,
  type GoniometerSpec,
  type LevelMetersSpec,
  type OscilloscopeSpec,
  type SpectrogramSpec,
  type SpectrumBarsSpec,
  type SpectrumCurveSpec,
  type WaveformSpec,
} from '@/visualizers'
import { normalizeDirector, type DirectorInput, type DirectorSpec } from './director'
import type { EffectSpec } from './effectsHost'
import type { SafeAreaMode } from './layout'
import { BACKGROUND_DEFAULTS, type BackgroundSpec } from './layers/background'
import { FULLTEXT_DEFAULTS, type FulltextSpec } from './layers/fulltext'
import { KINETIC_DEFAULTS, type KineticSpec } from './layers/kinetic'
import { LYRICS_DEFAULTS, type LyricsSpec } from './layers/lyrics'
import { NOISE_DEFAULTS, type NoiseSpec } from './layers/noise'
import { TEXT_DEFAULTS, type TextSpec } from './layers/text'

export const SCENE_VERSION = 1

export type LayerSpec =
  | BackgroundSpec
  | NoiseSpec
  | SpectrumBarsSpec
  | SpectrumCurveSpec
  | SpectrogramSpec
  | OscilloscopeSpec
  | GoniometerSpec
  | LevelMetersSpec
  | CorrelationSpec
  | WaveformSpec
  | TextSpec
  | LyricsSpec
  | KineticSpec
  | FulltextSpec
export type LayerType = LayerSpec['type']

export interface Scene {
  version: typeof SCENE_VERSION
  /** Base seed for all seeded randomness in the scene. */
  seed: number
  safeArea: SafeAreaMode
  /** Bottom to top. */
  layers: LayerSpec[]
  /** Effects (camera, overlays, post passes) in application order; created by `@/effects`. */
  effects: EffectSpec[]
  /** Section-by-section direction (director.ts); null / missing = the scene as authored. */
  director?: DirectorSpec | null
}

/** Scene as authored: layer fields with defaults are optional. */
export interface SceneInput {
  version?: typeof SCENE_VERSION
  seed?: number
  safeArea?: SafeAreaMode
  layers: LayerSpecInput[]
  effects?: EffectSpec[]
  director?: DirectorInput | null
}

type Partialize<T extends LayerSpec> = T extends LayerSpec
  ? Partial<Omit<T, 'id' | 'type'>> & Pick<T, 'id' | 'type'>
  : never
export type LayerSpecInput = Partialize<LayerSpec> | (Partialize<TextSpec> & { text: string })

const LAYER_DEFAULTS: { [K in LayerType]: object } = {
  background: BACKGROUND_DEFAULTS,
  'spectrum-bars': SPECTRUM_BARS_DEFAULTS,
  text: { ...TEXT_DEFAULTS, text: '' },
  lyrics: LYRICS_DEFAULTS,
  noise: NOISE_DEFAULTS,
  'spectrum-curve': SPECTRUM_CURVE_DEFAULTS,
  spectrogram: SPECTROGRAM_DEFAULTS,
  oscilloscope: OSCILLOSCOPE_DEFAULTS,
  goniometer: GONIOMETER_DEFAULTS,
  'level-meters': LEVEL_METERS_DEFAULTS,
  correlation: CORRELATION_DEFAULTS,
  waveform: WAVEFORM_DEFAULTS,
  kinetic: KINETIC_DEFAULTS,
  fulltext: FULLTEXT_DEFAULTS,
}

/** Defaults of a layer type (for UIs that add layers). */
export function layerDefaults(type: LayerType): object {
  return structuredClone(LAYER_DEFAULTS[type])
}

/**
 * Validate and fill defaults. `null`/`undefined` → `createDefaultScene()`.
 * Throws on unknown layer types and duplicate ids.
 */
export function normalizeScene(input: unknown): Scene {
  if (input === null || input === undefined) return createDefaultScene()
  if (typeof input !== 'object' || !Array.isArray((input as SceneInput).layers)) {
    throw new Error('Scene must be an object with a `layers` array')
  }
  const src = input as SceneInput
  const ids = new Set<string>()
  const layers = src.layers.map((layer, i) => {
    const defaults = LAYER_DEFAULTS[layer.type as LayerType] as object | undefined
    if (!defaults) throw new Error(`Unknown layer type "${String(layer.type)}" at index ${i}`)
    if (!layer.id) throw new Error(`Layer at index ${i} has no id`)
    if (ids.has(layer.id)) throw new Error(`Duplicate layer id "${layer.id}"`)
    ids.add(layer.id)
    return { ...structuredClone(defaults), ...layer } as LayerSpec
  })
  const effectIds = new Set<string>()
  const effects = (src.effects ?? []).map((e, i) => {
    if (!e || typeof e.type !== 'string') throw new Error(`Effect at index ${i} has no type`)
    if (!e.id) throw new Error(`Effect at index ${i} has no id`)
    if (effectIds.has(e.id)) throw new Error(`Duplicate effect id "${e.id}"`)
    effectIds.add(e.id)
    return structuredClone(e)
  })
  return {
    version: SCENE_VERSION,
    seed: src.seed ?? 1,
    safeArea: src.safeArea ?? 'social',
    layers,
    effects,
    director: normalizeDirector(src.director),
  }
}

/** Default scene: gradient background, spectrum bars, title, lyrics (drawn when the timeline has them). */
export function createDefaultScene(title = 'SwagToVideo'): Scene {
  return normalizeScene({
    layers: [
      { id: 'bg', type: 'background' },
      { id: 'spectrum', type: 'spectrum-bars' },
      { id: 'title', type: 'text', text: title },
      { id: 'lyrics', type: 'lyrics' },
    ],
  })
}
