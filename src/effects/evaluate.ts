/**
 * Accents for one frame: `prepareAccents` resolves them once (word lookup, windows, params),
 * `evaluateAccents` turns (prepared, time) into an `AccentFrame`. Same inputs → same output.
 *
 * Several accents may cover the same moment (several on one word, overlapping ranges). They are
 * applied in a fixed order (window start, then accent id) and combine per channel: the camera
 * composes (zoom multiplies, offsets add), post uniforms mix (splits add without cancelling, mixes
 * take the max), overlays stack bottom to top (word, particles, flash).
 */

import { featureIndexAt, type Accent, type AudioAnalysis, type LyricWord, type Timeline } from '@/shared'
import { ACCENT_EFFECTS, envelopeShapeOf, type AccentAudio, type AccentEffectDef, type FrameBuilder } from './accents'
import {
  accentWindow,
  envelopeAt,
  isHolding,
  windowProgress,
  type AccentWindow,
  type EnvelopeShape,
} from './envelope'
import { clamp01, hash32 } from './math'
import { num, resolveParams, type ParamValues } from './params'
import { EFFECT_STYLES, type EffectStyleId } from './presets'
import { beatAt } from './rhythm'
import { IDENTITY_CAMERA, NEUTRAL_POST, type AccentFrame, type OverlayItem } from './types'

export interface AccentsOptions {
  /** Style whose accent param defaults apply under each accent's own params. */
  style?: EffectStyleId
  /** Mixed with each accent id into the accent's random seed. */
  seed?: number
}

interface PreparedAccent {
  accent: Accent
  def: AccentEffectDef
  word: LyricWord
  /** Timed words covered: [word] for a one-shot, the range otherwise. */
  words: LyricWord[]
  window: AccentWindow
  shape: EnvelopeShape
  params: ParamValues
  seed: number
}

export interface PreparedAccents {
  /** Sorted by window start, then accent id. */
  accents: PreparedAccent[]
  audio: AudioAnalysis | null
  /** rms that counts as "full loudness" (95th percentile of the track), > 0. */
  loudnessRef: number
}

/** Beat pulse decay for audio-reactive accents, seconds. */
const PULSE_DECAY_SEC = 0.16
const FALLBACK_BEAT_SEC = 0.5

/** Range end of a word: its end, else the next word's start, else a short default. */
function wordEndTime(words: readonly LyricWord[], index: number): number {
  const w = words[index]
  if (!w || w.start === null) return NaN
  if (w.end !== null) return w.end
  const next = words.slice(index + 1).find((x) => x.start !== null)
  return Math.min(next?.start ?? Infinity, w.start + 0.4)
}

/** Resolves accents against the lyrics. Accents on missing or untimed words are skipped. */
export function prepareAccents(timeline: Timeline, options: AccentsOptions = {}): PreparedAccents {
  const order: LyricWord[] = []
  for (const line of timeline.lyrics?.lines ?? []) for (const w of line.words) order.push(w)
  const indexOf = new Map(order.map((w, i) => [w.id, i]))
  const styleParams = (options.style && EFFECT_STYLES[options.style]?.accentParams) || {}
  const seed = options.seed ?? 1

  const accents: PreparedAccent[] = []
  for (const accent of timeline.accents) {
    const def = ACCENT_EFFECTS[accent.effect]
    const first = indexOf.get(accent.wordId)
    const word = first === undefined ? undefined : order[first]
    if (!def || !word || word.start === null || first === undefined) continue
    const params = resolveParams(def.params, { ...styleParams[accent.effect], ...accent.params })

    // A range needs an end word at or after the first one; anything else is a one-shot.
    let words = [word]
    let holdUntil: number | undefined
    const last = accent.endWordId === undefined ? undefined : indexOf.get(accent.endWordId)
    if (last !== undefined && last > first) {
      words = order.slice(first, last + 1).filter((w) => w.start !== null)
      let end = NaN
      for (let i = last; i >= first && !Number.isFinite(end); i--) end = wordEndTime(order, i)
      if (Number.isFinite(end)) holdUntil = end
      else words = [word]
    } else if (last === first) {
      holdUntil = wordEndTime(order, first)
    }

    accents.push({
      accent,
      def,
      word,
      words,
      window: accentWindow(word.start, word.end, accent.preRollSec, accent.durationSec, holdUntil),
      shape: envelopeShapeOf(params),
      params,
      seed: hash32(seed, accent.id),
    })
  }
  accents.sort(
    (a, b) => a.window.start - b.window.start || (a.accent.id < b.accent.id ? -1 : a.accent.id > b.accent.id ? 1 : 0),
  )
  const audio = timeline.audio ?? null
  return { accents, audio, loudnessRef: audio ? loudnessReference(audio.features?.rms) : 1 }
}

