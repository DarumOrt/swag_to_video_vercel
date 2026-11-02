/**
 * Dev page dev/render.html: realtime preview (requestAnimationFrame → renderFrame(N)),
 * format / fps switch, fps counter, determinism checks (main thread and OffscreenCanvas worker).
 * Wall-clock time is used only here, to pick which frame to show — never inside the renderer.
 */

import { frameCountFor, type FrameRate } from '@/shared'
import { safeAreaInsets } from '../layout'
import { SceneRenderer } from '../SceneRenderer'
import { createFakeTimeline } from './fakeTimeline'
import { DEV_DURATION_SEC, devEffectFactory, devScene, hashPixels, type DevSceneOptions } from './common'
import type { WorkerRequest } from './worker'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('canvas')
const formatSel = $<HTMLSelectElement>('format')
const fpsSel = $<HTMLSelectElement>('fps')
const titleInput = $<HTMLInputElement>('title')
const safeToggle = $<HTMLInputElement>('safeToggle')
const fxToggle = $<HTMLInputElement>('fxToggle')
const safeBox = $<HTMLDivElement>('safe')
const playBtn = $<HTMLButtonElement>('play')
const scrub = $<HTMLInputElement>('scrub')
const stats = $<HTMLParagraphElement>('stats')
const logEl = $<HTMLDivElement>('log')

const timeline = createFakeTimeline({ durationSec: DEV_DURATION_SEC })
const renderer = new SceneRenderer({ createEffect: devEffectFactory })
const sceneOptions = (): DevSceneOptions => ({ title: titleInput.value, demoEffects: fxToggle.checked })

let width = 1080
let height = 1920
let fps: FrameRate = 60
let frameCount = 1
let playing = true
let anchorWall = 0
let anchorFrame = 0
let currentFrame = 0
let lastDrawn = -1

// Stats over the last second.
let statWindowStart = performance.now()
let drawsInWindow = 0
let renderMsInWindow = 0
let worstMsInWindow = 0

function log(msg: string) {
  logEl.textContent = `${msg}\n${logEl.textContent ?? ''}`
}

async function setup() {
  const [w, h] = formatSel.value.split('x').map(Number)
  width = w ?? 1080
  height = h ?? 1920
  fps = Number(fpsSel.value) as FrameRate
  frameCount = frameCountFor(timeline.audio.durationSec, fps)
  const keepTime = currentFrame / Math.max(fps, 1)
  await renderer.init({
    canvas,
    width,
    height,
    fps,
    timeline,
    scene: devScene(sceneOptions()),
  })
  scrub.max = String(frameCount - 1)
  currentFrame = Math.min(Math.floor(keepTime * fps), frameCount - 1)
  anchorFrame = currentFrame
  anchorWall = performance.now()
  lastDrawn = -1
  updateSafeBox()
}

function updateSafeBox() {
  safeBox.style.display = safeToggle.checked ? 'block' : 'none'
  const i = safeAreaInsets(width, height, 'social')
  safeBox.style.left = `${i.left * 100}%`
  safeBox.style.top = `${i.top * 100}%`
  safeBox.style.right = `${i.right * 100}%`
  safeBox.style.bottom = `${i.bottom * 100}%`
}

function tick(now: number) {
  if (playing) {
    const elapsed = Math.floor(((now - anchorWall) / 1000) * fps)
    currentFrame = (anchorFrame + elapsed) % frameCount
  }
  if (currentFrame !== lastDrawn) {
    const t0 = performance.now()
    renderer.renderFrame(currentFrame)
    const ms = performance.now() - t0
    lastDrawn = currentFrame
    drawsInWindow++
    renderMsInWindow += ms
    worstMsInWindow = Math.max(worstMsInWindow, ms)
    if (playing) scrub.value = String(currentFrame)
  }
  if (now - statWindowStart >= 1000) {
    const secs = (now - statWindowStart) / 1000
    const avg = drawsInWindow ? renderMsInWindow / drawsInWindow : 0
    stats.textContent =
      `${(drawsInWindow / secs).toFixed(1)} кадр/с (цель ${playing ? fps : 0}) · ` +
      `renderFrame: ср. ${avg.toFixed(2)} мс, макс. ${worstMsInWindow.toFixed(2)} мс · ` +
      `кадр ${currentFrame}/${frameCount - 1} · ${width}×${height}`
    statWindowStart = now
    drawsInWindow = 0
    renderMsInWindow = 0
    worstMsInWindow = 0
  }
  requestAnimationFrame(tick)
}

