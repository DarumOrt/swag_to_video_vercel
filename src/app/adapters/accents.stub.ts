/**
 * STUBS until `@/effects` (effect list + param schemas) and `@/lyrics` `suggestAccents` ship.
 * Shapes are what the UI expects; swap the implementations in `adapters/index.ts`.
 */
import { flattenWords, normalizeWord } from '@/lyrics'
import type { Accent, AccentEffectId, AudioAnalysis, Lyrics } from '@/shared'
import type { ParamSchema } from './params'

export interface AccentEffectInfo {
  id: AccentEffectId
  name: string
  /** Defaults for a new accent with this effect. */
  preRollSec: number
  durationSec: number
  intensity: number
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
    preRollSec: 0.05,
    durationSec: 0.35,
    intensity: 0.7,
    params: zoomParams,
  },
  { id: 'shake', name: 'Тряска', preRollSec: 0, durationSec: 0.4, intensity: 0.6, params: [] },
  {
    id: 'glitch',
    name: 'Глитч',
    preRollSec: 0.03,
    durationSec: 0.3,
    intensity: 0.7,
    params: glitchParams,
  },
  {
    id: 'flash',
    name: 'Вспышка',
    preRollSec: 0,
    durationSec: 0.25,
    intensity: 0.8,
    params: colorParams,
  },
  {
    id: 'palette-shift',
    name: 'Смена палитры',
    preRollSec: 0,
    durationSec: 0.8,
    intensity: 0.6,
    params: [],
  },
  {
    id: 'particle-burst',
    name: 'Взрыв частиц',
    preRollSec: 0,
    durationSec: 0.9,
    intensity: 0.7,
    params: colorParams,
  },
  {
    id: 'fullscreen-word',
    name: 'Слово на весь экран',
    preRollSec: 0.05,
    durationSec: 0.6,
    intensity: 1,
    params: [],
  },
  {
    id: 'slow-motion',
    name: 'Замедление',
    preRollSec: 0.1,
    durationSec: 0.8,
    intensity: 0.5,
    params: [],
  },
  { id: 'invert', name: 'Инверсия', preRollSec: 0, durationSec: 0.15, intensity: 1, params: [] },
]

export function effectInfo(id: AccentEffectId): AccentEffectInfo {
  return ACCENT_EFFECTS.find((effect) => effect.id === id) ?? ACCENT_EFFECTS[0]!
}

/**
 * Suggests accents: long words that start right on a strong beat, at most one per line, spaced out.
 * Returns accents with `source: 'auto'`.
 */
export function suggestAccents(lyrics: Lyrics, audio: AudioAnalysis): Accent[] {
  const beats = audio.rhythm.downbeats.length ? audio.rhythm.downbeats : audio.rhythm.beats
  const rotation: AccentEffectId[] = ['zoom-punch', 'flash', 'glitch', 'shake']
  const accents: Accent[] = []
  let lastLine = -1
  let lastTime = -Infinity
  for (const { word, lineIndex } of flattenWords(lyrics)) {
    if (word.start === null || lineIndex === lastLine || word.start - lastTime < 4) continue
    if (normalizeWord(word.text).length < 4) continue
    if (!nearAny(beats, word.start, 0.12)) continue
    const effect = effectInfo(rotation[accents.length % rotation.length]!)
    accents.push({
      id: `auto-${word.id}`,
      wordId: word.id,
      effect: effect.id,
      source: 'auto',
      preRollSec: effect.preRollSec,
      durationSec: effect.durationSec,
      intensity: effect.intensity,
      params: {},
    })
    lastLine = lineIndex
    lastTime = word.start
  }
  return accents
}

function nearAny(times: ArrayLike<number>, t: number, window: number): boolean {
  for (let i = 0; i < times.length; i++) if (Math.abs(times[i]! - t) <= window) return true
  return false
}
