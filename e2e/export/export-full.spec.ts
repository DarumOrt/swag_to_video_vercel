import { expect, test } from '@playwright/test'

/**
 * Full-track export (heavy — rule 11: run only after the user confirms the machine is free):
 * worker + OPFS streaming, 1080×1920 @ 30 fps. Reports time, peak memory and duration match.
 * Run: EXPORT_FULL=1 E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/export/export-full.spec.ts
 * Track: EXPORT_TRACK=/test-media/<file>.mp3 (default: /test-media/track.mp3).
 */

const TRACK = process.env.EXPORT_TRACK ?? '/test-media/track.mp3'

test.skip(!process.env.EXPORT_FULL, 'heavy run: set EXPORT_FULL=1 after the user confirms')

test('full track export: worker + OPFS', async ({ page }) => {
  test.setTimeout(20 * 60_000)
  await page.goto('/dev/export.html')
  await page.waitForFunction(() => 'runExport' in window)

  const report = await page.evaluate(async (track) => {
    type Win = { runExport(p: unknown): Promise<Record<string, unknown>> }
    type MemoryApi = { measureUserAgentSpecificMemory(): Promise<{ bytes: number }> }
    const perf = performance as unknown as MemoryApi

    // Decode + analyze first (cached by the dev page), so the sampled peak is the export's own.
    const blob = await fetch(track).then((r) => r.blob())
    const ctx = new OfflineAudioContext(1, 1, 48_000)
    const durationSec = (await ctx.decodeAudioData(await blob.arrayBuffer())).duration

    // Page + workers memory (needs cross-origin isolation, which the dev server provides).
    let peak = 0
    const samples: number[] = []
    let sampling = true
    const sampler = (async () => {
      while (sampling) {
        try {
          const { bytes } = await perf.measureUserAgentSpecificMemory()
          samples.push(bytes)
          peak = Math.max(peak, bytes)
        } catch {
          // Not available — report 0.
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
    })()

    const t0 = performance.now()
    const r = await (window as unknown as Win).runExport({
      container: 'mp4',
      width: 1080,
      height: 1920,
      fps: 30,
      durationSec,
      preferHardware: true,
      track,
      worker: true,
      save: 'opfs',
    })
    const wallSec = (performance.now() - t0) / 1000
    sampling = false
    await sampler

    const video = document.createElement('video')
    video.muted = true
    video.src = r.url as string
    await new Promise((ok, fail) => {
      video.onloadedmetadata = ok
      video.onerror = () => fail(new Error(String(video.error?.message)))
    })
    const file = await fetch(r.url as string).then((x) => x.blob())

    return {
      trackSec: Number(durationSec.toFixed(3)),
      videoSec: Number(video.duration.toFixed(3)),
      width: video.videoWidth,
      height: video.videoHeight,
      frames: r.frames,
      wallSec: Number(wallSec.toFixed(1)),
      exportSec: Number((r.elapsedSec as number).toFixed(1)),
      framesPerSec: Number((r.framesPerSec as number).toFixed(1)),
      realtime: Number((r.realtimeFactor as number).toFixed(2)),
      fileMB: Number((file.size / 1e6).toFixed(1)),
      peakMemoryMB: Number((peak / 1e6).toFixed(0)),
      memorySamplesMB: samples.map((b) => Math.round(b / 1e6)),
    }
  }, TRACK)

  console.log(JSON.stringify(report))
  expect(report.width).toBe(1080)
  expect(report.height).toBe(1920)
  expect(Math.abs(report.videoSec - report.trackSec)).toBeLessThan(0.1)
})
