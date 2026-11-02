import {
  DEFAULT_SNAP,
  alignLyrics,
  applyTaps,
  lyricsFromRecognized,
  parseLrc,
  parseLyricsText,
  recordRelease,
  recordTap,
  snapToOnsets,
  startTapSession,
  toLrc,
  undoTap,
  type RecognizedWord,
  type TapMode,
} from '@/lyrics'
import type { Lyrics } from '@/shared'
import {
  clearModelCache,
  modelCacheInfo,
  modelStatuses,
  transcribe,
  withLyrics,
  type RecognizeLanguage,
  type TranscribeQuality,
} from './adapters'
import { t } from './i18n'
import { carryUserTimings, deleteWord, editWord, type WordPatch } from './lyricsEdit'
import {
  IDLE_RECOGNIZE,
  INITIAL_LYRICS_EDITOR,
  useLyricsStore,
  type LyricsOrigin,
} from './lyricsStore'
import { playback } from './playback'
import { useAppStore } from './store'

const patch = useLyricsStore.setState

function currentLyrics(): Lyrics | null {
  return useAppStore.getState().timeline?.lyrics ?? null
}

/** Puts lyrics into a new Timeline object so the preview and export pick them up. */
function commitLyrics(lyrics: Lyrics | null, origin?: LyricsOrigin | null) {
  const { timeline, setTimeline } = useAppStore.getState()
  if (!timeline) return
  setTimeline(withLyrics(timeline, lyrics))
  if (origin !== undefined) patch({ origin })
  if (origin === 'recognized') patch({ edited: false })
}

function vocalOnsets(): ArrayLike<number> {
  return useAppStore.getState().timeline?.audio.rhythm.vocalOnsets ?? []
}

