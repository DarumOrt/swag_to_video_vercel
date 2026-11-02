/**
 * Effect parts of the four style presets. The render session's visual presets (background,
 * visualizers, fonts) reference one of these by id; the UI may override any field.
 */

import type { AccentEffectId } from '@/shared'
import type { LocalizedText, ParamValues } from './params'
import { normalizePostSettings, type PostSettings } from './post/settings'
import { DEFAULT_RHYTHM, type RhythmSettings } from './rhythm'

export type EffectStyleId = 'studio' | 'neon' | 'minimal' | 'grunge'

export interface EffectStylePreset {
  id: EffectStyleId
  label: LocalizedText
  description: LocalizedText
  post: PostSettings
  rhythm: RhythmSettings
  /** Style-specific defaults for accent params (merged under the accent's own params). */
  accentParams: Partial<Record<AccentEffectId, ParamValues>>
  /** Effects suggested for auto-placed accents in this style, most typical first. */
  suggestedAccents: AccentEffectId[]
}

export const EFFECT_STYLES: Readonly<Record<EffectStyleId, EffectStylePreset>> = {
  studio: {
    id: 'studio',
    label: { ru: 'Студийные измерители', en: 'Studio meters' },
    description: {
      ru: 'Чистый «приборный» вид: лёгкое свечение, точные удары камеры',
      en: 'Clean meter look: subtle glow, precise camera hits',
    },
    post: normalizePostSettings({
      bloom: { intensity: 0.35, threshold: 0.75, radius: 0.35 },
      vignette: { amount: 0.35, softness: 0.6 },
      grain: { amount: 0.02, size: 1.2 },
      color: { contrast: 1.06, saturation: 1.02 },
    }),
    rhythm: { ...DEFAULT_RHYTHM, zoom: 0.012, shake: 0.002, sway: 0.002, bloomPulse: 0.2, chromaPulse: 0 },
    accentParams: {
      'zoom-punch': { zoom: 0.1 },
      flash: { opacity: 0.45, color: '#cfe8ff' },
      'particle-burst': { shape: 'dot', color: '#9fd3ff', color2: '#ffffff', count: 90 },
    },
    suggestedAccents: ['zoom-punch', 'flash', 'fullscreen-word'],
  },
  neon: {
    id: 'neon',
    label: { ru: 'Неон и свечение', en: 'Neon glow' },
    description: {
      ru: 'Сильное свечение, насыщенные цвета, вспышки на сильных долях',
      en: 'Heavy bloom, saturated colors, flashes on strong beats',
    },
    post: normalizePostSettings({
      bloom: { intensity: 1.4, threshold: 0.45, radius: 0.75 },
      chroma: { amount: 0.0025 },
      vignette: { amount: 0.5, softness: 0.55 },
      grain: { amount: 0.025, size: 1.4 },
      color: {
        contrast: 1.12,
        saturation: 1.3,
        temperature: -0.1,
        tint: 0.12,
        shadowTint: '#2a0a5e',
        highlightTint: '#ff6ad5',
        toning: 0.25,
      },
    }),
    rhythm: { ...DEFAULT_RHYTHM, zoom: 0.03, flash: 0.22, flashColor: '#ff4fd8', bloomPulse: 0.8, chromaPulse: 0.002 },
    accentParams: {
      flash: { color: '#ff4fd8', blend: 'screen' },
      'particle-burst': { color: '#3df5ff', color2: '#ff4fd8', glow: true },
      'fullscreen-word': { color: '#3df5ff', outline: true },
      'palette-shift': { hue: 150 },
    },
    suggestedAccents: ['flash', 'particle-burst', 'palette-shift', 'zoom-punch'],
  },
  minimal: {
    id: 'minimal',
    label: { ru: 'Минималистичная типографика', en: 'Minimal typography' },
    description: {
      ru: 'Почти без пост-обработки, акцент на слове и движении текста',
      en: 'Almost no post, focus on the word and its motion',
    },
    post: normalizePostSettings({
      grain: { amount: 0.015, size: 1 },
      color: { contrast: 1.04, saturation: 0.9, lift: 0.01 },
    }),
    rhythm: { ...DEFAULT_RHYTHM, zoom: 0.006, shake: 0, sway: 0.0015, bloomPulse: 0, chromaPulse: 0, dropBoost: 1.3 },
    accentParams: {
      'fullscreen-word': { dim: 0.85, motion: 'slide', outline: false },
      'zoom-punch': { zoom: 0.06 },
      flash: { opacity: 0.3 },
      'particle-burst': { shape: 'square', count: 40, color: '#ffffff', color2: '#ffffff', glow: false },
    },
    suggestedAccents: ['fullscreen-word', 'zoom-punch', 'slow-motion'],
  },
  grunge: {
    id: 'grunge',
    label: { ru: 'Гранж и глитч', en: 'Grunge & glitch' },
    description: {
      ru: 'Плёночное зерно, VHS-линии, аберрация, жёсткие удары',
      en: 'Film grain, VHS lines, aberration, hard hits',
    },
    post: normalizePostSettings({
      bloom: { intensity: 0.4, threshold: 0.65, radius: 0.5 },
      chroma: { amount: 0.004 },
      grain: { amount: 0.12, size: 2 },
      vhs: { scanlines: 0.35, density: 1, wobble: 0.35, noise: 0.25 },
      vignette: { amount: 0.6, softness: 0.45 },
      color: {
        contrast: 1.2,
        saturation: 0.75,
        temperature: 0.12,
        lift: 0.04,
        shadowTint: '#1c2a1a',
        highlightTint: '#ffe2b0',
        toning: 0.3,
      },
    }),
    rhythm: { ...DEFAULT_RHYTHM, zoom: 0.02, shake: 0.008, sway: 0.006, flash: 0.12, chromaPulse: 0.004, dropBoost: 2 },
    accentParams: {
      glitch: { rgbSplit: 0.025, slices: 0.8 },
      shake: { amplitude: 0.05 },
      flash: { color: '#fff4e0', blend: 'normal', opacity: 0.6 },
      'particle-burst': { shape: 'square', color: '#e8e2d0', color2: '#ff3b30' },
    },
    suggestedAccents: ['glitch', 'shake', 'invert', 'zoom-punch'],
  },
}

export const EFFECT_STYLE_ORDER: readonly EffectStyleId[] = ['studio', 'neon', 'minimal', 'grunge']
