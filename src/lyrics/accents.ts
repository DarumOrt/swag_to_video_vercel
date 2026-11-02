/**
 * Accent suggestions without ML, plus pure accent edits for the editor.
 *
 * A word earns points for being a hook word (repeated across chorus lines), ending a line on a
 * downbeat, starting on a (strong) beat, and hitting a drop. The best-scoring words are picked
 * under a density limit; the effect is chosen by the strongest reason and the style.
 */
import type { Accent, AccentEffectId, AudioSection, LyricWord, Lyrics, Rhythm } from '@/shared'
import { flattenWords } from './model'
import { nearestOnset } from './snap'
import { normalizeLine, normalizeWord } from './text'

export type AccentStyle = 'balanced' | 'aggressive' | 'minimal'

/** Why a word was suggested; picks the effect. */
export type AccentReason = 'drop' | 'hook' | 'line-end' | 'beat'

type EffectTable = Record<AccentReason, AccentEffectId> & { light: AccentEffectId }

export const ACCENT_STYLES: Record<AccentStyle, EffectTable> = {
  aggressive: { drop: 'glitch', hook: 'shake', 'line-end': 'flash', beat: 'zoom-punch', light: 'zoom-punch' },
  minimal: { drop: 'fullscreen-word', hook: 'fullscreen-word', 'line-end': 'zoom-punch', beat: 'zoom-punch', light: 'zoom-punch' },
  balanced: { drop: 'flash', hook: 'fullscreen-word', 'line-end': 'zoom-punch', beat: 'zoom-punch', light: 'palette-shift' },
} // prettier-ignore

/** Effects that take over the frame; two of them never follow each other directly. */
export const STRONG_EFFECTS: ReadonlySet<AccentEffectId> = new Set([
  'glitch',
  'shake',
  'flash',
  'invert',
  'fullscreen-word',
  'slow-motion',
])

/** Default timing of each effect: lead-in before the word and length from the word start. */
export const EFFECT_DEFAULTS: Record<AccentEffectId, { preRollSec: number; durationSec: number }> =
  {
    'zoom-punch': { preRollSec: 0.03, durationSec: 0.35 },
    shake: { preRollSec: 0, durationSec: 0.35 },
    glitch: { preRollSec: 0.05, durationSec: 0.3 },
    flash: { preRollSec: 0, durationSec: 0.2 },
    'palette-shift': { preRollSec: 0.05, durationSec: 0.6 },
    'particle-burst': { preRollSec: 0, durationSec: 0.8 },
    'fullscreen-word': { preRollSec: 0, durationSec: 0.6 },
    'slow-motion': { preRollSec: 0.1, durationSec: 1 },
    invert: { preRollSec: 0, durationSec: 0.2 },
  }

const STYLE_INTENSITY: Record<AccentStyle, number> = { aggressive: 1, balanced: 0.8, minimal: 0.6 }

export interface SuggestOptions {
  style: AccentStyle
  /** At most this many accents in any 10-second window. */
  maxPer10Sec: number
  /** Minimum time between two accents. */
  minGapSec: number
  /** A word start within this distance of a beat counts as on the beat. */
  beatToleranceSec: number
  /** Words scoring below this are never suggested. */
  minScore: number
}

export const DEFAULT_SUGGEST: SuggestOptions = {
  style: 'balanced',
  maxPer10Sec: 3,
  minGapSec: 1,
  beatToleranceSec: 0.07,
  minScore: 0.6,
}

const CHORUS_LABEL = /^(?:припев|пре-?припев|хук|chorus|pre-?chorus|hook|refrain)/i
const STOP_WORDS = new Set(
  (
    'и а но в во на с со к по за из у о об от до не ни же ли бы то это я ты он она мы вы они ' +
    'мне меня тебя тебе нас вас мой твой моя твоя как что так там тут где все всё уже ' +
    'the a an and or but to of in on at for with is are be it i you he she we they me my your ' +
    'our his her its this that so oh yeah na la'
  ).split(' '),
)

export interface AccentSuggestion extends Accent {
  source: 'auto'
  reason: AccentReason
  score: number
}

interface Candidate {
  word: LyricWord & { start: number }
  score: number
  reason: AccentReason
}

/**
 * Suggests accents for timed words. Returns accents sorted by time, all with `source: 'auto'`
 * and deterministic ids (`auto:<wordId>`), so regenerating gives the same result.
 * `sections` defaults to none; pass `timeline.audio.sections` when available.
 */
