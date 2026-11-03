/**
 * Effect parts of the four style presets: which scene effects run, with which params, and
 * style-specific defaults for accent params. The render session's visual presets (background,
 * visualizers, fonts) take `styleEffects(id)` from `host.ts` as their `scene.effects`.
 *
 * The effects follow the song sections at render time (`sections.ts`): rhythm and post passes are
 * scaled by the section mood (`sectionReact` param), and `section-transitions` marks each boundary.
 */

import type { AccentEffectId } from '@/shared'
import type { LocalizedText, ParamValues } from './params'

export type EffectStyleId = 'studio' | 'neon' | 'minimal' | 'grunge'

/** Effect types as in `host.ts` (kept as strings here to avoid a cycle). */
export interface StyleEffect {
  type: string
  params: ParamValues
}

export interface EffectStylePreset {
  id: EffectStyleId
  label: LocalizedText
  description: LocalizedText
  /** Application order; post passes run in this order too. */
  effects: StyleEffect[]
  /** Style-specific defaults for accent params (merged under each accent's own params). */
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
    effects: [
      { type: 'accents', params: { style: 'studio', font: 'grotesk' } },
      { type: 'beat-camera', params: { amount: 0.012, shake: 0.002, sway: 0.002 } },
      { type: 'section-transitions', params: { kinds: 'clean', amount: 0.6, color: '#cfe8ff' } },
      { type: 'bloom', params: { strength: 0.35, threshold: 0.75, radius: 0.35, beatPulse: 0.3 } },
      { type: 'color-grade', params: { contrast: 1.06, saturation: 1.02 } },
      { type: 'vignette', params: { amount: 0.35, softness: 0.6 } },
      { type: 'grain', params: { amount: 0.02, size: 1.2 } },
    ],
    accentParams: {
      'zoom-punch': { zoom: 0.1 },
      flash: { opacity: 0.45, color: '#cfe8ff' },
      'particle-burst': { shape: 'dot', color: '#9fd3ff', color2: '#ffffff', count: 90 },
    },
    suggestedAccents: ['zoom-punch', 'flash', 'fullscreen-word', 'camera-orbit', 'mono'],
  },
  neon: {
    id: 'neon',
    label: { ru: 'Неон и свечение', en: 'Neon glow' },
    description: {
      ru: 'Сильное свечение, насыщенные цвета, вспышки на сильных долях',
      en: 'Heavy bloom, saturated colors, flashes on strong beats',
    },
    effects: [
      { type: 'accents', params: { style: 'neon', font: 'display' } },
      { type: 'beat-camera', params: { amount: 0.03 } },
      { type: 'beat-flash', params: { amount: 0.1, color: '#ff4fd8', threshold: 0.85 } },
      { type: 'section-transitions', params: { kinds: 'auto', amount: 0.85, color: '#ff4fd8' } },
      // Text must stay readable at the beat peak: strength × (1 + beatPulse) stays near 1.
      { type: 'bloom', params: { strength: 0.8, threshold: 0.6, radius: 0.6, beatPulse: 0.35 } },
      { type: 'chromatic-aberration', params: { amount: 0.0025, beatPulse: 0.002 } },
      {
        type: 'color-grade',
        params: {
          contrast: 1.12,
          saturation: 1.3,
          temperature: -0.1,
          tint: 0.12,
          shadowTint: '#2a0a5e',
          highlightTint: '#ff6ad5',
          toning: 0.25,
        },
      },
      { type: 'vignette', params: { amount: 0.5, softness: 0.55 } },
      { type: 'grain', params: { amount: 0.025, size: 1.4 } },
    ],
    accentParams: {
      flash: { color: '#ff4fd8', blend: 'screen' },
      'particle-burst': { color: '#3df5ff', color2: '#ff4fd8', glow: true },
      'fullscreen-word': { color: '#3df5ff', outline: true },
      'palette-shift': { hue: 150 },
    },
    suggestedAccents: ['flash', 'particle-burst', 'palette-shift', 'zoom-punch', 'mirror', 'strobe'],
  },
  minimal: {
    id: 'minimal',
    label: { ru: 'Минималистичная типографика', en: 'Minimal typography' },
    description: {
      ru: 'Почти без пост-обработки, акцент на слове и движении текста',
      en: 'Almost no post, focus on the word and its motion',
    },
    effects: [
      { type: 'accents', params: { style: 'minimal', font: 'grotesk', fontWeight: 900 } },
      { type: 'beat-camera', params: { amount: 0.006, shake: 0, sway: 0.0015, dropBoost: 1.3, sectionReact: 0.7 } },
      { type: 'section-transitions', params: { kinds: 'zoom', amount: 0.5, durationSec: 0.5 } },
      { type: 'color-grade', params: { contrast: 1.04, saturation: 0.9, lift: 0.01, sectionReact: 0.6 } },
      { type: 'grain', params: { amount: 0.015, size: 1 } },
    ],
    accentParams: {
      'fullscreen-word': { dim: 0.85, motion: 'slide', outline: false },
      'zoom-punch': { zoom: 0.06 },
      flash: { opacity: 0.3 },
      'particle-burst': { shape: 'square', count: 40, color: '#ffffff', color2: '#ffffff', glow: false },
    },
    suggestedAccents: ['fullscreen-word', 'zoom-punch', 'slow-motion', 'mono'],
  },
  grunge: {
    id: 'grunge',
    label: { ru: 'Гранж и глитч', en: 'Grunge & glitch' },
    description: {
      ru: 'Плёночное зерно, VHS-линии, аберрация, жёсткие удары',
      en: 'Film grain, VHS lines, aberration, hard hits',
    },
    effects: [
      { type: 'accents', params: { style: 'grunge', font: 'condensed', fontWeight: 700 } },
      { type: 'beat-camera', params: { amount: 0.02, shake: 0.008, sway: 0.006, dropBoost: 2 } },
      { type: 'beat-flash', params: { amount: 0.12, color: '#fff4e0', threshold: 0.9 } },
      { type: 'section-transitions', params: { kinds: 'rough', amount: 1, color: '#fff4e0' } },
      { type: 'bloom', params: { strength: 0.4, threshold: 0.65, radius: 0.5, quality: 'low' } },
      { type: 'chromatic-aberration', params: { amount: 0.004, beatPulse: 0.004 } },
      {
        type: 'color-grade',
        params: {
          contrast: 1.2,
          saturation: 0.75,
          temperature: 0.12,
          lift: 0.04,
          shadowTint: '#1c2a1a',
          highlightTint: '#ffe2b0',
          toning: 0.3,
        },
      },
      { type: 'scanlines', params: { amount: 0.35, density: 1, wobble: 0.35, noise: 0.25 } },
      { type: 'vignette', params: { amount: 0.6, softness: 0.45 } },
      { type: 'grain', params: { amount: 0.12, size: 2 } },
    ],
    accentParams: {
      glitch: { rgbSplit: 0.025, slices: 0.8 },
      shake: { amplitude: 0.05 },
      flash: { color: '#fff4e0', blend: 'normal', opacity: 0.6 },
      'particle-burst': { shape: 'square', color: '#e8e2d0', color2: '#ff3b30' },
    },
    suggestedAccents: ['glitch', 'shake', 'invert', 'zoom-punch', 'vhs', 'rgb-split'],
  },
}

export const EFFECT_STYLE_ORDER: readonly EffectStyleId[] = ['studio', 'neon', 'minimal', 'grunge']
