/**
 * Static settings of the post chain (set by a style preset), plus their UI descriptions.
 * Per-frame changes come from `PostDynamics`.
 */

import type { LocalizedText, ParamSpec } from '../params'

export type PostQuality = 'low' | 'medium' | 'high'

export interface PostSettings {
  bloom: { intensity: number; threshold: number; radius: number }
  /** Chromatic aberration toward the edges, fraction of the width. */
  chroma: { amount: number }
  grain: { amount: number; size: number }
  vhs: { scanlines: number; density: number; wobble: number; noise: number }
  vignette: { amount: number; softness: number }
  color: {
    /** Stops. */
    exposure: number
    contrast: number
    saturation: number
    /** -1 cool … 1 warm. */
    temperature: number
    /** -1 green … 1 magenta. */
    tint: number
    /** Lift of the blacks, 0..0.2 (faded film look). */
    lift: number
    /** Split toning: shadows / highlights tint colors (hex) and amount. */
    shadowTint: string
    highlightTint: string
    toning: number
  }
}

export const NEUTRAL_POST_SETTINGS: PostSettings = {
  bloom: { intensity: 0, threshold: 0.7, radius: 0.5 },
  chroma: { amount: 0 },
  grain: { amount: 0, size: 1.5 },
  vhs: { scanlines: 0, density: 1, wobble: 0, noise: 0 },
  vignette: { amount: 0, softness: 0.5 },
  color: {
    exposure: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    lift: 0,
    shadowTint: '#000000',
    highlightTint: '#ffffff',
    toning: 0,
  },
}

/** Fills missing groups / fields from the neutral settings. */
export function normalizePostSettings(input: DeepPartial<PostSettings> | undefined): PostSettings {
  const n = NEUTRAL_POST_SETTINGS
  const i = input ?? {}
  return {
    bloom: { ...n.bloom, ...i.bloom },
    chroma: { ...n.chroma, ...i.chroma },
    grain: { ...n.grain, ...i.grain },
    vhs: { ...n.vhs, ...i.vhs },
    vignette: { ...n.vignette, ...i.vignette },
    color: { ...n.color, ...i.color },
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] }

/** Internal resolution / tap counts per quality level. */
export interface QualityProfile {
  /** Bloom buffer size as a fraction of the frame. */
  bloomScale: number
  /** Blur iterations (each one a horizontal + vertical pass). */
  bloomIterations: number
}

export const QUALITY_PROFILES: Readonly<Record<PostQuality, QualityProfile>> = {
  low: { bloomScale: 0.125, bloomIterations: 2 },
  medium: { bloomScale: 0.25, bloomIterations: 3 },
  high: { bloomScale: 0.5, bloomIterations: 4 },
}

const l = (ru: string, en: string): LocalizedText => ({ ru, en })
const num = (
  key: string,
  label: LocalizedText,
  min: number,
  max: number,
  step: number,
  def: number,
): ParamSpec => ({ key, type: 'number', label, min, max, step, default: def })

/** UI groups; keys are `group.field`, e.g. 'bloom.intensity'. Defaults are neutral (effect off). */
export const POST_PARAM_GROUPS: { group: keyof PostSettings; label: LocalizedText; params: ParamSpec[] }[] = [
  {
    group: 'bloom',
    label: l('Свечение', 'Bloom'),
    params: [
      num('bloom.intensity', l('Сила', 'Intensity'), 0, 3, 0.01, 0),
      num('bloom.threshold', l('Порог', 'Threshold'), 0, 1, 0.01, 0.7),
      num('bloom.radius', l('Радиус', 'Radius'), 0, 1, 0.01, 0.5),
    ],
  },
  {
    group: 'chroma',
    label: l('Хроматическая аберрация', 'Chromatic aberration'),
    params: [num('chroma.amount', l('Сила', 'Amount'), 0, 0.02, 0.0005, 0)],
  },
  {
    group: 'grain',
    label: l('Плёночное зерно', 'Film grain'),
    params: [
      num('grain.amount', l('Сила', 'Amount'), 0, 0.4, 0.005, 0),
      num('grain.size', l('Размер', 'Size'), 1, 4, 0.1, 1.5),
    ],
  },
  {
    group: 'vhs',
    label: l('VHS и скан-линии', 'VHS & scanlines'),
    params: [
      num('vhs.scanlines', l('Скан-линии', 'Scanlines'), 0, 1, 0.01, 0),
      num('vhs.density', l('Плотность линий', 'Line density'), 0.25, 3, 0.05, 1),
      num('vhs.wobble', l('Дрожание', 'Wobble'), 0, 1, 0.01, 0),
      num('vhs.noise', l('Помехи', 'Noise'), 0, 1, 0.01, 0),
    ],
  },
  {
    group: 'vignette',
    label: l('Виньетка', 'Vignette'),
    params: [
      num('vignette.amount', l('Сила', 'Amount'), 0, 1, 0.01, 0),
      num('vignette.softness', l('Мягкость', 'Softness'), 0.05, 1, 0.01, 0.5),
    ],
  },
  {
    group: 'color',
    label: l('Цветокоррекция', 'Color grading'),
    params: [
      num('color.exposure', l('Экспозиция', 'Exposure'), -2, 2, 0.01, 0),
      num('color.contrast', l('Контраст', 'Contrast'), 0.5, 2, 0.01, 1),
      num('color.saturation', l('Насыщенность', 'Saturation'), 0, 2, 0.01, 1),
      num('color.temperature', l('Температура', 'Temperature'), -1, 1, 0.01, 0),
      num('color.tint', l('Оттенок', 'Tint'), -1, 1, 0.01, 0),
      num('color.lift', l('Подъём теней', 'Lift'), 0, 0.2, 0.005, 0),
      { key: 'color.shadowTint', type: 'color', label: l('Тон теней', 'Shadow tint'), default: '#000000' },
      { key: 'color.highlightTint', type: 'color', label: l('Тон светов', 'Highlight tint'), default: '#ffffff' },
      num('color.toning', l('Сила тонирования', 'Toning'), 0, 1, 0.01, 0),
    ],
  },
]

/** Reads `group.field` from settings (for UI binding). */
export function getPostValue(s: PostSettings, key: string): number | string | undefined {
  const [group, field] = key.split('.') as [keyof PostSettings, string]
  const g = s[group] as Record<string, number | string> | undefined
  return g?.[field]
}

/** Returns a copy with `group.field` set. */
export function setPostValue(s: PostSettings, key: string, value: number | string): PostSettings {
  const [group, field] = key.split('.') as [keyof PostSettings, string]
  if (!(group in s) || field === undefined) return s
  return { ...s, [group]: { ...s[group], [field]: value } }
}
