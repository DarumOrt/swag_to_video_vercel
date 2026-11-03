import { beforeEach, describe, expect, it } from 'vitest'
import { flattenWords, parseLyricsText } from '@/lyrics'
import { createFakeTimeline } from '@/render'
import type { AccentEffectId, Lyrics, Timeline } from '@/shared'
import {
  addWordAccent,
  applyAccentToSameWords,
  regenerateAccents,
  removeAccent,
  setAccentEnd,
  updateAccent,
} from './accentActions'
import {
  ACCENT_EFFECTS,
  STYLE_PRESETS,
  buildScene,
  findPreset,
  presetDefaults,
  resolveValues,
} from './adapters'
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
    addWordAccent(userWord, 'invert')
    regenerateAccents()
    const after = accents()
    expect(after.filter((a) => a.wordId === userWord)).toEqual([
      expect.objectContaining({ effect: 'invert', source: 'user' }),
    ])
    expect(after.filter((a) => a.source === 'auto').every((a) => a.wordId !== userWord)).toBe(true)
  })

  it('keeps several accents on one word', () => {
    const word = wordIds()[2]!
    const first = addWordAccent(word, 'flash')
    const second = addWordAccent(word, 'shake')
    expect(first).not.toBe(second)
    expect(
      accents()
        .filter((a) => a.wordId === word)
        .map((a) => a.effect),
    ).toEqual(['flash', 'shake'])
    removeAccent(first!)
    expect(accents().map((a) => a.id)).toEqual([second])
  })

  it('sets and clears a range, refusing an end before the start', () => {
    const ids = wordIds()
    const id = addWordAccent(ids[4]!, 'mono')!
    expect(setAccentEnd(id, ids[2]!)).toBe(false)
    expect(accents()[0]!.endWordId).toBeUndefined()
    expect(setAccentEnd(id, ids[7]!)).toBe(true)
    expect(accents()[0]!.endWordId).toBe(ids[7])
    expect(setAccentEnd(id, null)).toBe(true)
    expect(accents()[0]!.endWordId).toBeUndefined()
  })

  it('applies to all words with the same text', () => {
    const ids = wordIds()
    const id = addWordAccent(ids[1]!, 'flash', { intensity: 0.4 })! // "ночного" is in every line
    applyAccentToSameWords(id)
    const flashed = accents().filter((a) => a.effect === 'flash')
    expect(flashed).toHaveLength(4)
    expect(flashed.every((a) => a.intensity === 0.4)).toBe(true)
  })

  it('edits make an accent a user accent', () => {
    regenerateAccents()
    const first = accents()[0]!
    updateAccent(first.id, { intensity: 0.2 })
    expect(accents().find((a) => a.id === first.id)).toMatchObject({
      intensity: 0.2,
      source: 'user',
    })
  })
})

// Record forces a compile error when AccentEffectId gains or loses a member.
const ACCENT_EFFECT_IDS = Object.keys({
  'zoom-punch': 0,
  shake: 0,
  glitch: 0,
  flash: 0,
  'palette-shift': 0,
  'particle-burst': 0,
  'fullscreen-word': 0,
  'slow-motion': 0,
  invert: 0,
  mono: 0,
  mirror: 0,
  strobe: 0,
  'rgb-split': 0,
  vhs: 0,
  'camera-orbit': 0,
} satisfies Record<AccentEffectId, 0>)

describe('style presets', () => {
  it('build valid scenes from their defaults', () => {
    expect(STYLE_PRESETS.map((p) => p.id)).toEqual([
      'studio',
      'neon',
      'minimal',
      'grunge',
      'fullscreen',
    ])
    for (const preset of STYLE_PRESETS) {
      const scene = buildScene(preset.id, presetDefaults(preset.id))
      const types = scene.layers.map((l) => l.type)
      expect(types).toContain('background')
      expect(types.some((t) => t === 'lyrics' || t === 'kinetic' || t === 'fulltext')).toBe(true)
      expect(scene.effects.length).toBeGreaterThan(0)
    }
  })

  it('lists exactly the shared accent effect ids', () => {
    expect(ACCENT_EFFECTS.map((e) => e.id).sort()).toEqual([...ACCENT_EFFECT_IDS].sort())
  })

  it('ignores values of the wrong type', () => {
    const preset = findPreset('neon')
    const values = resolveValues(preset.params, { reaction: 'much', oscilloscope: false })
    expect(values.reaction).toBe(presetDefaults(preset.id).reaction)
    expect(values.oscilloscope).toBe(false)
  })

  it('store keeps one scene object for preview and export', () => {
    const { setPreset, setStyleValue } = useAppStore.getState()
    setPreset('neon')
    const before = useAppStore.getState().scene
    setStyleValue('background', '#123456')
    const after = useAppStore.getState().scene
    expect(after).not.toBe(before)
    expect(JSON.stringify(after.layers)).toContain('#123456')
  })
})
