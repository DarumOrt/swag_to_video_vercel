/**
 * Dev page dev/effects.html: the real render engine with `scene.effects` from a style preset and a
 * fake timeline whose accents cycle through every effect. Controls are generated from the
 * published param specs. Wall-clock time only picks which frame to show.
 */

import { loadEmbeddedFonts, SceneRenderer } from '@/render'
import { frameCountFor, type FrameRate, type Timeline } from '@/shared'
import { ACCENT_EFFECT_ORDER, ACCENT_EFFECTS } from '../accents'
import { evaluateAccents, prepareAccents, type PreparedAccents } from '../evaluate'
import { EFFECT_TYPES, styleEffects } from '../host'
import { defaultParams, type ParamSpec, type ParamValues } from '../params'
import { EFFECT_STYLE_ORDER, EFFECT_STYLES, type EffectStyleId } from '../presets'
import { devScene, devTimeline, hashPixels, type DevState } from './common'
import type { WorkerRequest } from './worker'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('canvas')
const styleSel = $<HTMLSelectElement>('style')
const modeSel = $<HTMLSelectElement>('accentMode')
const qualitySel = $<HTMLSelectElement>('quality')
const formatSel = $<HTMLSelectElement>('format')
const fpsSel = $<HTMLSelectElement>('fps')
const extrasBox = $<HTMLInputElement>('noRhythmExtras')
const playBtn = $<HTMLButtonElement>('play')
const scrub = $<HTMLInputElement>('scrub')
const stats = $<HTMLParagraphElement>('stats')
const logEl = $<HTMLDivElement>('log')
const sceneEffectsEl = $<HTMLDivElement>('sceneEffects')
const paramsEl = $<HTMLDivElement>('accentParams')
const paramsTitle = $<HTMLHeadingElement>('paramsTitle')

const state: DevState = {
  style: 'neon',
  accentMode: 'cycle',
  accentParams: {},
  quality: 'medium',
  disabled: [],
  noRhythmExtras: false,
}

const renderer = new SceneRenderer()
let timeline: Timeline = devTimeline(state)
let prepared: PreparedAccents = prepareAccents(timeline)
let width = 1080
let height = 1920
let fps: FrameRate = 60
let frameCount = 1
let playing = true
let anchorWall = 0
let anchorFrame = 0
let currentFrame = 0
let lastDrawn = -1
let generation = 0

let statStart = performance.now()
let draws = 0
let msSum = 0
let msWorst = 0

