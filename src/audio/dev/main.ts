/**
 * Dev page dev/audio.html: analyze a file, draw the timeline, follow playback live.
 * `?src=/test-media/<file>` loads a track without the file picker.
 */
import { analyzeAudio, LUFS_FLOOR, type AnalyzeAudioResult, type DecodedAudio } from '@/audio'
import { featureIndexAt, type AudioAnalysis, type SectionKind } from '@/shared'
import { analyzePcmDetailed, type AnalysisInternals } from '../analyze'
import { percentile } from '../util'
import { MIX_HARMONIC_RATIO_MIN_DB, movingAverage, VOCAL_BAND_HZ } from '../vocal'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const fileInput = $<HTMLInputElement>('file')
const mono16kInput = $<HTMLInputElement>('mono16k')
const detailsInput = $<HTMLInputElement>('details')
const clicksSelect = $<HTMLSelectElement>('clicks')
const zoomSelect = $<HTMLSelectElement>('zoom')
const cancelButton = $<HTMLButtonElement>('cancel')
const rerunButton = $<HTMLButtonElement>('rerun')
const stats = $<HTMLParagraphElement>('stats')
const log = $<HTMLDivElement>('log')
const audio = $<HTMLAudioElement>('audio')
const overview = $<HTMLCanvasElement>('overview')
const zoomView = $<HTMLCanvasElement>('zoomView')
const live = $<HTMLCanvasElement>('live')
const scopeView = $<HTMLCanvasElement>('scopeView')
const overviewCtx = overview.getContext('2d')!
const zoomCtx = zoomView.getContext('2d')!
const liveCtx = live.getContext('2d')!
const scopeCtx = scopeView.getContext('2d')!

const SECTION_COLORS: Record<SectionKind, string> = {
  quiet: '#64748b',
  normal: '#38bdf8',
  build: '#f59e0b',
  drop: '#ef4444',
}

let controller: AbortController | null = null
let current: AnalyzeAudioResult | null = null
let background: ImageBitmap | null = null
/** Full-resolution spectrogram: one column per frame (or per few frames for long tracks). */
let specImage: HTMLCanvasElement | null = null

interface Details {
  internals: AnalysisInternals
  /** Smoothed harmonic share of the vocal band, dB (what gates vocal activity). */
  ratioDb: Float32Array
  /** Vocal onset envelope scaled to 0..1. */
  vocalFlux: Float32Array
}
let details: Details | null = null

function print(line: string) {
  log.textContent = `${line}\n${log.textContent ?? ''}`
}

async function run(input: Blob | DecodedAudio) {
  controller?.abort()
  controller = new AbortController()
  cancelButton.disabled = false
  rerunButton.disabled = true
  const started = performance.now()
  const marks: string[] = []
  let stage = ''
  let stageStart = started
  try {
    const result = await analyzeAudio(input, {
      signal: controller.signal,
      mono16k: mono16kInput.checked,
      onProgress: (p) => {
        if (p.stage !== stage) {
          if (stage) marks.push(`${stage} ${Math.round(performance.now() - stageStart)} мс`)
          stage = p.stage
          stageStart = performance.now()
        }
        stats.textContent = `${p.stage}: ${Math.round(p.fraction * 100)}%`
      },
    })
    marks.push(`${stage} ${Math.round(performance.now() - stageStart)} мс`)
    const total = Math.round(performance.now() - started)
    if (current && !(input instanceof Blob)) {
      print(
        sameAnalysis(current.analysis, result.analysis)
          ? 'Детерминизм: совпало'
          : 'Детерминизм: РАЗЛИЧИЕ!',
      )
    }
    current = result
    details = null
    showSummary(result, total, marks)
    specImage = buildSpectrogram(result.analysis)
    await drawOverview(result.analysis)
    rerunButton.disabled = false
    if (detailsInput.checked) computeDetails(result.pcm)
  } catch (error) {
    stats.textContent =
      error instanceof DOMException && error.name === 'AbortError' ? 'Отменено' : String(error)
  } finally {
    cancelButton.disabled = true
  }
}

