/**
 * Public API of the effects module: accent effects on words, rhythm reaction, overlays and WebGL2
 * post passes. Owned by the "Эффекты и пост-обработка" session — see docs/sessions/effects.md.
 *
 * The render engine picks up `createEffect` (see `src/render/effectsHost.ts`). Everything is
 * deterministic and touches no window/document on import, so it also runs in the export worker.
 */

// Engine entry point and scene effect types
export {
  createEffect,
  EFFECT_TYPES,
  effectFontFamilies,
  isEffectType,
  styleEffects,
  type EffectHook,
  type EffectType,
  type EffectTypeInfo,
} from './host'

// Accents
export {
  ACCENT_EFFECT_ORDER,
  ACCENT_EFFECTS,
  getAccentEffect,
  type AccentContext,
  type AccentEffectDef,
} from './accents'
export {
  evaluateAccents,
  prepareAccents,
  type AccentsOptions,
  type PreparedAccents,
} from './evaluate'
export {
  accentWindow,
  envelopeAt,
  isActive,
  windowProgress,
  type AccentWindow,
  type EnvelopeShape,
} from './envelope'
export type { CurveId } from './math'
export {
  IDENTITY_CAMERA,
  NEUTRAL_POST,
  PARTICLE_STRIDE,
  type AccentFrame,
  type ActiveAccentInfo,
  type CameraTransform,
  type FlashOverlay,
  type OverlayItem,
  type ParticleOverlay,
  type PostDynamics,
  type WordOverlay,
} from './types'

// Rhythm
export {
  applyBeatCamera,
  BEAT_CAMERA_PARAMS,
  BEAT_FLASH_PARAMS,
  beatAt,
  beatFlash,
  beatPulse,
  dropAmountAt,
  type BeatState,
} from './rhythm'

// Params (auto UI)
export {
  defaultParams,
  resolveParam,
  resolveParams,
  type LocalizedText,
  type ParamSpec,
  type ParamValue,
  type ParamValues,
} from './params'

// Style presets
export {
  EFFECT_STYLE_ORDER,
  EFFECT_STYLES,
  type EffectStyleId,
  type EffectStylePreset,
  type StyleEffect,
} from './presets'

// Drawing and post
export { DEFAULT_OVERLAY_OPTIONS, drawOverlays, type OverlayOptions, type Viewport } from './overlay'
export {
  POST_EFFECTS,
  QUALITY_PROFILES,
  type PostEffectType,
  type PostQuality,
} from './post/settings'
