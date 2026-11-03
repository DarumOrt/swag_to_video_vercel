import { beforeEach, describe, expect, it } from 'vitest'
import { flattenWords, parseLyricsText } from '@/lyrics'
import { createFakeTimeline } from '@/render'
import type { Lyrics } from '@/shared'
import { addWordAccent, setAccentEnd } from './accentActions'
import { autoSplitGain, mergeLineWithNext, splitLineAt, splitLongLines } from './lyricsActions'
import { INITIAL_GRID, useLyricsStore } from './lyricsStore'
import { useAppStore } from './store'

function timed(text: string): Lyrics {
  const lyrics = parseLyricsText(text)
  let t = 0
  return {
    ...lyrics,
    lines: lyrics.lines.map((line) => ({
      ...line,
      words: line.words.map((word) => {
        const start = (t += 0.5)
        return { ...word, start, end: start + 0.4, confidence: 0.9, timingSource: 'aligned' }
      }),
    })),
  }
}

const lyrics = () => useAppStore.getState().timeline!.lyrics!

describe('line split and merge', () => {
  beforeEach(() => {
    const base = timed('один два три четыре пять шесть семь восемь девять десять\nкороткая строка')
    useAppStore.getState().setTimeline({
      ...createFakeTimeline({ durationSec: 12, bpm: 120 }),
      lyrics: base,
      accents: [],
    })
    useLyricsStore.setState({ grid: { ...INITIAL_GRID, enabled: true, base } })
  })

  it('keeps accents, ranges and the grid base across split and merge', () => {
    const ids = flattenWords(lyrics()).map((r) => r.word.id)
    const id = addWordAccent(ids[2]!, 'mono')!
    setAccentEnd(id, ids[6]!)
    splitLineAt(lyrics().lines[0]!.id, ids[4]!)
    expect(lyrics().lines).toHaveLength(3)
    expect(useLyricsStore.getState().grid.base!.lines).toHaveLength(3)
    const accent = useAppStore.getState().timeline!.accents[0]!
    expect(accent).toMatchObject({ wordId: ids[2], endWordId: ids[6] })
    mergeLineWithNext(lyrics().lines[0]!.id)
    expect(lyrics().lines).toHaveLength(2)
    expect(useAppStore.getState().timeline!.accents[0]).toMatchObject({ endWordId: ids[6] })
    expect(useLyricsStore.getState().grid.base!.lines).toHaveLength(2)
  })

  it('auto-splits long lines and reports the gain', () => {
    const gain = autoSplitGain(lyrics())
    expect(gain).toBeGreaterThan(0)
    splitLongLines()
    expect(lyrics().lines).toHaveLength(2 + gain)
  })
})
