import { describe, expect, it, vi } from 'vitest'
import type { RenderCanvas } from '@/shared'
import { createFakeTimeline } from './dev/fakeTimeline'
import { FONT_FAMILY } from './fonts'
import { SceneRenderer } from './SceneRenderer'
import { createRecordingCanvas } from './testing/recordingCanvas'

const loads = vi.hoisted(() => ({
  calls: [] as (string[] | undefined)[],
  release: null as (() => void) | null,
}))

vi.mock('./fonts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./fonts')>()
  return {
    ...original,
    loadEmbeddedFonts: (families?: string[]) => {
      loads.calls.push(families)
      return new Promise<void>((resolve) => (loads.release = resolve))
    },
  }
})

describe('effect fonts', () => {
  it('waits for the fonts of effects before the first frame', async () => {
    const { canvas, log } = createRecordingCanvas()
    const r = new SceneRenderer({
      createEffect: () => null,
      effectFontFamilies: (spec) => (spec.type === 'accents' ? [FONT_FAMILY.condensed] : []),
    })
    let done = false
    const init = r
      .init({
        canvas: canvas as unknown as RenderCanvas,
        width: 1080,
        height: 1920,
        fps: 30,
        timeline: createFakeTimeline({ durationSec: 4 }),
        scene: {
          layers: [{ id: 't', type: 'text', text: 'x', fontFamily: FONT_FAMILY.mono }],
          effects: [
            { id: 'fx', type: 'accents' },
            { id: 'b', type: 'bloom' },
          ],
        },
      })
      .then(() => (done = true))
    await Promise.resolve()
    await Promise.resolve()
    expect(loads.calls.at(-1)?.sort()).toEqual([FONT_FAMILY.condensed, FONT_FAMILY.mono].sort())
    // Nothing drawn while fonts load.
    expect(done).toBe(false)
    expect(log.some((c) => c[0] === 'fillText')).toBe(false)
    loads.release?.()
    await init
    expect(done).toBe(true)
  })

  it('asks @/effects for the accents font by default', async () => {
    const { canvas } = createRecordingCanvas()
    // Real fonts lookup; no effect instances (their post passes need WebGL2).
    const r = new SceneRenderer({ createEffect: () => null })
    const init = r.init({
      canvas: canvas as unknown as RenderCanvas,
      width: 1080,
      height: 1920,
      fps: 30,
      timeline: createFakeTimeline({ durationSec: 4 }),
      scene: { layers: [], effects: [{ id: 'fx', type: 'accents', params: { font: 'display' } }] },
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(loads.calls.at(-1)).toContain(FONT_FAMILY.display)
    loads.release?.()
    await init
  })
})
