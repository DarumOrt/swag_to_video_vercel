/**
 * Export worker: renders with SceneRenderer on its own OffscreenCanvas and encodes, so the UI
 * thread stays free. Driven by `exportVideoInWorker` (workerClient.ts); one export per worker.
 */

import { SceneRenderer } from '@/render'
import { serveExport } from './workerHost'

serveExport(() => new SceneRenderer())
