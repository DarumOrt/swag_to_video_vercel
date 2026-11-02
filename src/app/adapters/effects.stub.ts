/**
 * STUB until `@/effects` ships its effect list and param schemas. Shape is what the UI expects;
 * swap the implementation in `adapters/index.ts`. Effect timing defaults live in `@/lyrics`
 * (`EFFECT_DEFAULTS`), which places accents.
 */
import type { AccentEffectId } from '@/shared'
import type { ParamSchema } from './params'

export interface AccentEffectInfo {
  id: AccentEffectId
  name: string
  /** Effect-specific params (`Accent.params`). */
  params: readonly ParamSchema[]
}

const zoomParams: ParamSchema[] = [
  { key: 'scale', label: 'Масштаб', kind: 'range', min: 1, max: 1.6, step: 0.01, default: 1.15 },
]
const glitchParams: ParamSchema[] = [
  {
    key: 'split',
    label: 'Разведение RGB',
    kind: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  { key: 'slices', label: 'Полосы', kind: 'range', min: 2, max: 24, step: 1, default: 8 },
]
const colorParams: ParamSchema[] = [
  { key: 'color', label: 'Цвет', kind: 'color', default: '#ffffff' },
]

export const ACCENT_EFFECTS: readonly AccentEffectInfo[] = [
  {
    id: 'zoom-punch',
    name: 'Удар зумом',
    params: zoomParams,
  },
  { id: 'shake', name: 'Тряска', params: [] },
  {
    id: 'glitch',
    name: 'Глитч',
    params: glitchParams,
  },
  {
    id: 'flash',
    name: 'Вспышка',
    params: colorParams,
  },
  {
    id: 'palette-shift',
    name: 'Смена палитры',
    params: [],
  },
  {
    id: 'particle-burst',
    name: 'Взрыв частиц',
    params: colorParams,
  },
  {
    id: 'fullscreen-word',
    name: 'Слово на весь экран',
    params: [],
  },
  {
    id: 'slow-motion',
    name: 'Замедление',
    params: [],
  },
  { id: 'invert', name: 'Инверсия', params: [] },
]

export function effectInfo(id: AccentEffectId): AccentEffectInfo {
  return ACCENT_EFFECTS.find((effect) => effect.id === id) ?? ACCENT_EFFECTS[0]!
}