/**
 * Pixel hashes are taken from separate canvases so the preview canvas stays on the GPU.
 * Chrome moves a canvas to the CPU rasterizer after the first getImageData, and GPU vs CPU
 * anti-aliasing differs — so each comparison below uses one backend on both sides.
 */
async function hashFrames(frames: number[], cpu: boolean): Promise<string[]> {
  const c = document.createElement('canvas')
  const r = new SceneRenderer({ willReadFrequently: cpu, createEffect: devEffectFactory })
  await r.init({ canvas: c, width, height, fps, timeline, scene: devScene(sceneOptions()) })
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const hashes = frames.map((f) => {
    r.renderFrame(f)
    return hashPixels(g.getImageData(0, 0, width, height).data)
  })
  r.dispose()
  return hashes
}

async function checkDeterminism() {
  const n = currentFrame
  const other = (n + Math.floor(frameCount / 3)) % frameCount
  const [a, b, c] = await hashFrames([n, other, n], true)
  log(
    `CPU: кадр ${n} → ${a}, кадр ${other} → ${b}, снова кадр ${n} → ${c} · ` +
      (a === c ? 'OK, совпадает' : 'ОШИБКА: кадры различаются'),
  )
  // GPU: a canvas can be read only once before Chrome demotes it, so use two fresh canvases.
  const [g1] = await hashFrames([n], false)
  const [g2] = await hashFrames([n], false)
  log(
    `GPU: кадр ${n} в двух свежих канвасах → ${g1} / ${g2} · ` +
      (g1 === g2 ? 'OK, совпадает' : 'ОШИБКА: кадры различаются'),
  )
}

async function checkWorker() {
  const n = currentFrame
  const [mainHash] = await hashFrames([n], true)
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const req: WorkerRequest = { width, height, fps, scene: sceneOptions(), frameIndex: n }
  worker.onmessage = (e: MessageEvent<{ hash: string; ms: number }>) => {
    const { hash, ms } = e.data
    log(
      `Воркер (OffscreenCanvas, CPU): кадр ${n} → ${hash} за ${ms.toFixed(2)} мс, ` +
        `основной поток (CPU) → ${mainHash} · ` +
        (hash === mainHash ? 'OK, совпадает' : 'различается'),
    )
    worker.terminate()
  }
  worker.onerror = (e) => {
    log(`Воркер: ошибка ${e.message}`)
    worker.terminate()
  }
  worker.postMessage(req)
}

formatSel.onchange = fpsSel.onchange = titleInput.onchange = fxToggle.onchange = () => void setup()
safeToggle.onchange = updateSafeBox
playBtn.onclick = () => {
  playing = !playing
  playBtn.textContent = playing ? '⏸ Пауза' : '▶ Играть'
  anchorFrame = currentFrame
  anchorWall = performance.now()
}
scrub.oninput = () => {
  currentFrame = Number(scrub.value)
  anchorFrame = currentFrame
  anchorWall = performance.now()
}
$<HTMLButtonElement>('determinism').onclick = () => void checkDeterminism()
$<HTMLButtonElement>('worker').onclick = () => void checkWorker()

// Frame-cost benchmark hook for e2e/render/frame-cost.spec.ts.
Object.assign(window, {
  renderBench: async (options?: Parameters<typeof import('./bench').runFrameCostBench>[0]) =>
    (await import('./bench')).runFrameCostBench(options),
})

await setup()
requestAnimationFrame(tick)
