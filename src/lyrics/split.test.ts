import { describe, expect, it } from 'vitest'
import { addAccent, setAccentRange } from './accents'
import { toLrc } from './lrc'
import { flattenWords, lyricsToText, parseLyricsText, withWords } from './model'
import { autoSplitLong, mergeLines, splitLine, splitLineEvery } from './split'

function timed(text: string, starts?: number[]) {
  const lyrics = parseLyricsText(text)
  let k = 0
  return withWords(
    lyrics,
    flattenWords(lyrics).map((r) => {
      const s = starts ? starts[k++]! : null
      return s === null || s === undefined
        ? r.word
        : { ...r.word, start: s, end: s + 0.3, confidence: 0.9, timingSource: 'aligned' as const }
    }),
  )
}
const ids = (l: ReturnType<typeof timed>) => flattenWords(l).map((r) => r.word.id)

describe('splitLine / mergeLines', () => {
  const base = timed('[Припев]\nа б в г д е\nж з', [1, 1.5, 2, 4, 4.5, 5, 7, 7.5])
  const line = base.lines[0]!

  it('splits before the word, keeping word ids, section and stanzaStart on the first part', () => {
    const out = splitLine(base, line.id, line.words[3]!.id)
    expect(out.lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual([
      'а б в',
      'г д е',
      'ж з',
    ])
    expect(out.lines[0]!.id).toBe(line.id)
    expect(out.lines[0]!.stanzaStart).toBe(true)
    expect(out.lines[1]!.stanzaStart).toBeUndefined()
    expect(out.lines[1]!.section).toBe('Припев')
    expect(ids(out)).toEqual(ids(base))
    expect(new Set(out.lines.map((l) => l.id)).size).toBe(3)
    expect(base.lines).toHaveLength(2)
  })

  it('split → merge restores the original', () => {
    const out = mergeLines(splitLine(base, line.id, line.words[3]!.id), line.id)
    expect(out).toEqual(base)
  })

  it('ignores unknown ids, the first word and the last line', () => {
    expect(splitLine(base, 'nope', line.words[2]!.id)).toBe(base)
    expect(splitLine(base, line.id, 'nope')).toBe(base)
    expect(splitLine(base, line.id, line.words[0]!.id)).toBe(base)
    expect(mergeLines(base, base.lines[1]!.id)).toBe(base)
  })

  it('gives the same id on a repeated split and avoids collisions', () => {
    const a = splitLine(base, line.id, line.words[3]!.id)
    const b = splitLine(mergeLines(a, line.id), line.id, line.words[3]!.id)
    expect(b.lines[1]!.id).toBe(a.lines[1]!.id)
  })

  it('keeps accents (incl. ranges) on the same words', () => {
    const w = line.words
    let accents = addAccent([], w[1]!.id, 'mono')
    accents = addAccent(accents, w[4]!.id, 'mono')
    const split = splitLine(base, line.id, w[3]!.id)
    const wordIds = new Set(ids(split))
    expect(accents.every((a) => wordIds.has(a.wordId))).toBe(true)
    const range = addAccent([], w[2]!.id, 'mono')
    const ranged = setAccentRange(split, range, range[0]!.id, w[4]!.id)
    expect(ranged).toEqual(setAccentRange(base, range, range[0]!.id, w[4]!.id))
  })

  it('text export puts parts on separate lines, section header only once', () => {
    const out = splitLine(base, line.id, line.words[3]!.id)
    expect(lyricsToText(out)).toBe('[Припев]\nа б в\nг д е\n\nж з'.replace('\n\nж з', '\nж з'))
    const back = parseLyricsText(lyricsToText(out))
    expect(back.lines).toHaveLength(3)
    expect(back.lines[0]!.stanzaStart).toBe(true)
    expect(back.lines[1]!.section).toBe('Припев')
  })

  it('LRC export writes a line per part with its own time', () => {
    const out = splitLine(base, line.id, line.words[3]!.id)
    const lrc = toLrc(out, { enhanced: false })
    expect(lrc).toContain('[00:01.00]а б в')
    expect(lrc).toContain('[00:04.00]г д е')
  })

  it('handles untimed words', () => {
    const un = timed('раз два три четыре')
    const out = splitLine(un, un.lines[0]!.id, un.lines[0]!.words[2]!.id)
    expect(out.lines).toHaveLength(2)
    expect(mergeLines(out, out.lines[0]!.id)).toEqual(un)
  })
})

describe('splitLineEvery', () => {
  it('cuts by n words, keeping ids', () => {
    const l = timed('а б в г д е ж')
    const out = splitLineEvery(l, l.lines[0]!.id, 3)
    expect(out.lines.map((x) => x.words.length)).toEqual([3, 3, 1])
    expect(ids(out)).toEqual(ids(l))
    expect(new Set(out.lines.map((x) => x.id)).size).toBe(3)
    expect(splitLineEvery(l, l.lines[0]!.id, 0)).toBe(l)
    expect(splitLineEvery(l, l.lines[0]!.id, 10)).toEqual(l)
  })
})

describe('autoSplitLong', () => {
  it('splits at the biggest pause, leaves short lines alone', () => {
    const l = timed('а б в г д е ж з\nи к', [0, 0.4, 0.8, 1.2, 3, 3.4, 3.8, 4.2, 6, 6.4])
    const out = autoSplitLong(l, { maxWords: 6 })
    expect(out.lines.map((x) => x.words.length)).toEqual([4, 4, 2])
    expect(ids(out)).toEqual(ids(l))
  })

  it('splits untimed lines in the middle, recursively, and by characters', () => {
    const l = timed('а б в г д е ж з')
    expect(autoSplitLong(l, { maxWords: 3 }).lines.map((x) => x.words.length)).toEqual([2, 2, 2, 2])
    const long = timed('длинноеслово другоедлинное третьеслово')
    expect(autoSplitLong(long, { maxWords: 9, maxChars: 20 }).lines.length).toBeGreaterThan(1)
  })

  it('prefers punctuation and is idempotent', () => {
    const l = timed('а б в, г д е ж з')
    const out = autoSplitLong(l, { maxWords: 5 })
    expect(out.lines.map((x) => x.words.length)).toEqual([3, 5].length === 2 ? [3, 5] : [])
    expect(autoSplitLong(out, { maxWords: 5 })).toEqual(out)
  })
})
