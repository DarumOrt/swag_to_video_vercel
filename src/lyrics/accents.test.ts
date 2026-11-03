import { describe, expect, it } from 'vitest'
import type { Accent, AudioSection, Lyrics } from '@/shared'
import {
  EFFECT_DEFAULTS,
  STRONG_EFFECTS,
  accentsCoveringWord,
  accentsForWord,
  addAccent,
  isRangeEffect,
  nextAccentId,
  applyToAllOccurrences,
  hookScores,
  regenerateAuto,
  removeAccent,
  setAccent,
  setAccentRange,
  updateAccent,
  suggestAccents,
} from './accents'
import { flattenWords, parseLyricsText, withWords } from './model'

// Original test lines. Words are 0.5 s apart, beats every 0.5 s, downbeats every 2 s.
const TEXT = `[Куплет]
Я иду по тёмной улице домой
Фонари горят над головой
[Припев]
Гори огонь гори сильней
Гори огонь в груди моей
[Припев]
Гори огонь гори сильней
Гори огонь в груди моей`

function timedLyrics(text = TEXT): Lyrics {
  const lyrics = parseLyricsText(text)
  const words = flattenWords(lyrics).map((r, i) => ({
    ...r.word,
    start: i * 0.5,
    end: i * 0.5 + 0.4,
    timingSource: 'aligned' as const,
  }))
  return withWords(lyrics, words)
}

function grid(step: number, until: number) {
  return Float32Array.from({ length: Math.floor(until / step) + 1 }, (_, i) => i * step)
}
const rhythm = { beats: grid(0.5, 30), downbeats: grid(2, 30) }
const wordAt = (lyrics: Lyrics, id: string) =>
  flattenWords(lyrics).find((r) => r.word.id === id)!.word

describe('hookScores', () => {
  it('scores words repeated across chorus lines, skipping stop words', () => {
    const scores = hookScores(timedLyrics())
    expect(scores.get('гори')).toBe(1)
    expect(scores.get('огонь')).toBeCloseTo(4 / 6)
    expect(scores.has('в')).toBe(false)
    expect(scores.has('улице')).toBe(false)
  })

  it('treats repeated unlabeled lines as a chorus', () => {
    const scores = hookScores(parseLyricsText('Беги быстрей\nБеги быстрей\nКуда-то вдаль'))
    expect(scores.get('беги')).toBe(1)
  })
})

describe('suggestAccents', () => {
  const lyrics = timedLyrics()

  it('respects density and minimum gap', () => {
    const accents = suggestAccents(lyrics, rhythm, [], { maxPer10Sec: 2, minGapSec: 1.5 })
    const times = accents.map((a) => wordAt(lyrics, a.wordId).start!)
    expect(accents.length).toBeGreaterThan(0)
    for (const t of times)
      expect(times.filter((x) => x >= t && x < t + 10).length).toBeLessThanOrEqual(2)
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1.5)
  })

  it('prefers hook words and marks everything auto with stable ids', () => {
    const accents = suggestAccents(lyrics, rhythm)
    expect(accents.every((a) => a.source === 'auto' && a.id === `auto:${a.wordId}`)).toBe(true)
    const texts = accents.map((a) => wordAt(lyrics, a.wordId).text.toLowerCase())
    expect(texts.filter((t) => t === 'гори' || t === 'огонь').length).toBeGreaterThanOrEqual(2)
    expect(accents.some((a) => a.reason === 'hook')).toBe(true)
    expect(suggestAccents(lyrics, rhythm)).toEqual(accents)
  })

  it('never puts two strong effects in a row', () => {
    for (const style of ['aggressive', 'balanced', 'minimal'] as const) {
      const accents = suggestAccents(lyrics, rhythm, [], { style, maxPer10Sec: 6, minGapSec: 0.5 })
      for (let i = 1; i < accents.length; i++) {
        expect(
          STRONG_EFFECTS.has(accents[i - 1]!.effect) && STRONG_EFFECTS.has(accents[i]!.effect),
        ).toBe(false)
      }
    }
  })

  it('picks effects by style', () => {
    const minimal = suggestAccents(lyrics, rhythm, [], { style: 'minimal' })
    expect(new Set(minimal.map((a) => a.effect))).toEqual(
      new Set(['fullscreen-word', 'zoom-punch']),
    )
    const aggressive = suggestAccents(lyrics, rhythm, [], { style: 'aggressive' })
    expect(aggressive.some((a) => a.effect === 'shake' || a.effect === 'glitch')).toBe(true)
    for (const a of [...minimal, ...aggressive]) {
      expect(a.intensity).toBeGreaterThan(0)
      expect(a.intensity).toBeLessThanOrEqual(1)
      expect(a.durationSec).toBeGreaterThan(0)
    }
  })

  it('hits the first word of a drop and stays quiet in quiet sections', () => {
    const verseOnly = timedLyrics('Тишина ложится на пустой перрон\nИ поезд уходит в ночь без нас')
    const words = flattenWords(verseOnly).map((r) => r.word)
    const sections: AudioSection[] = [
      { start: 0, end: 2.4, kind: 'quiet', energy: 0.1 },
      { start: 2.4, end: 10, kind: 'drop', energy: 1 },
    ]
    const accents = suggestAccents(verseOnly, rhythm, sections, { style: 'aggressive' })
    const dropWord = words.find((w) => w.text === 'поезд')!
    expect(accents.find((a) => a.wordId === dropWord.id)).toMatchObject({
      reason: 'drop',
      effect: 'glitch',
    })
    expect(accents.every((a) => wordAt(verseOnly, a.wordId).start! >= 2.4)).toBe(true)
  })

  it('uses beat strength to pick stronger beats', () => {
    const plain = timedLyrics('Огни плывут над тёмною рекой')
    const beatStrength = new Float32Array(rhythm.beats.length).fill(0.1)
    beatStrength[3] = 1 // 1.5 s → "тёмною"
    const accents = suggestAccents(
      plain,
      { ...rhythm, downbeats: new Float32Array(), beatStrength },
      [],
      {
        minScore: 0.3,
      },
    )
    expect(accents.map((a) => wordAt(plain, a.wordId).text)).toEqual(['тёмною'])
  })

  it('ignores untimed words', () => {
    expect(suggestAccents(parseLyricsText(TEXT), rhythm)).toEqual([])
  })
})

