import { create } from 'zustand'
import { DEFAULT_OUTPUT, type OutputSettings, type Timeline } from '@/shared'
import {
  DEFAULT_PRESET_ID,
  buildScene,
  presetDefaults,
  type DirectorOverrides,
  type ParamValues,
  type Scene,
} from './adapters'

/**
 * Low-frequency app state. High-frequency values (playhead, audio frames) live in `playback.ts`
 * and are pushed to the DOM/canvas imperatively, bypassing React renders.
 */

export interface TrackInfo {
  file: File
  name: string
  /** Object URL for the <audio> element; revoked when the track is replaced. */
  url: string
  durationSec: number | null
}

export type AnalysisStatus = 'idle' | 'decoding' | 'analyzing' | 'ready' | 'error'

export type ExportStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

export interface ExportState {
  status: ExportStatus
  /** 0..1 */
  progress: number
  /** Seconds left, null until the encoder speed is known. */
  etaSec: number | null
  error: string | null
}

export interface AppState {
  track: TrackInfo | null
  analysis: { status: AnalysisStatus; error: string | null }
  timeline: Timeline | null
  output: OutputSettings
  isPlaying: boolean
  volume: number
  muted: boolean
  export: ExportState
  /** Selected style preset and its values. */
  style: { presetId: string; values: ParamValues; seed: number; director: DirectorOverrides }
  /** Built from `style`; the same object goes to the preview and to export. */
  scene: Scene

  setTrack: (track: TrackInfo | null) => void
  setAnalysis: (status: AnalysisStatus, error?: string | null) => void
  setTimeline: (timeline: Timeline | null) => void
  setOutput: (output: OutputSettings) => void
  setPlaying: (isPlaying: boolean) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  setExport: (patch: Partial<ExportState>) => void
  /** Switches preset; values reset to its defaults. */
  setPreset: (presetId: string) => void
  setStyleValue: (key: string, value: ParamValues[string]) => void
  /** New scene seed (the director picks other layouts, camera and transitions). */
  setSeed: (seed: number) => void
  /** Random seed different from the current one. */
  shuffleSeed: () => void
  setDirector: (change: DirectorOverrides) => void
}

export const DEFAULT_SEED = 1

export const IDLE_EXPORT: ExportState = { status: 'idle', progress: 0, etaSec: null, error: null }

export const useAppStore = create<AppState>()((set) => ({
  track: null,
  analysis: { status: 'idle', error: null },
  timeline: null,
  output: DEFAULT_OUTPUT,
  isPlaying: false,
  volume: 0.8,
  muted: false,
  export: IDLE_EXPORT,
  style: {
    presetId: DEFAULT_PRESET_ID,
    values: presetDefaults(DEFAULT_PRESET_ID),
    seed: DEFAULT_SEED,
    director: {},
  },
  scene: buildScene(DEFAULT_PRESET_ID, presetDefaults(DEFAULT_PRESET_ID)),

  setTrack: (track) => set({ track }),
  setAnalysis: (status, error = null) => set({ analysis: { status, error } }),
  setTimeline: (timeline) => set({ timeline }),
  setOutput: (output) => set({ output }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setVolume: (volume) => set({ volume, muted: false }),
  setMuted: (muted) => set({ muted }),
  setExport: (patch) => set((state) => ({ export: { ...state.export, ...patch } })),
  setPreset: (presetId) =>
    set((state) => {
      const values = presetDefaults(presetId)
      const style = { presetId, values, seed: state.style.seed, director: {} }
      return { style, scene: sceneOf(style) }
    }),
  setStyleValue: (key, value) =>
    set((state) => {
      const style = { ...state.style, values: { ...state.style.values, [key]: value } }
      return { style, scene: sceneOf(style) }
    }),
  setSeed: (seed) =>
    set((state) => {
      const style = { ...state.style, seed }
      return { style, scene: sceneOf(style) }
    }),
  shuffleSeed: () =>
    set((state) => {
      let seed = state.style.seed
      while (seed === state.style.seed) seed = 1 + Math.floor(Math.random() * 99_999)
      const style = { ...state.style, seed }
      return { style, scene: sceneOf(style) }
    }),
  setDirector: (change) =>
    set((state) => {
      const style = { ...state.style, director: { ...state.style.director, ...change } }
      return { style, scene: sceneOf(style) }
    }),
}))

function sceneOf(style: AppState['style']): Scene {
  return buildScene(style.presetId, style.values, { seed: style.seed, director: style.director })
}
