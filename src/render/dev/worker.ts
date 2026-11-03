/** Dev worker: renders one frame on an OffscreenCanvas and returns its pixel hash. */

import type { FrameRate } from '@/shared'
import { SceneRenderer } from '../SceneRenderer'
import { devEffectFactory, devScene, devTimeline, hashPixels, type DevSceneOptions } from './common'

export interface WorkerRequest {
  width: number
  height: number
  fps: FrameRate
  scene: DevSceneOptions
  frameIndex: number
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { width, height, fps, scene, frameIndex } = e.data
  const canvas = new OffscreenCanvas(width, height)
  const renderer = new SceneRenderer({ willReadFrequently: true, createEffect: devEffectFactory })
  await renderer.init({
    canvas,
    width,
    height,
    fps,
    timeline: devTimeline(scene),
    scene: devScene(scene),
  })
  const t0 = performance.now()
  renderer.renderFrame(frameIndex)
  const ms = performance.now() - t0
  const g = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  const hash = hashPixels(g.getImageData(0, 0, width, height).data)
  renderer.dispose()
  self.postMessage({ hash, ms })
}