/** Re-runs the analysis on the main thread to get the intermediate curves (debug only). */
function computeDetails(pcm: DecodedAudio) {
  const started = performance.now()
  const { internals } = analyzePcmDetailed(pcm)
  const n = internals.vocalEnergy.length
  const radius = Math.round(current!.analysis.features.rate / 2)
  const harmonic = movingAverage(internals.vocalEnergy, radius)
  const band = movingAverage(internals.midPower, radius)
  const ratioDb = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    ratioDb[i] = band[i]! > 0 && harmonic[i]! > 0 ? 10 * Math.log10(harmonic[i]! / band[i]!) : -30
  }
  const scale = percentile(internals.vocalFlux, 0.99) || 1
  const vocalFlux = internals.vocalFlux.map((v) => Math.min(1, v / scale))
  details = { internals, ratioDb, vocalFlux }
  print(`Детали посчитаны за ${Math.round(performance.now() - started)} мс (main thread)`)
}

function showSummary(result: AnalyzeAudioResult, totalMs: number, marks: string[]) {
  const a = result.analysis
  const r = a.rhythm
  const d = a.durationSec || 1
  const vocal = a.vocalActivity.reduce((s, x) => s + x.end - x.start, 0) / d
  stats.textContent = [
    `${a.durationSec.toFixed(1)} с · ${a.sampleRate} Гц · ${a.channelCount} кан. · кадров ${a.features.frameCount} @ ${a.features.rate}`,
    `BPM ${r.bpm ?? '—'} · битов ${r.beats.length} · даунбитов ${r.downbeats.length} · onsets ${r.onsets.length} (${(r.onsets.length / d).toFixed(1)}/с) · vocal onsets ${r.vocalOnsets.length} (${(r.vocalOnsets.length / d).toFixed(1)}/с) · вокал ${Math.round(vocal * 100)}% в ${a.vocalActivity.length} участках`,
    `время ${totalMs} мс (${marks.join(', ')})${result.mono16k ? ` · 16 кГц: ${result.mono16k.length} сэмплов` : ''}`,
    `секции: ${(a.sections ?? []).map((s) => `${formatTime(s.start)}–${formatTime(s.end)} ${s.kind} (${s.energy.toFixed(2)})`).join(' · ')}`,
  ].join('\n')
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`
}

function sameAnalysis(a: AudioAnalysis, b: AudioAnalysis): boolean {
  const flat = (x: AudioAnalysis) => [
    x.features.spectrum.data,
    x.features.rms,
    x.features.peak,
    x.features.lufsShortTerm,
    x.features.bands.low,
    x.features.bands.mid,
    x.features.bands.high,
    x.features.stereo.correlation,
    x.features.stereo.width,
    x.rhythm.beats,
    x.rhythm.downbeats,
    x.rhythm.onsets,
    x.rhythm.vocalOnsets,
  ]
  const fa = flat(a)
  const fb = flat(b)
  return (
    a.rhythm.bpm === b.rhythm.bpm &&
    JSON.stringify(a.vocalActivity) === JSON.stringify(b.vocalActivity) &&
    fa.every((array, i) => {
      const other = fb[i]!
      return array.length === other.length && array.every((v, k) => Object.is(v, other[k]))
    })
  )
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function heat(v: number): string {
  const h = 260 - 260 * v
  return `hsl(${h} 90% ${Math.min(60, 5 + v * 70)}%)`
}

function heatRgb(v: number): [number, number, number] {
  const h = (260 - 260 * v) / 360
  const s = 0.9
  const l = Math.min(0.6, 0.05 + v * 0.7)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]
}

/** Spectrogram as an image: x = frame (max-pooled for long tracks), y = bin (low at the bottom). */
function buildSpectrogram(a: AudioAnalysis): HTMLCanvasElement | null {
  const f = a.features
  if (f.frameCount === 0) return null
  const bins = f.spectrum.binCount
  const pool = Math.ceil(f.frameCount / 16384)
  const width = Math.ceil(f.frameCount / pool)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = bins
  const image = new ImageData(width, bins)
  for (let x = 0; x < width; x++) {
    for (let b = 0; b < bins; b++) {
      let v = 0
      for (let i = x * pool; i < Math.min(f.frameCount, (x + 1) * pool); i++) {
        v = Math.max(v, f.spectrum.data[i * bins + b]!)
      }
      const [r, g, bl] = heatRgb(v)
      const o = ((bins - 1 - b) * width + x) * 4
      image.data[o] = r
      image.data[o + 1] = g
      image.data[o + 2] = bl
      image.data[o + 3] = 255
    }
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  return canvas
}

/** Y (0 = top, 1 = bottom) of a frequency in the log spectrum. */
function freqY(a: AudioAnalysis, hz: number): number {
  const { minHz, maxHz } = a.features.spectrum
  return 1 - Math.log(hz / minHz) / Math.log(maxHz / minHz)
}

function firstIndexAtOrAfter(times: Float32Array, t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function nearDistance(times: Float32Array, t: number): number {
  const i = firstIndexAtOrAfter(times, t)
  const a = i < times.length ? Math.abs(times[i]! - t) : Infinity
  const b = i > 0 ? Math.abs(times[i - 1]! - t) : Infinity
  return Math.min(a, b)
}

/** Section strip with kind colors and energy as opacity, plus labels when wide enough. */
function drawSections(
  ctx: CanvasRenderingContext2D,
  a: AudioAnalysis,
  toX: (t: number) => number,
  y: number,
  h: number,
) {
  ctx.font = '10px system-ui'
  for (const s of a.sections ?? []) {
    const x0 = toX(s.start)
    const x1 = toX(s.end)
    ctx.globalAlpha = 0.45 + 0.55 * s.energy
    ctx.fillStyle = SECTION_COLORS[s.kind]
    ctx.fillRect(x0, y, x1 - x0 - 1, h)
    ctx.globalAlpha = 1
    if (x1 - x0 > 40) {
      ctx.fillStyle = '#000'
      ctx.fillText(s.kind, Math.max(x0, 0) + 3, y + h - 2)
    }
  }
}

/** Oscilloscope (L and R over the window) and goniometer (M up, S sideways) from `scope`. */
function drawScope(a: AudioAnalysis, t: number) {
  const ctx = scopeCtx
  const { width, height } = scopeView
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  const scope = a.features.scope
  if (!scope || a.features.frameCount === 0) return
  const n = scope.pointsPerFrame
  const row = featureIndexAt(a.features, t) * n
  const oscWidth = width - height
  const mid = height / 2
  const trace = (values: Float32Array, color: string) => {
    ctx.strokeStyle = color
    ctx.beginPath()
    for (let p = 0; p < n; p++) {
      const x = (p / (n - 1)) * (oscWidth - 10)
      const y = mid - values[row + p]! * mid * 0.95
      if (p === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.lineWidth = 1.5
  trace(scope.left, '#4ade80')
  trace(scope.right, 'rgba(96, 165, 250, 0.8)')

  const cx = oscWidth + height / 2
  ctx.strokeStyle = '#333'
  ctx.strokeRect(oscWidth, 0, height, height)
  ctx.fillStyle = '#fde047'
  for (let p = 0; p < n; p++) {
    const l = scope.left[row + p]!
    const r = scope.right[row + p]!
    // 45° rotation: mono content is vertical, side content horizontal.
    const x = cx + ((r - l) / Math.SQRT2) * mid * 0.95
    const y = mid - ((l + r) / Math.SQRT2) * mid * 0.95
    ctx.fillRect(x, y, 2, 2)
  }
  ctx.fillStyle = '#9cf'
  ctx.font = '11px system-ui'
  ctx.fillText(
    `scope ${n} точек / ${Math.round(scope.windowSec * 1000)} мс · L зелёный, R синий`,
    6,
    14,
  )
}

// Layout of the overview canvas (y ranges).
const SPEC = { top: 0, height: 240 }
const LANES = { top: 250, height: 200 }
const MARKS = { top: 460, height: 60 }

async function drawOverview(a: AudioAnalysis) {
  const { width } = overview
  const f = a.features
  const ctx = overviewCtx
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, overview.height)
  if (f.frameCount === 0 || !specImage) return
  const framesPerPx = f.frameCount / width

  ctx.imageSmoothingEnabled = true
  ctx.drawImage(specImage, 0, SPEC.top, width, SPEC.height)
  drawSections(ctx, a, (t) => (t / a.durationSec) * width, SPEC.top, 10)
  const toX = (t: number) => (t / a.durationSec) * width

  // Vocal activity over the vocal rows of the spectrogram.
  const vocalTop = SPEC.top + freqY(a, VOCAL_BAND_HZ[1]) * SPEC.height
  const vocalBottom = SPEC.top + freqY(a, VOCAL_BAND_HZ[0]) * SPEC.height
  ctx.fillStyle = 'rgba(163, 230, 53, 0.22)'
  for (const r of a.vocalActivity) {
    ctx.fillRect(toX(r.start), vocalTop, toX(r.end) - toX(r.start), vocalBottom - vocalTop)
  }

  const lane = (values: Float32Array, color: string, map: (v: number) => number) => {
    ctx.strokeStyle = color
    ctx.beginPath()
    for (let x = 0; x < width; x++) {
      const from = Math.floor(x * framesPerPx)
      const to = Math.max(from + 1, Math.floor((x + 1) * framesPerPx))
      let v = -Infinity
      for (let i = from; i < to && i < f.frameCount; i++) v = Math.max(v, values[i]!)
      const y = LANES.top + LANES.height * (1 - Math.min(1, Math.max(0, map(v))))
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.lineWidth = 1
  lane(f.peak, '#fff', (v) => v)
  lane(f.rms, '#4ade80', (v) => v)
  lane(f.lufsShortTerm, '#facc15', (v) => (v - LUFS_FLOOR) / -LUFS_FLOOR)
  lane(f.bands.low, '#f87171', (v) => v)
  lane(f.bands.mid, '#60a5fa', (v) => v)
  lane(f.bands.high, '#c084fc', (v) => v)

  ctx.fillStyle = 'rgba(163, 230, 53, 0.6)'
  for (const r of a.vocalActivity) {
    ctx.fillRect(toX(r.start), MARKS.top, toX(r.end) - toX(r.start), 6)
  }
  const ticks = (times: Float32Array, color: string, y: number, h: number) => {
    ctx.fillStyle = color
    for (const t of times) ctx.fillRect(Math.round(toX(t)), y, 1, h)
  }
  ctx.fillStyle = '#f472b6'
  a.rhythm.beats.forEach((t, k) => {
    const h = 4 + 14 * (a.rhythm.beatStrength?.[k] ?? 1)
    ctx.fillRect(Math.round(toX(t)), MARKS.top + 24 - h, 1, h)
  })
  ticks(a.rhythm.downbeats, '#f472b6', MARKS.top + 8, 18)
  ticks(a.rhythm.onsets, '#fb923c', MARKS.top + 30, 12)
  ticks(a.rhythm.vocalOnsets, '#22d3ee', MARKS.top + 45, 12)

  background = await createImageBitmap(overview)
}

// Layout of the zoom canvas.
const ZOOM_SPEC = { top: 0, height: 260 }
const ZOOM_LANES = { top: 268, height: 150 }

function drawZoom(a: AudioAnalysis, t: number) {
  const ctx = zoomCtx
  const { width, height } = zoomView
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  const f = a.features
  if (!specImage || f.frameCount === 0) return
  const span = Number(zoomSelect.value)
  const from = t - span / 2
  const toX = (time: number) => ((time - from) / span) * width
  const pxPerCol = specImage.width / a.durationSec

  // Spectrogram slice (columns outside the track stay black).
  const sx = from * pxPerCol
  const sw = span * pxPerCol
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(specImage, sx, 0, sw, specImage.height, 0, ZOOM_SPEC.top, width, ZOOM_SPEC.height)

  const vocalTop = ZOOM_SPEC.top + freqY(a, VOCAL_BAND_HZ[1]) * ZOOM_SPEC.height
  const vocalBottom = ZOOM_SPEC.top + freqY(a, VOCAL_BAND_HZ[0]) * ZOOM_SPEC.height
  ctx.strokeStyle = 'rgba(163, 230, 53, 0.9)'
  ctx.lineWidth = 2
  for (const r of a.vocalActivity) {
    if (r.end < from || r.start > from + span) continue
    ctx.strokeRect(toX(r.start), vocalTop, toX(r.end) - toX(r.start), vocalBottom - vocalTop)
  }

  const lines = (times: Float32Array, color: string, y0: number, y1: number, lineWidth = 1) => {
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    for (let i = firstIndexAtOrAfter(times, from); i < times.length; i++) {
      const time = times[i]!
      if (time > from + span) break
      const x = Math.round(toX(time)) + 0.5
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y1)
    }
    ctx.stroke()
  }
  lines(a.rhythm.onsets, 'rgba(251, 146, 60, 0.55)', ZOOM_SPEC.top, vocalTop)
  lines(a.rhythm.vocalOnsets, 'rgba(34, 211, 238, 0.9)', vocalTop, vocalBottom, 2)
  // Beats: length = strength; downbeats thicker.
  const downbeats = new Set(a.rhythm.downbeats)
  for (let k = firstIndexAtOrAfter(a.rhythm.beats, from); k < a.rhythm.beats.length; k++) {
    const time = a.rhythm.beats[k]!
    if (time > from + span) break
    const strength = a.rhythm.beatStrength?.[k] ?? 1
    ctx.fillStyle = '#f472b6'
    ctx.fillRect(
      Math.round(toX(time)) - 1,
      ZOOM_SPEC.top + 12,
      downbeats.has(time) ? 4 : 2,
      6 + 30 * strength,
    )
  }
  drawSections(ctx, a, toX, ZOOM_SPEC.top, 10)

  // Curves.
  const firstFrame = Math.max(0, Math.floor(from * f.rate))
  const lastFrame = Math.min(f.frameCount - 1, Math.ceil((from + span) * f.rate))
  const curve = (values: ArrayLike<number>, color: string, map: (v: number) => number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = firstFrame; i <= lastFrame; i++) {
      const x = toX((i + 0.5) / f.rate)
      const y = ZOOM_LANES.top + ZOOM_LANES.height * (1 - Math.min(1, Math.max(0, map(values[i]!))))
      if (i === firstFrame) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  curve(f.bands.low, '#f87171', (v) => v)
  curve(f.bands.mid, 'rgba(96, 165, 250, 0.7)', (v) => v)
  if (details) {
    // Harmonic ratio: -15..0 dB mapped to the lane, threshold dashed.
    const mapRatio = (v: number) => (v + 15) / 15
    curve(details.ratioDb, '#fde047', mapRatio)
    curve(details.vocalFlux, 'rgba(34, 211, 238, 0.6)', (v) => v)
    const y = ZOOM_LANES.top + ZOOM_LANES.height * (1 - mapRatio(MIX_HARMONIC_RATIO_MIN_DB))
    ctx.setLineDash([6, 6])
    ctx.strokeStyle = '#fde047'
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.fillStyle = '#fff'
  ctx.fillRect(width / 2, 0, 1, height)
  ctx.fillStyle = '#9cf'
  ctx.font = '11px system-ui'
  for (let s = Math.ceil(from); s <= from + span; s++) ctx.fillText(`${s}`, toX(s) + 2, height - 2)
}

// ---------------------------------------------------------------------------
// Click track (ear check of beats / onsets)
// ---------------------------------------------------------------------------

let clickContext: AudioContext | null = null
let scheduledUntil = 0

function clickTimes(a: AudioAnalysis): Float32Array | null {
  switch (clicksSelect.value) {
    case 'beats':
      return a.rhythm.beats
    case 'onsets':
      return a.rhythm.onsets
    case 'vocal':
      return a.rhythm.vocalOnsets
    default:
      return null
  }
}

function click(when: number, accent: boolean) {
  const ctx = clickContext!
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = accent ? 2400 : 1500
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(0.5, when + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04)
  osc.connect(gain).connect(ctx.destination)
  osc.start(when)
  osc.stop(when + 0.05)
}

function scheduleClicks(a: AudioAnalysis, t: number) {
  const times = clickTimes(a)
  if (!times || audio.paused || !clickContext) {
    scheduledUntil = t
    return
  }
  const horizon = t + 0.15
  const downbeats = new Set(a.rhythm.downbeats)
  for (let i = firstIndexAtOrAfter(times, Math.max(scheduledUntil, t)); i < times.length; i++) {
    const time = times[i]!
    if (time > horizon) break
    if (time <= scheduledUntil) continue
    const accent = clicksSelect.value === 'beats' && downbeats.has(time)
    click(clickContext.currentTime + (time - t), accent)
  }
  scheduledUntil = horizon
}

audio.addEventListener('play', () => {
  clickContext ??= new AudioContext()
  void clickContext.resume()
  scheduledUntil = audio.currentTime
})
audio.addEventListener('seeking', () => {
  scheduledUntil = audio.currentTime
})

// ---------------------------------------------------------------------------
// Live view
// ---------------------------------------------------------------------------

function drawLive() {
  requestAnimationFrame(drawLive)
  const result = current
  if (!result) return
  const a = result.analysis
  const f = a.features
  const t = audio.currentTime

  scheduleClicks(a, t)

  if (background) {
    overviewCtx.drawImage(background, 0, 0)
    const x = (t / a.durationSec) * overview.width
    overviewCtx.fillStyle = '#fff'
    overviewCtx.fillRect(Math.round(x), 0, 1, overview.height)
  }
  drawZoom(a, t)
  drawScope(a, t)

  const ctx = liveCtx
  const { width, height } = live
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  if (f.frameCount === 0) return
  const i = featureIndexAt(f, t)
  const bins = f.spectrum.binCount
  const specWidth = 760
  const barWidth = specWidth / bins
  for (let b = 0; b < bins; b++) {
    const v = f.spectrum.data[i * bins + b]!
    ctx.fillStyle = heat(v)
    ctx.fillRect(b * barWidth, height - v * height, Math.max(1, barWidth - 1), v * height)
  }

  const meters: [string, number, string][] = [
    ['peak', f.peak[i]!, '#fff'],
    ['rms', f.rms[i]!, '#4ade80'],
    ['LUFS', (f.lufsShortTerm[i]! - LUFS_FLOOR) / -LUFS_FLOOR, '#facc15'],
    ['low', f.bands.low[i]!, '#f87171'],
    ['mid', f.bands.mid[i]!, '#60a5fa'],
    ['high', f.bands.high[i]!, '#c084fc'],
    ['width', f.stereo.width[i]!, '#94a3b8'],
  ]
  meters.forEach(([label, v, color], k) => {
    const x = specWidth + 20 + k * 40
    ctx.fillStyle = color
    ctx.fillRect(x, height - 20 - v * (height - 40), 28, v * (height - 40))
    ctx.fillStyle = '#aaa'
    ctx.font = '11px system-ui'
    ctx.fillText(label, x, height - 6)
  })

  const beatHit = nearDistance(a.rhythm.beats, t) < 0.05
  const onsetHit = nearDistance(a.rhythm.onsets, t) < 0.04
  const vocalHit = nearDistance(a.rhythm.vocalOnsets, t) < 0.04
  const vocal = a.vocalActivity.some((r) => t >= r.start && t <= r.end)
  const lamps: [string, boolean, string][] = [
    ['beat', beatHit, '#f472b6'],
    ['onset', onsetHit, '#fb923c'],
    ['vocal onset', vocalHit, '#22d3ee'],
    ['вокал', vocal, '#a3e635'],
  ]
  ctx.font = '12px system-ui'
  lamps.forEach(([label, on, color], k) => {
    ctx.fillStyle = on ? color : '#333'
    ctx.fillRect(specWidth + 20 + k * 100, 12, 90, 24)
    ctx.fillStyle = on ? '#000' : '#888'
    ctx.fillText(label, specWidth + 26 + k * 100, 29)
  })
  ctx.fillStyle = '#9cf'
  ctx.fillText(
    `t ${t.toFixed(2)} · кадр ${i} · LUFS ${f.lufsShortTerm[i]!.toFixed(1)} · corr ${f.stereo.correlation[i]!.toFixed(2)}`,
    specWidth + 20,
    58,
  )
}

function load(blob: Blob) {
  audio.src = URL.createObjectURL(blob)
  current = null
  background = null
  specImage = null
  details = null
  void run(blob)
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) load(file)
})
cancelButton.addEventListener('click', () => controller?.abort())
rerunButton.addEventListener('click', () => {
  if (current) void run(current.pcm)
})
detailsInput.addEventListener('change', () => {
  if (detailsInput.checked && current && !details) computeDetails(current.pcm)
})
const seek = (
  canvas: HTMLCanvasElement,
  event: MouseEvent,
  toTime: (fraction: number) => number,
) => {
  const rect = canvas.getBoundingClientRect()
  audio.currentTime = Math.max(0, toTime((event.clientX - rect.left) / rect.width))
}
overview.addEventListener('click', (event) => {
  if (current) seek(overview, event, (x) => x * current!.analysis.durationSec)
})
zoomView.addEventListener('click', (event) => {
  const span = Number(zoomSelect.value)
  seek(zoomView, event, (x) => audio.currentTime + (x - 0.5) * span)
})

const src = new URLSearchParams(location.search).get('src')
if (src) {
  void fetch(src)
    .then((response) => response.blob())
    .then(load)
}

requestAnimationFrame(drawLive)