export function suggestAccents(
  lyrics: Lyrics,
  rhythm: Pick<Rhythm, 'beats' | 'downbeats'> & Partial<Pick<Rhythm, 'beatStrength'>>,
  sections: readonly AudioSection[] = [],
  options: Partial<SuggestOptions> = {},
): AccentSuggestion[] {
  const opts = { ...DEFAULT_SUGGEST, ...options }
  const table = ACCENT_STYLES[opts.style]
  const hook = hookScores(lyrics)

  const candidates: Candidate[] = []
  const dropHitDone = new Set<AudioSection>()
  for (const line of lyrics.lines) {
    const timedWords = line.words.filter(
      (w): w is LyricWord & { start: number } => w.start !== null,
    )
    timedWords.forEach((word, k) => {
      const norm = normalizeWord(word.text)
      const minor = norm.length <= 2 || STOP_WORDS.has(norm)
      const parts: Record<AccentReason, number> = { drop: 0, hook: 0, 'line-end': 0, beat: 0 }

      parts.hook = hook.get(norm) ?? 0
      const beat = nearestIndex(rhythm.beats, word.start, opts.beatToleranceSec)
      const onDownbeat = nearestOnset(rhythm.downbeats, word.start, opts.beatToleranceSec) !== null
      if (beat !== null) {
        const strength = rhythm.beatStrength?.[beat] ?? 0.5
        parts.beat = 0.4 * strength + (onDownbeat ? 0.2 : 0)
      }
      if (k === timedWords.length - 1)
        parts['line-end'] = onDownbeat ? 0.6 : beat !== null ? 0.3 : 0

      const section = sections.find((s) => word.start >= s.start && word.start < s.end)
      let bias = 0
      if (section?.kind === 'drop') {
        bias += 0.2
        // The drop hit goes to the first meaningful word of the drop.
        if (!minor && !dropHitDone.has(section)) {
          if (word.start - section.start < 1.5) parts.drop = 0.8
          dropHitDone.add(section)
        }
      } else if (section?.kind === 'build') bias += 0.1

      const reason = (Object.keys(parts) as AccentReason[]).reduce((a, b) =>
        parts[b] > parts[a] ? b : a,
      )
      let score = parts.drop + parts.hook + parts['line-end'] + parts.beat + bias
      if (minor) score *= 0.3
      // Quiet parts get accents only for very strong reasons.
      if (section?.kind === 'quiet') score *= 0.4
      if (score >= opts.minScore) candidates.push({ word, score, reason })
    })
  }

  // Best first, under the density and gap limits.
  const picked: Candidate[] = []
  const byScore = candidates.toSorted((a, b) => b.score - a.score || a.word.start - b.word.start)
  for (const c of byScore) {
    const t = c.word.start
    if (picked.some((p) => Math.abs(p.word.start - t) < opts.minGapSec)) continue
    if (
      !fitsDensity(
        picked.map((p) => p.word.start),
        t,
        opts.maxPer10Sec,
      )
    )
      continue
    picked.push(c)
  }
  picked.sort((a, b) => a.word.start - b.word.start)

  // Effects by reason; no two strong effects in a row (the weaker one gets the light effect).
  const effects = picked.map((c) => table[c.reason])
  for (let i = 1; i < picked.length; i++) {
    if (STRONG_EFFECTS.has(effects[i - 1]!) && STRONG_EFFECTS.has(effects[i]!)) {
      const weaker = picked[i]!.score > picked[i - 1]!.score ? i - 1 : i
      effects[weaker] = STRONG_EFFECTS.has(table.light) ? 'zoom-punch' : table.light
    }
  }

  return picked.map((c, i) => {
    const effect = effects[i]!
    const defaults = EFFECT_DEFAULTS[effect]
    const wordLength = c.word.end !== null ? c.word.end - c.word.start : defaults.durationSec
    return {
      id: `auto:${c.word.id}`,
      wordId: c.word.id,
      effect,
      source: 'auto',
      preRollSec: defaults.preRollSec,
      durationSec:
        effect === 'fullscreen-word' ? clamp(wordLength, 0.3, 1.2) : defaults.durationSec,
      intensity: round2(
        clamp((0.5 + (0.5 * Math.min(c.score, 1.5)) / 1.5) * STYLE_INTENSITY[opts.style], 0, 1),
      ),
      params: {},
      reason: c.reason,
      score: round2(c.score),
    }
  })
}

/**
 * Hook score 0..1 per normalized word: how often it repeats across chorus lines
 * (labeled Припев/Chorus/Hook, or lines that occur more than once). Stop words excluded.
 */
export function hookScores(lyrics: Lyrics): Map<string, number> {
  const lineCounts = new Map<string, number>()
  for (const line of lyrics.lines) {
    const key = normalizeLine(line.words.map((w) => w.text).join(' '))
    lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1)
  }
  const counts = new Map<string, number>()
  for (const line of lyrics.lines) {
    const key = normalizeLine(line.words.map((w) => w.text).join(' '))
    const isChorus =
      (line.section && CHORUS_LABEL.test(line.section)) || (lineCounts.get(key) ?? 0) > 1
    if (!isChorus) continue
    for (const w of line.words) {
      const norm = normalizeWord(w.text)
      if (norm.length <= 2 || STOP_WORDS.has(norm)) continue
      counts.set(norm, (counts.get(norm) ?? 0) + 1)
    }
  }
  const max = Math.max(0, ...counts.values())
  const scores = new Map<string, number>()
  if (max < 2) return scores
  for (const [word, count] of counts) if (count >= 2) scores.set(word, count / max)
  return scores
}

