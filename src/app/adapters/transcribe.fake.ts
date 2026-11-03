/**
 * FAKE lyrics recognition for UI work without loading Whisper (dev: open the app with `?fake-asr`).
 *
 * Fake words: in dev, if `test-media/<track name>.txt` exists, its words are used with
 * dropped/garbled words and random confidences (a stand-in for an imperfect recognizer);
 * otherwise a few generic phrases. Words are spread over the vocal regions of the track.
 * The text is fetched at runtime and never copied into the code.
 */
import { tokenizeLine, wordWeight, type RecognizedWord } from '@/lyrics'
import type { Timeline } from '@/shared'

import type { TranscribeJob } from './transcribe'

const FALLBACK_PHRASES = [
  'ночной город не спит',
  'огни бегут по стеклу',
  'я снова слышу этот ритм',
  'we keep moving through the night',
  'голос тонет в басах',
]

export async function transcribeFake(job: TranscribeJob): Promise<RecognizedWord[]> {
  const source = (await fetchDevLyrics(job.file.name)) ?? FALLBACK_PHRASES.join('\n')
  const tokens = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[.*\]\s*$/.test(line))
    .flatMap((line) => tokenizeLine(line))

  // Pretend to work for a moment so progress UI can be checked.
  for (let step = 1; step <= 10; step++) {
    job.signal.throwIfAborted()
    await new Promise((resolve) => setTimeout(resolve, 120))
    job.onProgress({ stage: 'recognize', fraction: step / 10, note: null })
  }

  return fakeRecognition(tokens, job.timeline)
}

async function fetchDevLyrics(trackName: string): Promise<string | null> {
  if (!import.meta.env.DEV) return null
  const base = trackName.replace(/\.[^.]+$/, '').replace(/^[\w.]+\.App - /, '') // downloader prefix
  try {
    const response = await fetch(`/test-media/${encodeURIComponent(base)}.txt`)
    if (!response.ok || !response.headers.get('content-type')?.includes('text')) return null
    return await response.text()
  } catch {
    return null
  }
}

function fakeRecognition(tokens: string[], timeline: Timeline): RecognizedWord[] {
  const random = seeded(tokens.length)
  const duration = timeline.audio.durationSec
  const regions = timeline.audio.vocalActivity.length
    ? timeline.audio.vocalActivity
    : [{ start: duration * 0.08, end: duration * 0.92 }]
  const totalSpan = regions.reduce((sum, region) => sum + (region.end - region.start), 0)
  const totalWeight = tokens.reduce((sum, token) => sum + wordWeight(token), 0) || 1

  const words: RecognizedWord[] = []
  let regionIndex = 0
  let cursor = regions[0]?.start ?? 0
  for (const token of tokens) {
    const length = (wordWeight(token) / totalWeight) * totalSpan
    let region = regions[regionIndex]
    while (region && cursor + length > region.end && regionIndex < regions.length - 1) {
      region = regions[++regionIndex]
      cursor = region?.start ?? cursor
    }
    const start = cursor
    cursor += length
    const roll = random()
    if (roll < 0.12) continue // missed by the recognizer
    const text = roll < 0.22 ? garble(token, random) : token
    const confidence = roll < 0.3 ? 0.2 + random() * 0.25 : 0.6 + random() * 0.4
    words.push({ text, start, end: start + length * 0.85, confidence })
  }
  return words
}

function garble(word: string, random: () => number): string {
  if (word.length < 3) return word
  const at = 1 + Math.floor(random() * (word.length - 2))
  return word.slice(0, at) + word.slice(at + 1)
}

/** Deterministic PRNG (mulberry32) so the fake output is stable per text. */
function seeded(seed: number): () => number {
  let state = seed + 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
