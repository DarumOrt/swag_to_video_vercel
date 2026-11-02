import {
  ExportError,
  canExportInWorker,
  deliverExport,
  exportVideo as runExport,
  exportVideoInWorker,
  pickSaveTarget,
  type ExportOptions,
  type SaveTarget,
} from '@/export'
import type { FrameRenderer, OutputSettings, Timeline } from '@/shared'
import { pcmFor } from './analysis'

export interface ExportJob {
  timeline: Timeline
  scene: unknown
  output: OutputSettings
  /** From `chooseSaveTarget`, picked inside the click handler. */
  target: SaveTarget
  createRenderer: () => FrameRenderer
  /** fraction 0..1; etaSec is null until the speed is known. */
  onProgress: (progress: { fraction: number; etaSec: number | null }) => void
  signal: AbortSignal
}

export interface ExportedFile {
  /** File name the result was saved under. */
  name: string
}

/** ~4 min of 1080p: above this, ask for a file and stream straight into it. */
const PICKER_PIXEL_SECONDS = 1080 * 1920 * 240
/** Above ~1 min, write to disk (OPFS) instead of holding the whole file in RAM. */
const MEMORY_MAX_SEC = 60

/**
 * Where to save: long or 4K exports stream into a file the user picks; over a minute they go
 * to OPFS and are downloaded from disk; short ones are built in memory. Both fall back down the
 * chain when unsupported. MUST be the first await in the click handler: the picker needs the
 * user gesture. Rejects with AbortError if the user closes the picker.
 */
export function chooseSaveTarget(
  baseName: string,
  output: OutputSettings,
  durationSec: number,
): Promise<SaveTarget> {
  const heavy =
    output.width * output.height * durationSec > PICKER_PIXEL_SECONDS ||
    Math.min(output.width, output.height) >= 2160
  const prefer = heavy ? 'file' : durationSec > MEMORY_MAX_SEC ? 'opfs' : 'memory'
  return pickSaveTarget(baseName, output.container, { prefer })
}

/** Renders and encodes (in a worker when possible), then delivers the file. */
export async function exportVideo(job: ExportJob): Promise<ExportedFile> {
  const { timeline, output, target } = job
  const pcm = pcmFor(timeline)
  const options: Omit<ExportOptions, 'renderer'> = {
    timeline,
    scene: job.scene,
    output,
    audio: pcm ? { sampleRate: pcm.sampleRate, channels: pcm.channels } : null,
    durationSec: timeline.audio.durationSec,
    file: target.file,
    onProgress: ({ fraction, etaSec }) => job.onProgress({ fraction, etaSec }),
    signal: job.signal,
  }
  try {
    const inMainThread = () => runExport({ ...options, renderer: job.createRenderer() })
    let result
    if (!canExportInWorker()) result = await inMainThread()
    else {
      try {
        result = await exportVideoInWorker(options)
      } catch (error) {
        // The worker itself failed to start or crashed: retry once on the main thread.
        if (!isWorkerCrash(error) || job.signal.aborted) throw error
        console.warn('[export] worker failed, retrying on the main thread:', error)
        result = await inMainThread()
      }
    }
    await deliverExport(target, result.blob)
    return { name: target.name }
  } catch (error) {
    // Drop a half-written OPFS file; deliverExport cleans it up itself on success.
    await target.cleanup()
    throw error
  }
}

function isWorkerCrash(error: unknown): boolean {
  return error instanceof ExportError && error.message.startsWith('Воркер экспорта упал')
}