describe('accent editing', () => {
  const lyrics = timedLyrics()
  const ids = flattenWords(lyrics).map((r) => r.word.id)

  it('setAccent replaces an auto accent with a user one', () => {
    const auto: Accent[] = [
      {
        id: `auto:${ids[0]}`,
        wordId: ids[0]!,
        effect: 'flash',
        source: 'auto',
        preRollSec: 0,
        durationSec: 0.2,
        intensity: 0.7,
        params: {},
      },
    ]
    const out = setAccent(auto, ids[0]!, 'glitch')
    expect(out).toEqual([
      {
        id: `user:${ids[0]}`,
        wordId: ids[0],
        effect: 'glitch',
        source: 'user',
        preRollSec: 0.05,
        durationSec: 0.3,
        intensity: 0.7,
        params: {},
      },
    ])
  })

  it('setAccent with the same effect keeps timing, applies overrides', () => {
    const first = setAccent([], ids[1]!, 'zoom-punch', { durationSec: 0.5, params: { scale: 1.3 } })
    const second = setAccent(first, ids[1]!, 'zoom-punch', { intensity: 2 })
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ durationSec: 0.5, intensity: 1, params: { scale: 1.3 } })
  })

  it('removeAccent drops accents of that word only', () => {
    const accents = setAccent(setAccent([], ids[0]!, 'flash'), ids[1]!, 'shake')
    expect(removeAccent(accents, ids[0]!).map((a) => a.wordId)).toEqual([ids[1]])
  })

  it('applyToAllOccurrences covers every form of the word', () => {
    const goriId = flattenWords(lyrics).find((r) => r.word.text === 'Гори')!.word.id
    const base = setAccent([], goriId, 'shake', { intensity: 0.4 })
    const out = applyToAllOccurrences(lyrics, base, goriId, 'shake')
    const gori = flattenWords(lyrics).filter((r) => r.word.text.toLowerCase() === 'гори')
    expect(out).toHaveLength(gori.length)
    expect(
      out.every((a) => a.effect === 'shake' && a.source === 'user' && a.intensity === 0.4),
    ).toBe(true)
  })

  it('regenerateAuto keeps user accents and replaces only auto ones', () => {
    const fresh = suggestAccents(lyrics, rhythm)
    const userWord = fresh[0]!.wordId
    const current: Accent[] = [
      { ...fresh[1]!, id: 'old-auto', effect: 'invert' },
      {
        id: 'mine',
        wordId: userWord,
        effect: 'invert',
        preRollSec: 0,
        durationSec: 0.2,
        intensity: 1,
        params: {},
      },
    ]
    const out = regenerateAuto(current, fresh)
    expect(out.find((a) => a.id === 'mine')).toEqual(current[1])
    expect(out.some((a) => a.id === 'old-auto')).toBe(false)
    expect(out.filter((a) => a.wordId === userWord)).toHaveLength(1)
    expect(out.filter((a) => a.source === 'auto')).toHaveLength(fresh.length - 1)
    expect(out.every((a) => !('reason' in a) && !('score' in a))).toBe(true)
  })
})

