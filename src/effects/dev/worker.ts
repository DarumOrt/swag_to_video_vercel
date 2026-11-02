/** Dev worker: renders one frame with effects on an OffscreenCanvas and returns its pixel hash. */

import { loadEmbeddedFonts, SceneRenderer } from '@/render'
import type { FrameRate } from '@/shared'
import { devScene, devTimeline, hashPixels, type DevState } from './common'

export interface WorkerRequest {
  state: DevState
  width: number
  height: number
  fps: FrameRate
  frameIndex: number
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { state, width, height, fps, frameIndex } = e.data
  await loadEmbeddedFonts()
  const canvas = new OffscreenCanvas(width, height)
  const renderer = new SceneRenderer({ willReadFrequently: true })
  await renderer.init({ canvas, width, height, fps, timeline: devTimeline(state), scene: devScene(state) })
  const t0 = performance.now()
  renderer.renderFrame(frameIndex)
  const ms = performance.now() - t0
  const g = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  const hash = hashPixels(g.getImageData(0, 0, width, height).data)
  renderer.dispose()
  self.postMessage({ hash, ms })
}
