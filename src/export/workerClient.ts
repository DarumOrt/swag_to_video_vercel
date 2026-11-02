/**
 * `exportVideoInWorker` — same contract as `exportVideo`, but rendering and encoding run in a
 * dedicated worker (SceneRenderer on an OffscreenCanvas), so the UI stays responsive.
 * The worker is terminated after every export (memory budget: one heavy stage at a time).
 */

import { mixdown, resample, toPcm, type PcmAudio } from './audio'
import type { WorkerRequest, WorkerResponse } from './workerHost'
import { ExportError, type ExportOptions, type ExportResult } from './exportVideo'
import { checkExportSupport, outputChannelCount } from './support'
import type { WorkerExportJob } from './workerProtocol'

export interface WorkerExportOptions extends Omit<ExportOptions, 'renderer' | 'writable'> {
  /** Dev/tests only: a worker that calls `serveExport` with another renderer. Default: SceneRenderer. */
  createWorker?: () => Worker
}

function createSceneWorker(): Worker {
  return new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })
}

export function canExportInWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

export async function exportVideoInWorker(options: WorkerExportOptions): Promise<ExportResult> {
  const { signal, onProgress } = options
  signal?.throwIfAborted()

  // Detection and resampling stay on the main thread: OfflineAudioContext (better resampler)
  // does not exist in workers.
  let pcm: PcmAudio | null = options.audio ? toPcm(options.audio) : null
  let config = options.config
  if (!config) {
    const support = await checkExportSupport(
      options.output,
      pcm ? { sampleRate: pcm.sampleRate, numberOfChannels: pcm.channels.length } : null,
      { preferHardware: options.preferHardware },
    )
    if (!support.ok) throw new ExportError(support.reason)
    config = support.config
  }
  if (pcm && config.audio) {
    pcm = mixdown(pcm, outputChannelCount(pcm.channels.length))
    pcm = await resample(pcm, config.audio.config.sampleRate)
  } else {
    pcm = null
  }
  signal?.throwIfAborted()

  const job: WorkerExportJob = {
    timeline: options.timeline,
    scene: options.scene,
    output: options.output,
    audio: pcm,
    durationSec: options.durationSec,
    file: options.file ?? null,
    config,
    preferHardware: options.preferHardware,
  }

  const worker = (options.createWorker ?? createSceneWorker)()
  const send = (message: WorkerRequest) => worker.postMessage(message)

  return new Promise<ExportResult>((resolve, reject) => {
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      settle()
    }
    const onAbort = () => {
      send({ type: 'cancel' })
      // The worker answers with an AbortError after cleaning up (aborting the file stream);
      // terminate anyway if it does not within a few seconds.
      setTimeout(
        () => finish(() => reject(new DOMException('Экспорт отменён', 'AbortError'))),
        5000,
      )
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') onProgress?.(message.progress)
      else if (message.type === 'done') finish(() => resolve(message.result))
      else {
        const error =
          message.name === 'AbortError'
            ? new DOMException(message.message, 'AbortError')
            : new ExportError(message.message)
        finish(() => reject(error))
      }
    }
    worker.onerror = (event) => {
      finish(() =>
        reject(new ExportError(`Воркер экспорта упал: ${event.message || 'ошибка загрузки'}`)),
      )
    }

    send({ type: 'start', job })
  })
}
