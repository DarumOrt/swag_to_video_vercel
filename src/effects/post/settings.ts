/**
 * Parameter descriptions of the WebGL2 post effects (one scene effect = one pass) and the
 * quality profiles of the heavier passes.
 */

import type { LocalizedText, ParamSpec } from '../params'
import { SECTION_REACT_PARAM } from '../sections'

export type PostQuality = 'low' | 'medium' | 'high'

export type PostEffectType =
  | 'bloom'
  | 'chromatic-aberration'
  | 'color-grade'
  | 'vignette'
  | 'scanlines'
  | 'grain'

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
const n = (key: string, label: LocalizedText, min: number, max: number, step: number, def: number): ParamSpec => ({
  key,
  type: 'number',
  label,
  min,
  max,
  step,
  default: def,
})
const beatPulseParam = (max: number, step: number): ParamSpec => ({
  ...n('beatPulse', l('Пульс на битах', 'Beat pulse'), 0, max, step, 0),
  hint: l('Насколько эффект усиливается на долях', 'How much the effect kicks on beats'),
})

export const POST_EFFECTS: Readonly<
  Record<PostEffectType, { label: LocalizedText; description: LocalizedText; params: ParamSpec[] }>
> = {
  bloom: {
    label: l('Свечение', 'Bloom'),
    description: l('Яркие места светятся', 'Bright areas glow'),
    params: [
      n('strength', l('Сила', 'Strength'), 0, 3, 0.01, 0.6),
      n('threshold', l('Порог', 'Threshold'), 0, 1, 0.01, 0.6),
      n('radius', l('Радиус', 'Radius'), 0, 1, 0.01, 0.5),
      beatPulseParam(2, 0.05),
      SECTION_REACT_PARAM,
      {
        key: 'quality',
        type: 'enum',
        label: l('Качество', 'Quality'),
        options: [
          { value: 'low', label: l('Низкое', 'Low') },
          { value: 'medium', label: l('Среднее', 'Medium') },
          { value: 'high', label: l('Высокое', 'High') },
        ],
        default: 'medium',
      },
    ],
  },
  'chromatic-aberration': {
    label: l('Хроматическая аберрация', 'Chromatic aberration'),
    description: l('Цветные края к краям кадра', 'Color fringes toward the frame edges'),
    params: [
      n('amount', l('Сила', 'Amount'), 0, 0.02, 0.0005, 0.003),
      beatPulseParam(0.01, 0.0005),
      SECTION_REACT_PARAM,
    ],
  },
  'color-grade': {
    label: l('Цветокоррекция', 'Color grading'),
    description: l('Экспозиция, контраст, баланс, тонирование', 'Exposure, contrast, balance, toning'),
    params: [
      n('exposure', l('Экспозиция', 'Exposure'), -2, 2, 0.01, 0),
      n('contrast', l('Контраст', 'Contrast'), 0.5, 2, 0.01, 1),
      n('saturation', l('Насыщенность', 'Saturation'), 0, 2, 0.01, 1),
      n('temperature', l('Температура', 'Temperature'), -1, 1, 0.01, 0),
      n('tint', l('Оттенок', 'Tint'), -1, 1, 0.01, 0),
      n('lift', l('Подъём теней', 'Lift'), 0, 0.2, 0.005, 0),
      { key: 'shadowTint', type: 'color', label: l('Тон теней', 'Shadow tint'), default: '#000000' },
      { key: 'highlightTint', type: 'color', label: l('Тон светов', 'Highlight tint'), default: '#ffffff' },
      n('toning', l('Сила тонирования', 'Toning'), 0, 1, 0.01, 0),
      SECTION_REACT_PARAM,
    ],
  },
  vignette: {
    label: l('Виньетка', 'Vignette'),
    description: l('Затемнение к углам', 'Darkens the corners'),
    params: [
      n('amount', l('Сила', 'Amount'), 0, 1, 0.01, 0.4),
      n('softness', l('Мягкость', 'Softness'), 0.05, 1, 0.01, 0.5),
      SECTION_REACT_PARAM,
    ],
  },
  scanlines: {
    label: l('VHS и скан-линии', 'VHS & scanlines'),
    description: l('Строки развёртки, дрожание, помехи', 'Scanlines, tracking wobble, noise'),
    params: [
      n('amount', l('Скан-линии', 'Scanlines'), 0, 1, 0.01, 0.3),
      n('density', l('Плотность', 'Density'), 0.25, 3, 0.05, 1),
      n('wobble', l('Дрожание', 'Wobble'), 0, 1, 0.01, 0),
      n('noise', l('Помехи', 'Noise'), 0, 1, 0.01, 0),
      SECTION_REACT_PARAM,
    ],
  },
  grain: {
    label: l('Плёночное зерно', 'Film grain'),
    description: l('Зерно, меняется каждый кадр', 'Grain that changes every frame'),
    params: [
      n('amount', l('Сила', 'Amount'), 0, 0.4, 0.005, 0.05),
      n('size', l('Размер', 'Size'), 1, 4, 0.1, 1.5),
      SECTION_REACT_PARAM,
    ],
  },
}
