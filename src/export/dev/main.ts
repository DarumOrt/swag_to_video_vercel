/**
 * Dev page for export: dev/export.html. Not part of the production build.
 * Also exposes `window.runExport(params)` for scripted benchmarks.
 */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import { analyzeAudio } from '@/audio'
import { createFakeTimeline, SceneRenderer } from '@/render'
import {
  DEFAULT_OUTPUT,
  TIMELINE_SCHEMA_VERSION,
  type Timeline,
  type FrameRate,
  type FrameRenderer,
  type OutputSettings,
  type VideoContainer,
} from '@/shared'
import {
  checkExportSupport,
  exportVideo,
  exportVideoInWorker,
  pickSaveTarget,
  type ExportProgress,
  type ExportResult,
  type PcmAudio,
  type ResolvedExportConfig,
} from '../index'
import { stubTimeline } from './stubTimeline'
import { syntheticAudio } from './syntheticAudio'
import { TestFrameRenderer } from './testRenderer'
import { frameBitsAt, TestWebglRenderer, type TestWebglOptions } from './testWebglRenderer'

interface RunParams {
  container: VideoContainer
  width: number
  height: number
  fps: FrameRate
  durationSec: number
  preferHardware: boolean
  transparent?: boolean
  /** Stream into a picked file ('file') or OPFS ('opfs') instead of an in-memory Blob. */
  save?: 'file' | 'opfs'
  /** Run in a worker: SceneRenderer, or the WebGL test renderer when renderer = 'webgl'. */
  worker?: boolean
  /**
   * 'test' = TestFrameRenderer (cheap), 'scene' = the real SceneRenderer with the default scene,
   * 'webgl' = TestWebglRenderer (WebGL2 last pass, frame index encoded in pixels).
   */
  renderer?: 'test' | 'scene' | 'webgl'
  /** Options for the WebGL test renderer. */
  webgl?: TestWebglOptions
  /** URL of a real track (e.g. /test-media/x.mp3): analyzed with @/audio, exported with SceneRenderer. */
  track?: string
  /** Encoder tuning experiments: patched into the resolved VideoEncoderConfig. */
  encoder?: Partial<VideoEncoderConfig>
}

/** Analyzed real tracks, cached by URL so repeated benchmark runs skip decoding. */
const trackCache = new Map<string, { timeline: Timeline; pcm: PcmAudio }>()

async function loadTrack(url: string) {
  const cached = trackCache.get(url)
  if (cached) return cached
  const blob = await fetch(url).then((r) => r.blob())
  const { analysis, pcm } = await analyzeAudio(blob)
  const timeline: Timeline = {
    version: TIMELINE_SCHEMA_VERSION,
    audio: analysis,
    lyrics: null,
    accents: [],
  }
  const loaded = { timeline, pcm: { sampleRate: pcm.sampleRate, channels: pcm.channels } }
  trackCache.set(url, loaded)
  return loaded
}

