import { beforeEach, describe, expect, it } from 'vitest'
import { flattenWords, parseLyricsText } from '@/lyrics'
import { createFakeTimeline } from '@/render'
import type { Lyrics, Timeline } from '@/shared'
import { regenerateAccents, removeAccent, setWordAccent, updateAccent } from './accentActions'
import { STYLE_PRESETS, buildScene, presetDefaults, resolveValues } from './adapters'
import { useAppStore } from './store'

/** Words every 0.5 s, so some land on the fake timeline's beats. */
function timedLyrics(text: string): Lyrics {
  const lyrics = parseLyricsText(text)
  let t = 0
  return {
    ...lyrics,
    lines: lyrics.lines.map((line) => ({
      ...line,
      words: line.words.map((word) => {
        const start = t
        t += 0.5
        return { ...word, start, end: start + 0.4, confidence: 0.9, timingSource: 'aligned' }
      }),
    })),
  }
}

const TEXT = 'огни ночного города\nгорят ночного неба\nпесня ночного ветра\nтишина ночного моря'

function setup(): Timeline {
  const timeline = {
    ...createFakeTimeline({ durationSec: 12, bpm: 120 }),
    lyrics: timedLyrics(TEXT),
    accents: [],
  }
  useAppStore.getState().setTimeline(timeline)
  return timeline
}

const accents = () => useAppStore.getState().timeline!.accents
const wordIds = () => flattenWords(useAppStore.getState().timeline!.lyrics!).map((r) => r.word.id)

describe('accents', () => {
  beforeEach(setup)

  it('regeneration replaces auto accents and keeps user ones', () => {
    regenerateAccents()
    const auto = accents()
    expect(auto.length).toBeGreaterThan(0)
    expect(auto.every((a) => a.source === 'auto')).toBe(true)

    const userWord = wordIds()[1]!
    setWordAccent(userWord, 'invert')
    regenerateAccents()
    const after = accents()
    expect(after.filter((a) => a.wordId === userWord)).toEqual([
      expect.objectContaining({ effect: 'invert', source: 'user' }),
    ])
    expect(after.filter((a) => a.source === 'auto').every((a) => a.wordId !== userWord)).toBe(true)
  })

  it('applies to all words with the same text', () => {
    const ids = wordIds()
    setWordAccent(ids[1]!, 'flash', 0.4, true) // "ночного" appears in every line
    const flashed = accents().filter((a) => a.effect === 'flash')
    expect(flashed).toHaveLength(4)
    expect(flashed.every((a) => a.intensity === 0.4)).toBe(true)
    setWordAccent(ids[1]!, null, undefined, true)
    expect(accents()).toHaveLength(0)
  })

  it('edits make an accent a user accent; removal works', () => {
    regenerateAccents()
    const first = accents()[0]!
    updateAccent(first.wordId, { intensity: 0.2 })
    expect(accents()[0]).toMatchObject({ intensity: 0.2, source: 'user' })
    removeAccent(first.wordId)
    expect(accents().find((a) => a.wordId === first.wordId)).toBeUndefined()
  })
})

describe('style presets', () => {
  it('build valid scenes from their defaults', () => {
    for (const preset of STYLE_PRESETS) {
      const scene = buildScene(preset.id, presetDefaults(preset.id))
      expect(scene.layers.map((l) => l.type)).toEqual([
        'background',
        'spectrum-bars',
        'text',
        'lyrics',
      ])
    }
  })

  it('ignores values of the wrong type', () => {
    const preset = STYLE_PRESETS[0]!
    const values = resolveValues(preset.params, { vignette: 'much', showBars: false })
    expect(values.vignette).toBe(presetDefaults(preset.id).vignette)
    expect(values.showBars).toBe(false)
  })

  it('store keeps one scene object for preview and export', () => {
    const { setPreset, setStyleValue } = useAppStore.getState()
    setPreset('neon')
    const before = useAppStore.getState().scene
    setStyleValue('vignette', 0.1)
    const after = useAppStore.getState().scene
    expect(after).not.toBe(before)
    expect(after.layers[0]).toMatchObject({ type: 'background', vignette: 0.1 })
  })
})
