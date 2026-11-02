/**
 * Public API of the effects module: accent effects on words, rhythm reaction, overlays and the
 * WebGL2 post chain. Owned by the "Эффекты и пост-обработка" session — see docs/sessions/effects.md.
 *
 * Pure and deterministic: an EffectFrame depends only on (timeline, config, time). Nothing touches
 * window/document on import, everything works in a worker.
 */

// Per-frame evaluation
export {
  evaluateEffects,
  prepareEffects,
  resolveEffectsConfig,
  type EffectsConfig,
  type EffectsConfigInput,
  type PreparedEffects,
} from './evaluate'
export {
  IDENTITY_CAMERA,
  NEUTRAL_POST,
  PARTICLE_STRIDE,
  type ActiveAccentInfo,
  type CameraTransform,
  type EffectFrame,
  type FlashOverlay,
  type OverlayItem,
  type ParticleOverlay,
  type PostDynamics,
  type WordOverlay,
} from './types'

// Accents
export {
  ACCENT_EFFECT_ORDER,
  ACCENT_EFFECTS,
  getAccentEffect,
  type AccentContext,
  type AccentEffectDef,
} from './accents'
export {
  accentWindow,
  envelopeAt,
  isActive,
  windowProgress,
  type AccentWindow,
  type EnvelopeShape,
} from './envelope'
export type { CurveId } from './math'

// Rhythm
export {
  beatAt,
  dropAmountAt,
  DEFAULT_RHYTHM,
  RHYTHM_PARAM_SPECS,
  type BeatState,
  type RhythmSettings,
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
} from './presets'

// Drawing
export { cameraMatrix, coverZoom, isIdentityCamera, type Matrix2D, type Viewport } from './camera'
export { DEFAULT_OVERLAY_OPTIONS, drawOverlays, type OverlayOptions } from './overlay'
export { PostProcessor, isPostSupported, type PostProcessorOptions } from './post/PostProcessor'
export {
  getPostValue,
  NEUTRAL_POST_SETTINGS,
  normalizePostSettings,
  POST_PARAM_GROUPS,
  QUALITY_PROFILES,
  setPostValue,
  type PostQuality,
  type PostSettings,
} from './post/settings'
export { EffectsCompositor, type CompositorOptions } from './compositor'