function nearestIndex(times: ArrayLike<number>, t: number, window: number): number | null {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! < t) lo = mid + 1
    else hi = mid
  }
  let best: number | null = null
  for (const k of [lo - 1, lo]) {
    if (k < 0 || k >= times.length || Math.abs(times[k]! - t) > window) continue
    if (best === null || Math.abs(times[k]! - t) < Math.abs(times[best]! - t)) best = k
  }
  return best
}

/** True if adding `t` keeps every 10 s window at ≤ `max` accents. */
function fitsDensity(times: readonly number[], t: number, max: number): boolean {
  const all = [...times, t].sort((a, b) => a - b)
  for (const x of all) {
    if (x < t - 10 || x > t) continue
    if (all.filter((y) => y >= x && y < x + 10).length > max) return false
  }
  return true
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

// ---------------------------------------------------------------------------
// Editor operations
// ---------------------------------------------------------------------------

export type AccentOverrides = Partial<
  Pick<Accent, 'preRollSec' | 'durationSec' | 'intensity' | 'params'>
>

const isUser = (a: Accent) => a.source !== 'auto'

/**
 * Puts a user accent on a word, replacing whatever accent the word had (auto or user).
 * Changing the effect resets its timing to the effect defaults unless overridden;
 * keeping the effect keeps the previous timing and intensity.
 */
export function setAccent(
  accents: readonly Accent[],
  wordId: string,
  effect: AccentEffectId,
  overrides: AccentOverrides = {},
): Accent[] {
  const existing = accents.find((a) => a.wordId === wordId)
  const base =
    existing && existing.effect === effect
      ? existing
      : { ...EFFECT_DEFAULTS[effect], intensity: existing?.intensity ?? 0.8, params: {} }
  const accent: Accent = {
    id: `user:${wordId}`,
    wordId,
    effect,
    source: 'user',
    preRollSec: overrides.preRollSec ?? base.preRollSec,
    durationSec: overrides.durationSec ?? base.durationSec,
    intensity: clamp(overrides.intensity ?? base.intensity, 0, 1),
    params: { ...base.params, ...overrides.params },
  }
  const index = accents.findIndex((a) => a.wordId === wordId)
  const rest = accents.filter((a) => a.wordId !== wordId)
  if (index < 0) return [...rest, accent]
  rest.splice(index, 0, accent)
  return rest
}

/** Removes all accents on a word. */
export function removeAccent(accents: readonly Accent[], wordId: string): Accent[] {
  return accents.filter((a) => a.wordId !== wordId)
}

/**
 * Sets `effect` on every word whose normalized text equals that of `wordId`
 * ("Гори," and "гори" count as the same word). Uses the source word's accent settings if it has one.
 */
export function applyToAllOccurrences(
  lyrics: Lyrics,
  accents: readonly Accent[],
  wordId: string,
  effect: AccentEffectId,
): Accent[] {
  const words = flattenWords(lyrics).map((r) => r.word)
  const source = words.find((w) => w.id === wordId)
  if (!source) return [...accents]
  const norm = normalizeWord(source.text)
  const template = accents.find((a) => a.wordId === wordId && a.effect === effect)
  const overrides: AccentOverrides = template
    ? {
        preRollSec: template.preRollSec,
        durationSec: template.durationSec,
        intensity: template.intensity,
        params: template.params,
      }
    : {}
  let out = [...accents]
  for (const w of words)
    if (normalizeWord(w.text) === norm) out = setAccent(out, w.id, effect, overrides)
  return out
}

/**
 * Replaces auto accents with fresh suggestions; user accents stay as they are, and no suggestion
 * is added on a word that already has a user accent.
 */
export function regenerateAuto(
  accents: readonly Accent[],
  suggestions: readonly Accent[],
): Accent[] {
  const user = accents.filter(isUser)
  const taken = new Set(user.map((a) => a.wordId))
  // Copy contract fields only: suggestions may carry extras (reason, score).
  const auto = suggestions
    .filter((s) => !taken.has(s.wordId))
    .map((s): Accent => ({
      id: s.id,
      wordId: s.wordId,
      effect: s.effect,
      source: 'auto',
      preRollSec: s.preRollSec,
      durationSec: s.durationSec,
      intensity: s.intensity,
      params: { ...s.params },
    }))
  return [...user, ...auto]
}
