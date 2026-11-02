import { create } from 'zustand'
import type { RecognizedWord, TapMode, TapSession } from '@/lyrics'
import type {
  ModelStatuses,
  RecognizeLanguage,
  RecognizeProgress,
  TranscribeQuality,
} from './adapters'

/**
 * Editor state around the lyrics. The lyrics themselves live in `timeline.lyrics` (app store),
 * so the preview always renders what the editor shows.
 */

export type RecognizeStatus = 'idle' | 'running' | 'done' | 'error'

/** Where the current lyrics came from: decides what "Распознать" does with them. */
export type LyricsOrigin = 'recognized' | 'text' | 'lrc'

export interface LyricsEditorState {
  recognized: RecognizedWord[] | null
  recognize: {
    status: RecognizeStatus
    stage: RecognizeProgress['stage'] | null
    /** 0..1 within the stage. */
    progress: number
    note: string | null
    error: string | null
  }
  /** Settings window shown before every recognition: quality, language, model cache state. */
  prompt: {
    quality: TranscribeQuality
    language: RecognizeLanguage
    /** null while the cache is being checked. */
    statuses: ModelStatuses | null
    /** Bytes that "clear the cache" would free; null while unknown. */
    cacheBytes: number | null
    /** The user asked to clear the cache and has to confirm. */
    confirmClear: boolean
    clearing: boolean
    /** The result would replace/re-align existing lyrics and has to be confirmed. */
    confirmReplace: boolean
  } | null
  origin: LyricsOrigin | null
  /** The user changed recognized words by hand (edit, delete, tap sync). */
  edited: boolean
  /** Result of the last alignment to recognized words. */
  alignStats: { anchored: number; total: number } | null
  pasteOpen: boolean
  selectedWordId: string | null
  tapMode: TapMode
  tap: TapSession | null
  /** One-off message (e.g. a failed LRC import). */
  notice: { kind: 'info' | 'error'; text: string } | null
}

export const IDLE_RECOGNIZE: LyricsEditorState['recognize'] = {
  status: 'idle',
  stage: null,
  progress: 0,
  note: null,
  error: null,
}

export const INITIAL_LYRICS_EDITOR: LyricsEditorState = {
  recognized: null,
  recognize: IDLE_RECOGNIZE,
  prompt: null,
  origin: null,
  edited: false,
  alignStats: null,
  pasteOpen: false,
  selectedWordId: null,
  tapMode: 'line',
  tap: null,
  notice: null,
}

export const useLyricsStore = create<LyricsEditorState>()(() => INITIAL_LYRICS_EDITOR)