/** 95th percentile of rms (sampled), so loudness 1 ≈ the loud parts of this track. */
export function loudnessReference(rms: ArrayLike<number> | undefined): number {
  if (!rms || rms.length === 0) return 1
  const step = Math.max(1, Math.floor(rms.length / 4000))
  const sample: number[] = []
  for (let i = 0; i < rms.length; i += step) sample.push(rms[i] ?? 0)
  sample.sort((a, b) => a - b)
  return Math.max(sample[Math.floor((sample.length - 1) * 0.95)] ?? 0, 1e-3)
}

export function accentAudioAt(prepared: PreparedAccents, time: number): AccentAudio {
  const audio = prepared.audio
  if (!audio) return { pulse: 0, loudness: 0, beatIndex: -1, beatTime: 0, beatInterval: FALLBACK_BEAT_SEC }
  const beat = beatAt(audio, time)
  const beats = audio.rhythm.beats
  const beatTime = beat.index >= 0 ? (beats[beat.index] ?? 0) : 0
  const next = beats[beat.index + 1]
  const prev = beats[beat.index - 1]
  const beatInterval =
    next !== undefined ? next - beatTime : prev !== undefined ? beatTime - prev : FALLBACK_BEAT_SEC
  const features = audio.features
  const rms = features?.rms?.[featureIndexAt(features, time)] ?? 0
  return {
    pulse: beat.index >= 0 ? beat.strength * Math.exp(-beat.since / PULSE_DECAY_SEC) : 0,
    loudness: clamp01(rms / prepared.loudnessRef),
    beatIndex: beat.index,
    beatTime,
    beatInterval,
  }
}

const OVERLAY_ORDER: Record<OverlayItem['kind'], number> = { word: 0, particles: 1, flash: 2 }

export function evaluateAccents(prepared: PreparedAccents, time: number): AccentFrame {
  const out: FrameBuilder = {
    camera: { ...IDENTITY_CAMERA },
    overlays: [],
    post: { ...NEUTRAL_POST },
    timeLag: 0,
  }
  const active: AccentFrame['active'] = []
  let audio: AccentAudio | null = null
  for (const p of prepared.accents) {
    if (p.window.start > time) break
    if (time >= p.window.end) continue
    audio ??= accentAudioAt(prepared, time)
    const envelope = envelopeAt(p.window, time, p.shape)
    const intensity = Math.min(Math.max(p.accent.intensity, 0), 1)
    const holding = isHolding(p.window, time)
    // While a range holds, the level breathes with beats and loudness.
    const breathe = holding ? num(p.params, 'breathe') : 0
    const breath = 1 - breathe + breathe * clamp01(0.7 * audio.pulse + 0.3 * audio.loudness)
    const level = envelope * intensity * breath
    p.def.apply(
      {
        time,
        window: p.window,
        envelope,
        intensity,
        level,
        holding,
        progress: windowProgress(p.window, time),
        sinceHit: time - p.window.wordStart,
        word: p.word,
        words: p.words,
        audio,
        params: p.params,
        seed: p.seed,
      },
      out,
    )
    active.push({ accentId: p.accent.id, effect: p.accent.effect, level, holding })
  }
  // Stable sort keeps accent order within a kind.
  out.overlays.sort((a, b) => OVERLAY_ORDER[a.kind] - OVERLAY_ORDER[b.kind])
  return { time, camera: out.camera, overlays: out.overlays, post: out.post, timeLag: out.timeLag, active }
}
