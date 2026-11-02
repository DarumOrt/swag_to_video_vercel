/**
 * Worker side of `exportVideoInWorker`: receives a job, runs `exportVideo` with a renderer created
 * inside the worker, reports progress and the result. Shared by the production worker
 * (SceneRenderer) and dev workers with test renderers.
 */

import type { FrameRenderer } from '@/shared'
import { exportVideo, type ExportProgress, type ExportResult } from './exportVideo'
import type { WorkerExportJob } from './workerProtocol'

export type WorkerRequest = { type: 'start'; job: WorkerExportJob } | { type: 'cancel' }

export type WorkerResponse =
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'done'; result: ExportResult }
  | { type: 'error'; name: string; message: string }

export function serveExport(createRenderer: () => FrameRenderer): void {
  const abort = new AbortController()
  const post = (message: WorkerResponse) => self.postMessage(message)

  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const message = event.data
    if (message.type === 'cancel') {
      abort.abort()
      return
    }
    try {
      const result = await exportVideo({
        ...message.job,
        renderer: createRenderer(),
        signal: abort.signal,
        onProgress: (progress) => post({ type: 'progress', progress }),
      })
      post({ type: 'done', result })
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error'
      post({ type: 'error', name, message: error instanceof Error ? error.message : String(error) })
    }
  }
}
