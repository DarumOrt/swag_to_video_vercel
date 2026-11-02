import { expect, test } from '@playwright/test'

/**
 * VideoFrame capture from a canvas whose last pass is WebGL2 (TestWebglRenderer), on the main
 * thread and in a worker, with and without preserveDrawingBuffer, with and without yielding to the
 * event loop between drawing and capture. Every decoded frame must carry its own index.
 * Run: E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/export/export-webgl.spec.ts
 */

type Win = {
  runExport(p: unknown): Promise<Record<string, unknown>>
  verifyFrames(url: string, fps: number, sourceWidth: number): Promise<Record<string, unknown>>
}

test('WebGL2 frames are captured exactly', async ({ page }) => {
  await page.goto('/dev/export.html')
  await page.waitForFunction(() => 'runExport' in window)

  const rows: Record<string, unknown>[] = []
  for (const worker of [false, true]) {
    for (const preserveDrawingBuffer of [false, true]) {
      for (const yieldAfterDraw of [false, true]) {
        const params = {
          container: 'mp4',
          width: 720,
          height: 1280,
          fps: 30,
          durationSec: 3,
          preferHardware: true,
          renderer: 'webgl',
          worker,
          webgl: { preserveDrawingBuffer, yieldAfterDraw },
        }
        const row = await page.evaluate(async (p) => {
          const w = window as unknown as Win
          const r = await w.runExport(p)
          const check = await w.verifyFrames(r.url as string, p.fps, p.width)
          return { fps: Number((r.framesPerSec as number).toFixed(1)), ...check }
        }, params)
        const summary = { worker, preserveDrawingBuffer, yieldAfterDraw, ...row }
        console.log(JSON.stringify(summary))
        rows.push(summary)
      }
    }
  }

  // The configurations the render engine may use must be exact: no yield between draw and capture,
  // or preserveDrawingBuffer: true.
  for (const r of rows) {
    if (r.yieldAfterDraw && !r.preserveDrawingBuffer) continue // reported, not required
    expect(r, JSON.stringify(r)).toMatchObject({ frames: 90, blankCount: 0, wrongCount: 0 })
  }
})