function log(msg: string) {
  logEl.textContent = `${msg}\n${logEl.textContent ?? ''}`
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

for (const id of EFFECT_STYLE_ORDER) styleSel.add(new Option(EFFECT_STYLES[id].label.ru, id))
styleSel.value = state.style
modeSel.add(new Option('все по очереди', 'cycle'))
for (const id of ACCENT_EFFECT_ORDER) modeSel.add(new Option(ACCENT_EFFECTS[id].label.ru, id))

function paramRow(spec: ParamSpec, value: ParamValues[string], onChange: (v: ParamValues[string]) => void) {
  const row = document.createElement('label')
  row.className = 'row'
  const name = document.createElement('span')
  name.textContent = spec.label.ru
  name.title = spec.hint?.ru ?? spec.key
  const out = document.createElement('output')
  let input: HTMLInputElement | HTMLSelectElement
  if (spec.type === 'enum') {
    const sel = document.createElement('select')
    for (const o of spec.options) sel.add(new Option(o.label.ru, o.value))
    sel.value = String(value)
    sel.onchange = () => onChange(sel.value)
    input = sel
  } else {
    const inp = document.createElement('input')
    if (spec.type === 'number') {
      Object.assign(inp, { type: 'range', min: spec.min, max: spec.max, step: spec.step, value: String(value) })
      out.textContent = String(value)
      inp.oninput = () => {
        out.textContent = inp.value
        onChange(Number(inp.value))
      }
    } else if (spec.type === 'boolean') {
      inp.type = 'checkbox'
      inp.checked = value === true
      inp.onchange = () => onChange(inp.checked)
    } else {
      inp.type = 'color'
      inp.value = String(value)
      inp.oninput = () => onChange(inp.value)
    }
    input = inp
  }
  row.append(name, input, out)
  return row
}

function buildSceneEffectList() {
  sceneEffectsEl.textContent = ''
  for (const e of styleEffects(state.style)) {
    const info = EFFECT_TYPES[e.type as keyof typeof EFFECT_TYPES]
    const label = document.createElement('label')
    label.style.display = 'block'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = !state.disabled.includes(e.type)
    box.onchange = () => {
      state.disabled = box.checked ? state.disabled.filter((t) => t !== e.type) : [...state.disabled, e.type]
      void setup()
    }
    const params = Object.entries(e.params ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    label.append(box, ` ${info?.label.ru ?? e.type} `)
    const small = document.createElement('small')
    small.style.color = '#888'
    small.textContent = `${e.type} · ${info?.hooks.join('+')} · ${params}`
    label.append(small)
    sceneEffectsEl.append(label)
  }
}

function buildAccentParams() {
  paramsEl.textContent = ''
  if (state.accentMode === 'cycle') {
    paramsTitle.textContent = 'Параметры акцента (выберите один эффект)'
    return
  }
  const def = ACCENT_EFFECTS[state.accentMode]
  paramsTitle.textContent = `Параметры: ${def.label.ru}`
  const values = { ...defaultParams(def.params), ...state.accentParams }
  for (const spec of def.params) {
    paramsEl.append(
      paramRow(spec, values[spec.key] ?? spec.default, (v) => {
        state.accentParams = { ...state.accentParams, [spec.key]: v }
        void setup()
      }),
    )
  }
}

styleSel.onchange = () => {
  state.style = styleSel.value as EffectStyleId
  state.disabled = []
  buildSceneEffectList()
  void setup()
}
modeSel.onchange = () => {
  state.accentMode = modeSel.value as DevState['accentMode']
  state.accentParams = {}
  buildAccentParams()
  void setup()
}
qualitySel.onchange = () => {
  state.quality = qualitySel.value as DevState['quality']
  void setup()
}
extrasBox.onchange = () => {
  state.noRhythmExtras = extrasBox.checked
  void setup()
}
formatSel.onchange = () => void setup()
fpsSel.onchange = () => void setup()

playBtn.onclick = () => {
  playing = !playing
  playBtn.textContent = playing ? '⏸ Пауза' : '▶ Пуск'
  anchorFrame = currentFrame
  anchorWall = performance.now()
}
scrub.oninput = () => {
  currentFrame = Number(scrub.value)
  anchorFrame = currentFrame
  anchorWall = performance.now()
}

function accentHits(): number[] {
  return prepared.accents.map((a) => a.window.wordStart)
}

function jumpAccent(dir: 1 | -1) {
  const t = currentFrame / fps
  const hits = accentHits()
  // Land a little before the hit so the attack is visible.
  const target = dir > 0 ? hits.find((h) => h - 0.4 > t + 0.05) : [...hits].reverse().find((h) => h - 0.4 < t - 0.05)
  if (target === undefined) return
  currentFrame = Math.max(0, Math.floor((target - 0.4) * fps))
  anchorFrame = currentFrame
  anchorWall = performance.now()
  scrub.value = String(currentFrame)
}
$<HTMLButtonElement>('nextAccent').onclick = () => jumpAccent(1)
$<HTMLButtonElement>('prevAccent').onclick = () => jumpAccent(-1)

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function setup() {
  const gen = ++generation
  const [w, h] = formatSel.value.split('x').map(Number)
  width = w ?? 1080
  height = h ?? 1920
  const keepTime = currentFrame / Math.max(fps, 1)
  fps = Number(fpsSel.value) as FrameRate
  timeline = devTimeline(state)
  prepared = prepareAccents(timeline, { style: state.style })
  await renderer.init({ canvas, width, height, fps, timeline, scene: devScene(state) })
  if (gen !== generation) return
  frameCount = frameCountFor(timeline.audio.durationSec, fps)
  scrub.max = String(frameCount - 1)
  currentFrame = Math.min(Math.floor(keepTime * fps), frameCount - 1)
  anchorFrame = currentFrame
  anchorWall = performance.now()
  lastDrawn = -1
}

function describeFrame(frame: number): string {
  const t = frame / fps
  const fx = evaluateAccents(prepared, t)
  const active = fx.active.map((a) => `${a.effect} ${a.level.toFixed(2)}`).join(', ')
  return `t=${t.toFixed(2)} с · акценты: ${active || '—'}`
}

function tick(now: number) {
  if (playing) currentFrame = (anchorFrame + Math.floor(((now - anchorWall) / 1000) * fps)) % frameCount
  if (currentFrame !== lastDrawn && frameCount > 1) {
    const t0 = performance.now()
    renderer.renderFrame(currentFrame)
    const ms = performance.now() - t0
    lastDrawn = currentFrame
    draws++
    msSum += ms
    msWorst = Math.max(msWorst, ms)
    if (playing) scrub.value = String(currentFrame)
  }
  if (now - statStart >= 500) {
    const secs = (now - statStart) / 1000
    stats.textContent =
      `${(draws / secs).toFixed(1)} кадр/с · renderFrame ср. ${(draws ? msSum / draws : 0).toFixed(2)} мс, ` +
      `макс. ${msWorst.toFixed(2)} мс · кадр ${currentFrame}/${frameCount - 1} · ${width}×${height}\n` +
      describeFrame(currentFrame)
    statStart = now
    draws = 0
    msSum = 0
    msWorst = 0
  }
  requestAnimationFrame(tick)
}

/** Fresh renderer on a CPU canvas: frame N, another frame, frame N again → hashes. */
async function hashFrames(frames: number[]): Promise<string[]> {
  const c = new OffscreenCanvas(width, height)
  const r = new SceneRenderer({ willReadFrequently: true })
  await r.init({ canvas: c, width, height, fps, timeline: devTimeline(state), scene: devScene(state) })
  const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D
  const out = frames.map((f) => {
    r.renderFrame(f)
    return hashPixels(g.getImageData(0, 0, width, height).data)
  })
  r.dispose()
  return out
}

$<HTMLButtonElement>('determinism').onclick = async () => {
  const n = currentFrame
  const other = (n + Math.floor(frameCount / 3)) % frameCount
  const [a, b, c] = await hashFrames([n, other, n])
  const [d] = await hashFrames([n])
  const ok = a === c && a === d
  log(`кадр ${n}: ${a} · кадр ${other}: ${b} · снова ${n}: ${c} · новый рендерер: ${d} → ${ok ? 'OK' : 'ОШИБКА'}`)
}

$<HTMLButtonElement>('worker').onclick = async () => {
  const n = currentFrame
  const [main] = await hashFrames([n])
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const req: WorkerRequest = { state: { ...state }, width, height, fps, frameIndex: n }
  worker.postMessage(req)
  worker.onmessage = (e: MessageEvent<{ hash: string; ms: number }>) => {
    log(
      `воркер: кадр ${n} → ${e.data.hash} (${e.data.ms.toFixed(1)} мс), основной поток → ${main} · ` +
        (e.data.hash === main ? 'OK, совпадает' : 'РАЗЛИЧАЮТСЯ'),
    )
    worker.terminate()
  }
  worker.onerror = (e) => {
    log(`воркер: ошибка ${e.message}`)
    worker.terminate()
  }
}

declare global {
  interface Window {
    effectsDev: { state: DevState; setFrame(n: number): void; setup(): Promise<void>; accentHits(): number[] }
  }
}
window.effectsDev = {
  state,
  setFrame(n: number) {
    playing = false
    playBtn.textContent = '▶ Пуск'
    currentFrame = n
    anchorFrame = n
    scrub.value = String(n)
    // Draw now: rAF does not run while the tab is in the background.
    renderer.renderFrame(n)
    lastDrawn = n
  },
  setup,
  accentHits,
}

buildSceneEffectList()
buildAccentParams()
void loadEmbeddedFonts()
  .then(setup)
  .then(() => requestAnimationFrame(tick))
  .catch((e: unknown) => log(`ошибка: ${String(e)}`))