type RunSummary = ExportResult['stats'] & {
  save: string
  worker: boolean
  codec: string
  hardware: boolean
  url: string | null
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const log = (text: string) => {
  $('log').textContent = text
}

function readParams(): RunParams {
  const [w, h] = $<HTMLSelectElement>('size').value.split('x').map(Number)
  return {
    container: $<HTMLSelectElement>('container').value as VideoContainer,
    width: w ?? 1080,
    height: h ?? 1920,
    fps: Number($<HTMLSelectElement>('fps').value) as FrameRate,
    durationSec: Number($<HTMLInputElement>('duration').value),
    preferHardware: $<HTMLInputElement>('hw').checked,
    transparent: $<HTMLInputElement>('transparent').checked,
    save: ($<HTMLSelectElement>('save').value || undefined) as RunParams['save'],
    worker: $<HTMLInputElement>('worker').checked,
    renderer: $<HTMLSelectElement>('renderer').value as RunParams['renderer'],
  }
}

function toOutput(p: RunParams): OutputSettings {
  return {
    ...DEFAULT_OUTPUT,
    aspect: 'custom',
    width: p.width,
    height: p.height,
    fps: p.fps,
    container: p.container,
    transparent: p.transparent ?? false,
  }
}

function createRenderer(p: RunParams, hasTrack: boolean): FrameRenderer {
  if (p.renderer === 'webgl') return new TestWebglRenderer()
  return p.renderer === 'scene' || hasTrack ? new SceneRenderer() : new TestFrameRenderer()
}

/**
 * Decodes an exported file and checks every frame of the WebGL test renderer: the index encoded in
 * the pixels must equal timestamp × fps. Reports blank and wrong frames.
 */
async function verifyFrames(url: string, fps: number, sourceWidth: number) {
  const blob = await fetch(url).then((r) => r.blob())
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error('no video track')
  const width = 270
  const sink = new CanvasSink(track, { width })
  let frames = 0
  const blank: number[] = []
  const wrong: { expected: number; got: number }[] = []
  for await (const { canvas, timestamp } of sink.canvases()) {
    const expected = Math.round(timestamp * fps)
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const got = frameBitsAt(data, canvas.width, sourceWidth)
    if (got === null) blank.push(expected)
    else if (got !== expected) wrong.push({ expected, got })
    frames++
  }
  return {
    frames,
    blank: blank.slice(0, 10),
    blankCount: blank.length,
    wrong: wrong.slice(0, 10),
    wrongCount: wrong.length,
  }
}

let controller: AbortController | null = null

async function runExport(p: RunParams): Promise<RunSummary> {
  controller = new AbortController()
  $<HTMLButtonElement>('cancel').disabled = false
  $<HTMLButtonElement>('run').disabled = true
  const progressEl = $<HTMLProgressElement>('progress')
  try {
    // First await of the click handler: the file picker needs the user gesture.
    const save = p.save
      ? await pickSaveTarget(`export-${p.width}x${p.height}-${p.fps}`, p.container, {
          prefer: p.save,
        })
      : null
    const track = p.track ? await loadTrack(p.track) : null
    let tuned: ResolvedExportConfig | undefined
    if (p.encoder) {
      const audioSpec = track
        ? { sampleRate: track.pcm.sampleRate, numberOfChannels: track.pcm.channels.length }
        : { sampleRate: 48_000, numberOfChannels: 2 }
      const support = await checkExportSupport(toOutput(p), audioSpec, {
        preferHardware: p.preferHardware,
      })
      if (!support.ok) throw new Error(support.reason)
      tuned = support.config
      tuned.video.config = { ...tuned.video.config, ...p.encoder }
    }
    const common = {
      timeline:
        track?.timeline ??
        (p.renderer === 'scene'
          ? createFakeTimeline({ durationSec: p.durationSec })
          : stubTimeline(p.durationSec)),
      scene: p.renderer === 'webgl' ? (p.webgl ?? {}) : null,
      output: toOutput(p),
      audio: track?.pcm ?? syntheticAudio(p.durationSec),
      durationSec: p.durationSec,
      preferHardware: p.preferHardware,
      config: tuned,
      file: save?.file ?? null,
      signal: controller.signal,
      onProgress: (pr: ExportProgress) => {
        progressEl.value = pr.fraction
        $('status').textContent =
          `${pr.frame}/${pr.totalFrames} · ${pr.framesPerSec.toFixed(1)} кадр/с · ` +
          `осталось ${pr.etaSec === null ? '…' : `${pr.etaSec.toFixed(1)} с`}`
      },
    }
    const result = p.worker
      ? await exportVideoInWorker({
          ...common,
          createWorker:
            p.renderer === 'webgl'
              ? () => new Worker(new URL('./webgl.worker.ts', import.meta.url), { type: 'module' })
              : undefined,
        })
      : await exportVideo({ ...common, renderer: createRenderer(p, !!track) })

    const { stats, config } = result
    const row = document.createElement('tr')
    const cells = [
      p.container,
      `${p.width}×${p.height}`,
      p.fps,
      config.video.config.codec + (config.audio ? ` + ${config.audio.config.codec}` : ''),
      config.video.hardware ? 'да' : 'нет',
      stats.durationSec.toFixed(1),
      stats.elapsedSec.toFixed(2),
      stats.framesPerSec.toFixed(1),
      stats.realtimeFactor.toFixed(2),
      (stats.bytes / 1e6).toFixed(1),
    ]
    for (const c of cells) {
      const td = document.createElement('td')
      td.textContent = String(c)
      row.append(td)
    }
    const cell = document.createElement('td')
    let url: string | null = null
    const fileBlob = save?.kind === 'opfs' ? await save.file!.getFile() : result.blob
    if (fileBlob) {
      url = URL.createObjectURL(fileBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `export-${p.width}x${p.height}-${p.fps}${result.fileExtension}`
      a.textContent = 'скачать'
      cell.append(a)
      $<HTMLVideoElement>('video').src = url
    } else {
      cell.textContent = `записано в ${save?.name}`
    }
    row.append(cell)
    $('results').append(row)
    log(`Готово: ${result.mimeType}`)
    return {
      ...stats,
      save: save?.kind ?? 'memory',
      worker: !!p.worker,
      codec: config.video.config.codec,
      hardware: config.video.hardware,
      url,
    }
  } catch (error) {
    log(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    throw error
  } finally {
    controller = null
    $<HTMLButtonElement>('cancel').disabled = true
    $<HTMLButtonElement>('run').disabled = false
  }
}

$('run').addEventListener('click', () => void runExport(readParams()).catch(() => {}))
$('cancel').addEventListener('click', () => controller?.abort())
$('check').addEventListener('click', async () => {
  const p = readParams()
  const support = await checkExportSupport(
    toOutput(p),
    { sampleRate: 48_000, numberOfChannels: 2 },
    { preferHardware: p.preferHardware },
  )
  const shown = support.ok ? { video: support.config.video, audio: support.config.audio } : support
  log(JSON.stringify(shown, null, 2))
})

Object.assign(window, { runExport, verifyFrames })
