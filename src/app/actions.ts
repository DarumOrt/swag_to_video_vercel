import {
  analyzeTrack,
  chooseSaveTarget,
  createRenderer,
  exportVideo,
  type SaveTarget,
} from './adapters'
import { resetLyricsEditor } from './lyricsActions'
import { playback } from './playback'
import { IDLE_EXPORT, useAppStore } from './store'

playback.bindPlayingState((playing) => useAppStore.getState().setPlaying(playing))

/** Bumped on every load so a slow analysis of an old file can't overwrite a newer one. */
let loadToken = 0

export async function loadTrack(file: File) {
  const token = ++loadToken
  const store = useAppStore.getState()
  cancelExport()
  resetLyricsEditor()
  if (store.track) URL.revokeObjectURL(store.track.url)

  const url = URL.createObjectURL(file)
  store.setTrack({ file, name: file.name, url, durationSec: null })
  store.setTimeline(null)
  store.setExport(IDLE_EXPORT)
  store.setAnalysis('decoding')

  playback
    .load(url)
    .then((durationSec) => {
      const track = useAppStore.getState().track
      if (token === loadToken && track) useAppStore.getState().setTrack({ ...track, durationSec })
    })
    .catch(() => {})

  try {
    const timeline = await analyzeTrack(file, (phase) => {
      if (token === loadToken) useAppStore.getState().setAnalysis(phase)
    })
    if (token !== loadToken) return
    useAppStore.getState().setTimeline(timeline)
    useAppStore.getState().setAnalysis('ready')
  } catch (error) {
    if (token !== loadToken) return
    console.error(error)
    useAppStore.getState().setAnalysis('error', error instanceof Error ? error.message : null)
  }
}

let exportAbort: AbortController | null = null

/** Call straight from the click handler: the save picker needs the user gesture. */
export async function startExport() {
  const { timeline, output, scene, track, setExport } = useAppStore.getState()
  if (!timeline || exportAbort) return
  const abort = (exportAbort = new AbortController())
  let target: SaveTarget
  try {
    target = await chooseSaveTarget(baseName(track?.name), output, timeline.audio.durationSec)
  } catch (error) {
    exportAbort = null
    // Closing the picker is not an error.
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      console.error(error)
      setExport({ status: 'error', progress: 0, error: errorText(error) })
    }
    return
  }
  playback.pause()
  setExport({ status: 'running', progress: 0, etaSec: null, error: null })
  let lastPushed = 0
  try {
    await exportVideo({
      timeline,
      scene,
      output,
      target,
      createRenderer,
      signal: abort.signal,
      onProgress: ({ fraction, etaSec }) => {
        // Throttle store writes to whole percents.
        if (fraction - lastPushed >= 0.01 || fraction === 1) {
          lastPushed = fraction
          setExport({ progress: fraction, etaSec })
        }
      },
    })
    setExport({ status: 'done', progress: 1 })
  } catch (error) {
    if (abort.signal.aborted) setExport({ status: 'cancelled' })
    else {
      console.error(error)
      setExport({ status: 'error', error: errorText(error) })
    }
  } finally {
    if (exportAbort === abort) exportAbort = null
  }
}

function errorText(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

export function cancelExport() {
  exportAbort?.abort()
  exportAbort = null
}

function baseName(name = 'video'): string {
  return name.replace(/\.[^.]+$/, '') || 'video'
}
