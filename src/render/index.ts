/**
 * Public API of the render module.
 * Owned by the "Рендер-движок и визуализация" session — see docs/sessions/render-engine.md.
 */

export { SceneRenderer, type SceneRendererOptions } from './SceneRenderer'
export {
  createDefaultScene,
  layerDefaults,
  normalizeScene,
  SCENE_VERSION,
  type LayerSpec,
  type LayerSpecInput,
  type LayerType,
  type Scene,
  type SceneInput,
} from './scene'
export type { BackgroundFill, BackgroundSpec, ColorStop } from './layers/background'
export { DEFAULT_FONT_FAMILY, type TextSpec } from './layers/text'
export { LYRICS_DEFAULTS, type LyricsSpec } from './layers/lyrics'
export { EMBEDDED_FONTS, FONT_FAMILY, fontStack, loadEmbeddedFonts } from './fonts'
export {
  computeLayout,
  resolveRect,
  safeAreaInsets,
  type Layout,
  type PixelRect,
  type RectSpace,
  type RectSpec,
  type SafeAreaMode,
} from './layout'
export { layerMotionAt, sectionLevel, type LayerMotion, type MotionState } from './motion'
export type { BandReaction, Ctx2D, FrameContext, Layer, LayerSpecBase } from './types'
export { emptyFrameWords, type FrameWords, type WordBox, type WordPlacement } from './words'

/** Synthetic timeline for dev pages and tests (also used by export). */
export { createFakeTimeline, type FakeTimelineOptions } from './dev/fakeTimeline'

// Effects extension points (implemented in `@/effects`)
export {
  applyCamera,
  IDENTITY_CAMERA,
  type CameraTransform,
  type Effect,
  type EffectFactory,
  type EffectSpec,
  type PostIO,
  type PostKit,
  type PostPass,
  type RenderTarget,
  type ShaderProgram,
  type TimeWarpInfo,
} from './effectsHost'
export { beatAt, sectionAt, type BeatInfo } from './rhythm'

// Layers added in milestone 3
export { KINETIC_DEFAULTS, type KineticSpec } from './layers/kinetic'
export { NOISE_DEFAULTS, type NoiseSpec } from './layers/noise'

// Style presets and parameter schemas (auto UI)
export {
  buildPresetScene,
  DEFAULT_STYLE_PRESET,
  getStylePreset,
  presetDefaults,
  STYLE_PRESETS,
  type StylePreset,
  type StylePresetId,
} from './styles/presets'
export { LAYER_SCHEMAS, type LayerSchema } from './styles/layerSchemas'
export {
  defaultParams,
  FONT_OPTIONS,
  resolveParams,
  type LocalizedText,
  type ParamSpec,
  type ParamValue,
  type ParamValues,
} from './styles/params'

// Milestone 4: the director (section-by-section story, seeded "edit") and full-screen text
export {
  Director,
  DIRECTOR_DEFAULTS,
  layerGroup,
  normalizeDirector,
  ROLE_SHOTS,
  TRANSITION_KINDS,
  type DirectorInput,
  type DirectorSpec,
  type LayerGroup,
  type ShotCamera,
  type ShotSpec,
  type ShotState,
  type TransitionKind,
} from './director'
export {
  FULLTEXT_DEFAULTS,
  FULLTEXT_MODES,
  type FulltextMode,
  type FulltextSpec,
} from './layers/fulltext'
export { cameraScale } from './effectsHost'
export type { EffectStyleRef } from './styles/presets'
