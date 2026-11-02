/**
 * Seams between the app shell and the feature modules (`@/audio`, `@/render`, `@/export`, …).
 * Components import from here only, so module APIs can change without touching them.
 */
import { SceneRenderer } from '@/render'
import type { FrameRenderer } from '@/shared'

export type { Scene } from '@/render'
export { clearOpfsExports, type SaveTarget } from '@/export'
export { analyzeTrack, patchTimeline, withLyrics, type AnalysisPhase } from './analysis'
export {
  MAX_QUALITY_WARNING,
  estimateDownload,
  transcribe,
  useFakeRecognizer,
  type DownloadEstimate,
  type RecognizeLanguage,
  type RecognizeProgress,
  type TranscribeJob,
  type TranscribeQuality,
} from './transcribe'
export { chooseSaveTarget, exportVideo, type ExportedFile, type ExportJob } from './exporter'
export {
  defaultValues,
  resolveValues,
  type ParamSchema,
  type ParamValue,
  type ParamValues,
} from './params'
// Stubs until @/render ships presets and @/effects ships effect schemas.
export {
  DEFAULT_PRESET_ID,
  STYLE_PRESETS,
  buildScene,
  findPreset,
  presetDefaults,
  type StylePreset,
} from './style.stub'
export { ACCENT_EFFECTS, effectInfo, type AccentEffectInfo } from './effects.stub'

export function createRenderer(): FrameRenderer {
  return new SceneRenderer()
}
