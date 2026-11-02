import { expect, test } from '@playwright/test'

/**
 * Frame cost of the render engine through the export path (OffscreenCanvas → VideoFrame → H.264)
 * via dev/render.html (`window.renderBench`, see src/render/dev/bench.ts).
 *
 *   npm run dev -- --port 5177 --strictPort
 *   E2E_BASE_URL=http://localhost:5177 npx playwright test e2e/render
 */

interface BenchResult {
  label: string
  renderMs: number
  totalMs: number
  fps: number
}

declare global {
  interface Window {
    renderBench?: (options?: { frames?: number }) => Promise<BenchResult[]>
    renderPreviewBench?: (options?: {
      frames?: number
    }) => Promise<{ label: string; ms: number; fps: number }[]>
  }
}

test('render frame cost, 1080×1920 @ 30 fps on a 3-minute timeline', async ({ page }) => {
  test.setTimeout(3 * 60_000)
  page.on('console', (m) => {
    if (m.text().startsWith('[render bench]')) console.log(m.text())
  })
  await page.goto('/dev/render.html')
  await page.waitForFunction(() => typeof window.renderBench === 'function')
  const results = await page.evaluate(() => window.renderBench!({ frames: 120 }))
  console.table(
    results.map((r) => ({
      case: r.label,
      'renderFrame, ms': r.renderMs.toFixed(2),
      'total, ms/frame': r.totalMs.toFixed(2),
      'frames/s': r.fps.toFixed(0),
    })),
  )
  expect(results.length).toBeGreaterThan(0)
})

test('preview cost of each style preset, 1080×1920 @ 60 fps', async ({ page }) => {
  test.setTimeout(3 * 60_000)
  page.on('console', (m) => {
    if (m.text().startsWith('[render preview]')) console.log(m.text())
  })
  await page.goto('/dev/render.html')
  await page.waitForFunction(() => typeof window.renderPreviewBench === 'function')
  const results = await page.evaluate(() => window.renderPreviewBench!({ frames: 240 }))
  console.table(
    results.map((r) => ({
      case: r.label,
      'ms/frame': r.ms.toFixed(2),
      'frames/s': r.fps.toFixed(0),
    })),
  )
  expect(results.length).toBeGreaterThan(0)
})
