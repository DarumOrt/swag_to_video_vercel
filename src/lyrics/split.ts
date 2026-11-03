/**
 * Splitting and merging lines. Word ids never change (accents hang on them); a new line gets the
 * stable id `s:<id of its first word>`, so the same split always produces the same line id.
 */
import type { LyricLine, LyricWord, Lyrics } from '@/shared'

const SPLIT_PREFIX = 's:'

function lineIdFor(lyrics: Lyrics, firstWordId: string): string {
  const taken = new Set(lyrics.lines.map((l) => l.id))
  const base = `${SPLIT_PREFIX}${firstWordId}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

function splitAt(lyrics: Lyrics, lineIndex: number, at: number): Lyrics {
  const line = lyrics.lines[lineIndex]!
  const head: LyricLine = { ...line, words: line.words.slice(0, at) }
  const tail: LyricLine = { id: lineIdFor(lyrics, line.words[at]!.id), words: line.words.slice(at) }
  if (line.section !== undefined) tail.section = line.section
  const lines = [...lyrics.lines]
  lines.splice(lineIndex, 1, head, tail)
  return { ...lyrics, lines }
}

/**
 * Splits the line in two before word `atWordId`. The first part keeps the id, `section` and
 * `stanzaStart`; the second continues the same section. Unknown word or the first word of a line → unchanged.
 */
export function splitLine(lyrics: Lyrics, lineId: string, atWordId: string): Lyrics {
  const lineIndex = lyrics.lines.findIndex((l) => l.id === lineId)
  if (lineIndex < 0) return lyrics
  const at = lyrics.lines[lineIndex]!.words.findIndex((w) => w.id === atWordId)
  return at <= 0 ? lyrics : splitAt(lyrics, lineIndex, at)
}

/**
 * Joins the line with the next one. The result keeps the first line's id, `section` and `stanzaStart`.
 * Last or unknown line → unchanged.
 */
export function mergeLines(lyrics: Lyrics, lineId: string): Lyrics {
  const i = lyrics.lines.findIndex((l) => l.id === lineId)
  const next = lyrics.lines[i + 1]
  if (i < 0 || !next) return lyrics
  const merged: LyricLine = {
    ...lyrics.lines[i]!,
    words: [...lyrics.lines[i]!.words, ...next.words],
  }
  const lines = [...lyrics.lines]
  lines.splice(i, 2, merged)
  return { ...lyrics, lines }
}

/** Splits the line into parts of `n` words (the last may be shorter). `n < 1` → unchanged. */
export function splitLineEvery(lyrics: Lyrics, lineId: string, n: number): Lyrics {
  const step = Math.floor(n)
  const line = lyrics.lines.find((l) => l.id === lineId)
  if (!line || !(step >= 1)) return lyrics
  let out = lyrics
  let currentId = lineId
  for (let at = step; at < line.words.length; at += step) {
    const before = out.lines.length
    out = splitLine(out, currentId, line.words[at]!.id)
    if (out.lines.length === before) break
    currentId = out.lines[out.lines.findIndex((l) => l.id === currentId) + 1]!.id
  }
  return out
}

export interface AutoSplitOptions {
  /** A line with more words is split. Default 6. */
  maxWords?: number
  /** A line with more characters (words + spaces) is split. Default 36. */
  maxChars?: number
  /** Pause (s) that counts as a natural break. Default 0.25. */
  pauseSec?: number
}

const charsOf = (words: readonly LyricWord[]) =>
  words.reduce((sum, w) => sum + w.text.length, 0) + Math.max(words.length - 1, 0)

/** Break quality after word `i-1`: pause length plus a bonus for closing punctuation. */
function breakScore(words: readonly LyricWord[], i: number): number {
  const prev = words[i - 1]!
  const next = words[i]!
  const gap = prev.end !== null && next.start !== null ? Math.max(next.start - prev.end, 0) : 0
  return gap + (/[,;:.!?…—–-]$/.test(prev.text) ? 0.3 : 0)
}

function splitPoints(words: readonly LyricWord[], o: Required<AutoSplitOptions>): number[] {
  if (words.length < 2 || (words.length <= o.maxWords && charsOf(words) <= o.maxChars)) return []
  const lo = Math.max(1, Math.ceil(words.length * 0.25))
  const hi = Math.min(words.length - 1, Math.floor(words.length * 0.75))
  const mid = words.length / 2
  let best = Math.round(mid)
  let bestScore = o.pauseSec
  for (let i = lo; i <= hi; i++) {
    const score = breakScore(words, i)
    // Ties go to the break closest to the middle.
    if (score > bestScore || (score === bestScore && Math.abs(i - mid) < Math.abs(best - mid))) {
      best = i
      bestScore = score
    }
  }
  const left = splitPoints(words.slice(0, best), o)
  const right = splitPoints(words.slice(best), o).map((p) => p + best)
  return [...left, best, ...right]
}

/**
 * Splits every line longer than `maxWords` / `maxChars` into balanced parts, preferring pauses
 * between timed words (and punctuation) over the exact middle. Short lines are untouched.
 */
export function autoSplitLong(lyrics: Lyrics, options: AutoSplitOptions = {}): Lyrics {
  const o = { maxWords: 6, maxChars: 36, pauseSec: 0.25, ...options }
  let out = lyrics
  for (const line of lyrics.lines) {
    const points = splitPoints(line.words, o)
    let currentId = line.id
    for (const at of points) {
      const before = out.lines.length
      out = splitLine(out, currentId, line.words[at]!.id)
      if (out.lines.length === before) break
      // Points ascend, so the line holding word `at` is the new tail.
      currentId = out.lines.find((l) => l.words[0]?.id === line.words[at]!.id)!.id
    }
  }
  return out
}