describe('multiple and range accents', () => {
  const lyrics = timedLyrics()
  const ids = flattenWords(lyrics).map((r) => r.word.id)

  it('addAccent stacks accents on a word with unique ids', () => {
    let a = addAccent([], ids[0]!, 'zoom-punch')
    a = addAccent(a, ids[0]!, 'flash')
    a = addAccent(a, ids[0]!, 'flash')
    expect(new Set(a.map((x) => x.id)).size).toBe(3)
    expect(accentsForWord(a, ids[0]!)).toHaveLength(3)
    expect(a[0]).toMatchObject({ id: `user:${ids[0]}`, source: 'user', durationSec: 0.35 })
    expect(nextAccentId(a, ids[0]!)).toBe(`user:${ids[0]}#4`)
  })

  it('range effects have defaults and are marked as range effects', () => {
    for (const e of ['mono', 'mirror', 'strobe', 'rgb-split', 'vhs', 'camera-orbit'] as const) {
      expect(EFFECT_DEFAULTS[e].durationSec).toBeGreaterThan(0)
      expect(isRangeEffect(e)).toBe(true)
    }
    expect(isRangeEffect('flash')).toBe(false)
  })

  it('updateAccent patches by id, resets timing on an effect change, clears the range', () => {
    let a = addAccent([], ids[1]!, 'flash', { intensity: 0.5 })
    a = addAccent(a, ids[1]!, 'mono', { endWordId: ids[4]! })
    const [flash, mono] = a
    const changed = updateAccent(a, flash!.id, { effect: 'glitch' })
    expect(changed[0]).toMatchObject({ effect: 'glitch', durationSec: 0.3, intensity: 0.5 })
    expect(changed[1]).toEqual(mono)
    const cleared = updateAccent(a, mono!.id, { endWordId: null })
    expect('endWordId' in cleared[1]!).toBe(false)
    expect(updateAccent(a, 'nope', { intensity: 1 })).toEqual(a)
  })

  it('setAccentRange validates order', () => {
    const a = addAccent([], ids[3]!, 'mono')
    const id = a[0]!.id
    expect(setAccentRange(lyrics, a, id, ids[2]!)).toEqual(a) // before start: refused
    expect(setAccentRange(lyrics, a, id, 'missing')).toEqual(a)
    expect(setAccentRange(lyrics, a, id, ids[3]!)[0]!.endWordId).toBe(ids[3])
    const ranged = setAccentRange(lyrics, a, id, ids[6]!)
    expect(ranged[0]!.endWordId).toBe(ids[6])
    expect(setAccentRange(lyrics, ranged, id, null)[0]!.endWordId).toBeUndefined()
    expect(accentsCoveringWord(lyrics, ranged, ids[5]!)).toHaveLength(1)
    expect(accentsCoveringWord(lyrics, ranged, ids[7]!)).toHaveLength(0)
  })

  it('removeAccent removes one accent by id (word id still works for the old callers)', () => {
    const a = addAccent(addAccent([], ids[0]!, 'flash'), ids[0]!, 'shake')
    expect(removeAccent(a, a[0]!.id)).toEqual([a[1]])
    expect(removeAccent(a, ids[0]!)).toEqual([])
  })

  it('applyToAllOccurrences keeps other accents and copies a range by length', () => {
    const goriIds = flattenWords(lyrics)
      .filter((r) => r.word.text.toLowerCase() === 'гори')
      .map((r) => r.word.id)
    const first = goriIds[0]!
    const at = ids.indexOf(first)
    let a = addAccent([], first, 'flash')
    a = addAccent(a, first, 'mono', { endWordId: ids[at + 1]! })
    const out = applyToAllOccurrences(lyrics, a, first, 'mono')
    const monos = out.filter((x) => x.effect === 'mono')
    expect(monos).toHaveLength(goriIds.length)
    for (const m of monos) expect(m.endWordId).toBe(ids[ids.indexOf(m.wordId) + 1])
    expect(out.filter((x) => x.effect === 'flash')).toHaveLength(1)
    expect(applyToAllOccurrences(lyrics, out, first, 'mono')).toEqual(out)
  })

  it('regenerateAuto never touches user accents, including ranges', () => {
    const fresh = suggestAccents(lyrics, rhythm)
    const user = addAccent([], fresh[0]!.wordId, 'mono', { endWordId: ids[ids.length - 1]! })
    const out = regenerateAuto(user, fresh)
    expect(out[0]).toEqual(user[0])
    expect(out.filter((x) => x.wordId === fresh[0]!.wordId)).toHaveLength(1)
  })

  it('suggests one range mode per chorus/drop section', () => {
    const sections: AudioSection[] = [
      { start: 0, end: 4, kind: 'normal', energy: 0.4, role: 'verse' },
      { start: 4, end: 10, kind: 'normal', energy: 0.9, role: 'chorus' },
      { start: 10, end: 14, kind: 'drop', energy: 1 },
    ]
    const out = suggestAccents(lyrics, rhythm, sections, { style: 'aggressive' })
    const ranges = out.filter((a) => a.endWordId)
    expect(ranges.map((r) => r.effect)).toEqual(['rgb-split', 'strobe'])
    expect(ranges.every((r) => r.reason === 'section' && r.source === 'auto')).toBe(true)
    const chorus = ranges[0]!
    expect(wordAt(lyrics, chorus.wordId).start).toBeGreaterThanOrEqual(4)
    expect(wordAt(lyrics, chorus.endWordId!).start).toBeLessThan(10)
    expect(regenerateAuto([], out).filter((a) => a.endWordId)).toHaveLength(2)
    const noModes = suggestAccents(lyrics, rhythm, sections, { sectionModes: false })
    expect(noModes.some((a) => a.endWordId)).toBe(false)
    const minimal = suggestAccents(lyrics, rhythm, sections, { style: 'minimal' })
    expect(minimal.some((a) => a.endWordId)).toBe(false)
  })
})