/** Called when a new track is loaded: the old lyrics and recognition no longer apply. */
export function resetLyricsEditor() {
  abortRecognition()
  useLyricsStore.setState(INITIAL_LYRICS_EDITOR)
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

let recognizeAbort: AbortController | null = null

function abortRecognition() {
  recognizeAbort?.abort()
  recognizeAbort = null
}

/** Whether starting recognition now would overwrite or re-align work the user already did. */
export function recognitionNeedsConfirm(): boolean {
  if (!currentLyrics()) return false
  const { origin, edited } = useLyricsStore.getState()
  return origin !== 'recognized' || edited
}

/**
 * "Распознать" / "Распознать заново": always opens the settings window with the cache state of
 * each quality variant, even when the model is cached. Recognition starts on the user's click.
 */
export async function requestRecognition() {
  if (recognizeAbort || useLyricsStore.getState().prompt) return
  patch({
    prompt: {
      quality: 'light',
      language: 'auto',
      statuses: null,
      cacheBytes: null,
      confirmClear: false,
      clearing: false,
      confirmReplace: false,
    },
    notice: null,
  })
  await refreshModelState()
}

/** Re-reads cache state for the open window (after opening and after clearing). */
async function refreshModelState() {
  const [statuses, info] = await Promise.all([modelStatuses(), modelCacheInfo().catch(() => null)])
  const prompt = useLyricsStore.getState().prompt
  if (!prompt) return
  const cachedEstimate = Math.max(
    0,
    ...Object.values(statuses).map((e) => (e ? e.totalBytes - e.toDownloadBytes : 0)),
  )
  patch({
    prompt: {
      ...prompt,
      statuses,
      cacheBytes: info ? Math.max(info.bytes, cachedEstimate) : cachedEstimate,
    },
  })
}

export function setRecognizeQuality(quality: TranscribeQuality) {
  const prompt = useLyricsStore.getState().prompt
  if (prompt) patch({ prompt: { ...prompt, quality, confirmReplace: false } })
}

export function setRecognizeLanguage(language: RecognizeLanguage) {
  const prompt = useLyricsStore.getState().prompt
  if (prompt) patch({ prompt: { ...prompt, language, confirmReplace: false } })
}

/** First click asks for confirmation when lyrics would be replaced; the second one starts. */
export function confirmRecognition() {
  const prompt = useLyricsStore.getState().prompt
  if (!prompt || prompt.clearing || recognizeAbort) return
  if (recognitionNeedsConfirm() && !prompt.confirmReplace) {
    patch({ prompt: { ...prompt, confirmReplace: true } })
    return
  }
  patch({ prompt: null })
  void recognizeLyrics(prompt.quality, prompt.language)
}

export function dismissRecognitionPrompt() {
  patch({ prompt: null })
}

export function askClearModelCache(ask: boolean) {
  const prompt = useLyricsStore.getState().prompt
  if (prompt && !prompt.clearing) patch({ prompt: { ...prompt, confirmClear: ask } })
}

/** Deletes cached model files. Refused while recognition is running (the model is in use). */
export async function confirmClearModelCache() {
  const prompt = useLyricsStore.getState().prompt
  if (!prompt || prompt.clearing || recognizeAbort) return
  patch({ prompt: { ...prompt, clearing: true } })
  try {
    await clearModelCache()
  } catch (error) {
    console.error(error)
    patch({ notice: { kind: 'error', text: t.lyrics.prompt.clearFailed } })
  }
  const current = useLyricsStore.getState().prompt
  if (current) patch({ prompt: { ...current, clearing: false, confirmClear: false } })
  await refreshModelState()
}

async function recognizeLyrics(quality: TranscribeQuality, language: RecognizeLanguage) {
  const { timeline, track } = useAppStore.getState()
  if (!timeline || !track || recognizeAbort) return
  const abort = (recognizeAbort = new AbortController())
  playback.pause()
  patch({ recognize: { ...IDLE_RECOGNIZE, status: 'running' }, notice: null })
  try {
    const words = await transcribe({
      file: track.file,
      timeline,
      language,
      quality,
      signal: abort.signal,
      onProgress: ({ stage, fraction, note }) =>
        patch((state) => ({
          recognize: { ...state.recognize, stage, progress: fraction, note },
        })),
    })
    if (abort.signal.aborted) return
    patch({ recognized: words, recognize: { ...IDLE_RECOGNIZE, status: 'done', progress: 1 } })
    if (!words.length) {
      patch({ notice: { kind: 'info', text: t.lyrics.recognizeNothing } })
      return
    }
    const lyrics = currentLyrics()
    const origin = useLyricsStore.getState().origin
    // User text wins: align it to what was heard. Otherwise show what was heard.
    if (lyrics && origin !== 'recognized') alignAndCommit(lyrics, words)
    else {
      commitLyrics(lyricsFromRecognized(words), 'recognized')
      patch({ alignStats: null })
    }
  } catch (error) {
    if (abort.signal.aborted) {
      patch({ recognize: IDLE_RECOGNIZE })
      return
    }
    console.error(error)
    patch({
      recognize: {
        ...IDLE_RECOGNIZE,
        status: 'error',
        error: error instanceof Error ? error.message : null,
      },
    })
  } finally {
    if (recognizeAbort === abort) recognizeAbort = null
  }
}

export function cancelRecognition() {
  abortRecognition()
}

function alignAndCommit(lyrics: Lyrics, recognized: readonly RecognizedWord[]) {
  const duration = useAppStore.getState().timeline?.audio.durationSec ?? null
  const result = alignLyrics(lyrics, recognized, { keepUserTimings: true, durationSec: duration })
  commitLyrics(snapToOnsets(result.lyrics, vocalOnsets()))
  patch({ alignStats: { anchored: result.anchoredCount, total: result.wordCount } })
}

/** Re-runs alignment of the current lyrics (keeps manual and tapped timings). */
export function realignLyrics() {
  const lyrics = currentLyrics()
  const recognized = useLyricsStore.getState().recognized
  if (lyrics && recognized) alignAndCommit(lyrics, recognized)
}

// ---------------------------------------------------------------------------
// Pasted text and LRC
// ---------------------------------------------------------------------------

export function setPasteOpen(pasteOpen: boolean) {
  patch({ pasteOpen, notice: null })
}

/**
 * Replaces the lyrics with pasted text. Words and lines come from the text; timings come from
 * recognition when there is one, and user-made timings of unchanged lines are kept.
 */
export function applyPastedText(text: string) {
  const parsed = parseLyricsText(text)
  if (!parsed.lines.length) {
    patch({ notice: { kind: 'error', text: t.lyrics.pasteEmpty } })
    return
  }
  const previous = currentLyrics()
  const lyrics = carryUserTimings(previous, parsed)
  const recognized = useLyricsStore.getState().recognized
  patch({ pasteOpen: false, selectedWordId: null, origin: 'text', alignStats: null })
  if (recognized) alignAndCommit(lyrics, recognized)
  else commitLyrics(lyrics, 'text')
}

export function importLrc(text: string) {
  const { lyrics } = parseLrc(text)
  if (!lyrics.lines.length) {
    patch({ notice: { kind: 'error', text: t.lyrics.lrcEmpty } })
    return
  }
  commitLyrics(lyrics, 'lrc')
  patch({ selectedWordId: null, alignStats: null, notice: null })
}

export function exportLrc(): string | null {
  const lyrics = currentLyrics()
  return lyrics ? toLrc(lyrics, { enhanced: true, includeSections: true }) : null
}

export function clearLyrics() {
  stopTapSync(false)
  commitLyrics(null, null)
  patch({ edited: false, selectedWordId: null, alignStats: null, notice: null })
}

// ---------------------------------------------------------------------------
// Word edits
// ---------------------------------------------------------------------------

export function selectWord(wordId: string | null) {
  patch({ selectedWordId: wordId })
}

export function updateWord(wordId: string, change: WordPatch) {
  const lyrics = currentLyrics()
  if (!lyrics) return
  commitLyrics(editWord(lyrics, wordId, change))
  patch({ edited: true })
}

export function removeWord(wordId: string) {
  const lyrics = currentLyrics()
  if (!lyrics) return
  commitLyrics(deleteWord(lyrics, wordId))
  patch({ selectedWordId: null, edited: true })
}

// ---------------------------------------------------------------------------
// Tap sync
// ---------------------------------------------------------------------------

export function setTapMode(tapMode: TapMode) {
  patch({ tapMode })
}

/** Starts tap sync from the first line/word and plays the track from the top. */
export function startTapSync() {
  const lyrics = currentLyrics()
  if (!lyrics) return
  const { tapMode } = useLyricsStore.getState()
  patch({ tap: startTapSession(lyrics, tapMode), selectedWordId: null, notice: null })
  playback.seek(0)
  void playback.play()
}

export function tapDown() {
  const session = useLyricsStore.getState().tap
  if (session) patch({ tap: recordTap(session, playback.time) })
}

export function tapUp() {
  const session = useLyricsStore.getState().tap
  if (session) patch({ tap: recordRelease(session, playback.time) })
}

export function tapUndo() {
  const session = useLyricsStore.getState().tap
  if (!session?.taps.length) return
  const last = session.taps.at(-1)!
  patch({ tap: undoTap(session) })
  // Step back a little before the undone tap so it can be retaken.
  playback.seek(Math.max(0, last.time - 2))
}

/** Ends tap sync; with `apply`, writes the taps and pulls them onto vocal onsets (magnet). */
export function stopTapSync(apply = true) {
  const session = useLyricsStore.getState().tap
  if (!session) return
  patch({ tap: null })
  playback.pause()
  const lyrics = currentLyrics()
  if (!apply || !lyrics || !session.taps.length) return
  const tapped = applyTaps(lyrics, session)
  const snapped = snapToOnsets(tapped, vocalOnsets(), {
    sources: [...DEFAULT_SNAP.sources, 'tap'],
  })
  commitLyrics(snapped)
  patch({ edited: true, notice: { kind: 'info', text: t.lyrics.tapApplied(session.taps.length) } })
}
