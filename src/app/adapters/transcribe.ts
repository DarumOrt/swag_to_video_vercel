/**
 * Lyrics recognition: `@/ml` Whisper on the track's PCM, resampled to 16 kHz mono.
 * In dev, `?fake-asr` in the URL switches to a fake recognizer (no model download).
 */
import { toMono16k } from '@/audio'
import type { RecognizedWord } from '@/lyrics'
import {
  deleteCachedModels,
  estimateModelDownload,
  listCachedModels,
  storageEstimate,
  transcribe as runWhisper,
  type DownloadEstimate,
  type TranscribeQuality,
} from '@/ml'
import type { Timeline } from '@/shared'
import { pcmFor } from './analysis'
import { transcribeFake } from './transcribe.fake'

export type { DownloadEstimate, TranscribeQuality }
export { MAX_QUALITY_WARNING } from '@/ml'

export type RecognizeLanguage = 'ru' | 'en' | 'auto'

export interface RecognizeProgress {
  stage: 'device' | 'load' | 'recognize'
  /** 0..1 within the stage. */
  fraction: number
  /** Device downgrade or memory warning from the ML module. */
  note: string | null
}

export interface TranscribeJob {
  file: File
  timeline: Timeline
  language: RecognizeLanguage
  quality: TranscribeQuality
  onProgress: (progress: RecognizeProgress) => void
  signal: AbortSignal
}

export const useFakeRecognizer =
  import.meta.env.DEV &&
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('fake-asr')

const QUALITIES: readonly TranscribeQuality[] = ['light', 'max']

/** Cache state of one quality variant: `totalBytes` is its size, `toDownloadBytes` what is missing. */
export type ModelStatuses = Record<TranscribeQuality, DownloadEstimate | null>

export interface ModelCacheInfo {
  /** Bytes the browser holds for downloaded models (what "clear" frees). */
  bytes: number
  files: number
  /** Browser storage usage/quota, when available. */
  storage: { usage: number; quota: number } | null
}

// Fake recognizer: an in-memory "cache" so the prompt and clearing can be tried without a download.
const FAKE_SIZES: Record<TranscribeQuality, number> = { light: 480 * 2 ** 20, max: 1_500 * 2 ** 20 }
let fakeCached: Record<TranscribeQuality, boolean> = { light: true, max: false }

function fakeEstimate(quality: TranscribeQuality): DownloadEstimate {
  const totalBytes = FAKE_SIZES[quality]
  return {
    model: 'fake' as DownloadEstimate['model'],
    device: 'wasm' as DownloadEstimate['device'],
    note: null,
    totalBytes,
    toDownloadBytes: fakeCached[quality] ? 0 : totalBytes,
  }
}

/** What a run of this quality would download; null when the estimate failed. */
export async function estimateDownload(
  quality: TranscribeQuality,
): Promise<DownloadEstimate | null> {
  return useFakeRecognizer ? fakeEstimate(quality) : estimateModelDownload(quality)
}

/** Cache state of every quality variant (a failed estimate gives null for that variant). */
export async function modelStatuses(): Promise<ModelStatuses> {
  const [light, max] = await Promise.all(
    QUALITIES.map((q) => estimateDownload(q).catch(() => null)),
  )
  return { light: light ?? null, max: max ?? null }
}

export async function modelCacheInfo(): Promise<ModelCacheInfo> {
  if (useFakeRecognizer) {
    const bytes = QUALITIES.reduce((sum, q) => sum + (fakeCached[q] ? FAKE_SIZES[q] : 0), 0)
    return { bytes, files: bytes ? 3 : 0, storage: null }
  }
  const [repos, storage] = await Promise.all([
    listCachedModels().catch(() => []),
    storageEstimate().catch(() => null),
  ])
  return {
    bytes: repos.reduce((sum, repo) => sum + repo.bytes, 0),
    files: repos.reduce((sum, repo) => sum + repo.files, 0),
    storage,
  }
}

/** Removes all cached model files. Returns the number of files removed. */
export async function clearModelCache(): Promise<number> {
  if (useFakeRecognizer) {
    fakeCached = { light: false, max: false }
    return 3
  }
  return deleteCachedModels()
}

export async function transcribe(job: TranscribeJob): Promise<RecognizedWord[]> {
  if (useFakeRecognizer) return transcribeFake(job)
  const pcm = pcmFor(job.timeline)
  if (!pcm) throw new Error('Нет аудиоданных трека')
  let note: string | null = null
  return runWhisper(toMono16k(pcm), {
    language: job.language,
    quality: job.quality,
    vocalActivity: job.timeline.audio.vocalActivity,
    signal: job.signal,
    onProgress: (progress) => {
      if (progress.stage === 'device') {
        note = progress.note
        job.onProgress({ stage: 'device', fraction: 0, note })
      } else if (progress.stage === 'load') {
        const fraction = progress.total > 0 ? progress.loaded / progress.total : 0
        job.onProgress({ stage: 'load', fraction, note })
      } else {
        const fraction = progress.totalSec > 0 ? progress.doneSec / progress.totalSec : 0
        job.onProgress({ stage: 'recognize', fraction, note })
      }
    },
  })
}
