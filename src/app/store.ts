import { create } from 'zustand'
import { DEFAULT_OUTPUT, type OutputSettings, type Timeline } from '@/shared'
import {
  DEFAULT_PRESET_ID,
  buildScene,
  presetDefaults,
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
  style: { presetId: string; values: ParamValues }
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
}

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
  style: { presetId: DEFAULT_PRESET_ID, values: presetDefaults(DEFAULT_PRESET_ID) },
  scene: buildScene(DEFAULT_PRESET_ID, presetDefaults(DEFAULT_PRESET_ID)),

  setTrack: (track) => set({ track }),
  setAnalysis: (status, error = null) => set({ analysis: { status, error } }),
  setTimeline: (timeline) => set({ timeline }),
  setOutput: (output) => set({ output }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setVolume: (volume) => set({ volume, muted: false }),
  setMuted: (muted) => set({ muted }),
  setExport: (patch) => set((state) => ({ export: { ...state.export, ...patch } })),
  setPreset: (presetId) => {
    const values = presetDefaults(presetId)
    set({ style: { presetId, values }, scene: buildScene(presetId, values) })
  },
  setStyleValue: (key, value) =>
    set((state) => {
      const values = { ...state.style.values, [key]: value }
      return {
        style: { ...state.style, values },
        scene: buildScene(state.style.presetId, values),
      }
    }),
}))
