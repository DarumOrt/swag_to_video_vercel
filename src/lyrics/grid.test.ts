import { describe, expect, it } from 'vitest'
import type { Lyrics } from '@/shared'
import { beatGridFit, nearestGridTime, snapToBeatGrid } from './grid'
import { flattenWords, parseLyricsText, withWords } from './model'
import { expectPlayable } from './testing'

const TEXT = Array.from(
  { length: 6 },
  (_, i) => `Огни плывут над рекой номер${'а'.repeat(i + 1)}`,
).join('\n')

function beatsAt(bpm: number, count: number, drift = 0): Float32Array {
  const out = new Float32Array(count)
  let t = 1
  for (let i = 0; i < count; i++) {
    out[i] = t
    t += (60 / bpm) * (1 + drift * i)
  }
  return out
}

/** Words placed at `offsets(i)` seconds past the i-th grid line of `grid`. */
function lyricsOn(grid: (i: number) => number, jitter = (_: number) => 0): Lyrics {
  const lyrics = parseLyricsText(TEXT)
  const words = flattenWords(lyrics).map((r, i) => {
    const start = grid(i) + jitter(i)
    return { ...r.word, start, end: start + 0.2, timingSource: 'aligned' as const }
  })
  return withWords(lyrics, words)
}

const starts = (l: Lyrics) => flattenWords(l).map((r) => r.word.start!)

describe('nearestGridTime', () => {
  it('splits each beat interval and extrapolates past the ends', () => {
    const beats = [1, 1.5, 2]
    expect(nearestGridTime(beats, 2, 1.27)).toBeCloseTo(1.25)
    expect(nearestGridTime(beats, 1, 1.4)).toBeCloseTo(1.5)
    expect(nearestGridTime(beats, 2, 2.3)).toBeCloseTo(2.25)
    expect(nearestGridTime(beats, 1, 0.6)).toBeCloseTo(0.5)
    expect(nearestGridTime([1], 1, 1)).toBeNull()
  })

  it('follows tempo drift between beats', () => {
    const beats = [0, 0.5, 1.1] // slowing down
    expect(nearestGridTime(beats, 2, 0.84)).toBeCloseTo(0.8)
  })
})

describe('snapToBeatGrid', () => {
  const beats = beatsAt(120, 40)

  it('pulls line starts onto the grid, keeping later words', () => {
    // 8th-note grid = 0.25 s; words 0.04 s late, one word per 0.25 s.
    const lyrics = lyricsOn(
      (i) => 1 + i * 0.25,
      () => 0.04,
    )
    const out = snapToBeatGrid(lyrics, { beats }, { division: 8, strength: 1, mode: 'lines' })
    const before = starts(lyrics)
    const after = starts(out)
    const lineStarts = new Set(lyrics.lines.map((l) => l.words[0]!.id))
    flattenWords(out).forEach((r, i) => {
      if (lineStarts.has(r.word.id)) {
        expect(after[i]).toBeCloseTo(1 + i * 0.25)
        expect(r.word.timingSource).toBe('snapped')
      } else expect(after[i]).toBe(before[i])
    })
    expectPlayable(out)
  })

  it('words mode moves every word; strength 0.5 goes half way', () => {
    const lyrics = lyricsOn(
      (i) => 1 + i * 0.25,
      () => 0.06,
    )
    const out = snapToBeatGrid(lyrics, { beats }, { division: 8, strength: 0.5, mode: 'words' })
    starts(out).forEach((t, i) => expect(t).toBeCloseTo(1 + i * 0.25 + 0.03, 3))
    expectPlayable(out)
  })

  it('respects maxShiftSec and leaves manual/tap/imported words alone', () => {
    const lyrics = lyricsOn(
      (i) => 1 + i * 0.25,
      () => 0.1,
    )
    const none = snapToBeatGrid(lyrics, { beats }, { mode: 'words', maxShiftSec: 0.05 })
    expect(starts(none)).toEqual(starts(lyrics))
    const manual = withWords(
      lyrics,
      flattenWords(lyrics).map((r) => ({ ...r.word, timingSource: 'manual' as const })),
    )
    expect(snapToBeatGrid(manual, { beats }, { mode: 'both', strength: 1 })).toEqual(manual)
  })

  it('keeps order and minimum length when words are dense', () => {
    // words 0.07 s apart sit between grid lines; moves must not reorder them.
    const lyrics = lyricsOn((i) => 1 + i * 0.07)
    const out = snapToBeatGrid(
      lyrics,
      { beats },
      { division: 16, strength: 1, mode: 'words', maxShiftSec: 0.12 },
    )
    expectPlayable(out)
  })

  it('follows drifting tempo', () => {
    const drift = beatsAt(100, 40, 0.01)
    // Words exactly on the drifting beats' midpoints, then displaced a little.
    const lyrics = lyricsOn(
      (i) => (drift[i]! + drift[i + 1]!) / 2,
      (i) => (i % 2 ? 0.03 : -0.03),
    )
    const out = snapToBeatGrid(
      lyrics,
      { beats: drift },
      { division: 8, strength: 1, mode: 'words', maxShiftSec: 0.1 },
    )
    starts(out).forEach((t, i) => expect(t).toBeCloseTo((drift[i]! + drift[i + 1]!) / 2, 2))
  })

  it('is a no-op without beats', () => {
    const lyrics = lyricsOn((i) => i * 0.3)
    expect(snapToBeatGrid(lyrics, { beats: new Float32Array() })).toEqual(lyrics)
  })
})

describe('beatGridFit', () => {
  const beats = beatsAt(120, 60)

  it('scores words on a steady beat high and suggests the coarse division', () => {
    const fit = beatGridFit(
      lyricsOn(
        (i) => 1 + i * 0.5,
        (i) => ((i * 7) % 5) * 0.004 - 0.008,
      ),
      { beats },
    )
    expect(fit.score).toBeGreaterThan(0.8)
    expect(fit.suggestedDivision).toBe(4)
  })

  it('suggests 8 for eighth-note phrasing', () => {
    const fit = beatGridFit(
      lyricsOn((i) => 1 + i * 0.25),
      { beats },
    )
    expect(fit.suggestedDivision).toBe(8)
    expect(fit.score).toBeGreaterThan(0.8)
  })

  it('scores free rhythm low', () => {
    let t = 1
    const lyrics = lyricsOn((i) => {
      t += 0.17 + ((i * 37) % 11) * 0.031
      return t
    })
    const fit = beatGridFit(lyrics, { beats })
    expect(fit.score).toBeLessThan(0.4)
  })

  it('needs enough words and beats', () => {
    expect(beatGridFit(parseLyricsText('раз два'), { beats }).score).toBe(0)
  })

  it('stays high under tempo drift', () => {
    const drift = beatsAt(100, 60, 0.01)
    const fit = beatGridFit(
      lyricsOn((i) => drift[i]!),
      { beats: drift },
    )
    expect(fit.score).toBeGreaterThan(0.9)
  })
})
