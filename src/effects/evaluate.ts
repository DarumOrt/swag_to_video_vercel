/**
 * Accents for one frame: `prepareAccents` resolves them once (word lookup, windows, params),
 * `evaluateAccents` turns (prepared, time) into an `AccentFrame`. Same inputs → same output.
 */

import type { Accent, LyricWord, Timeline } from '@/shared'
import { ACCENT_EFFECTS, envelopeShapeOf, type AccentEffectDef, type FrameBuilder } from './accents'
import { accentWindow, envelopeAt, windowProgress, type AccentWindow, type EnvelopeShape } from './envelope'
import { hash32 } from './math'
import { resolveParams, type ParamValues } from './params'
import { EFFECT_STYLES, type EffectStyleId } from './presets'
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
  window: AccentWindow
  shape: EnvelopeShape
  params: ParamValues
  seed: number
}

export interface PreparedAccents {
  /** Sorted by window start. */
  accents: PreparedAccent[]
}

/** Resolves accents against the lyrics. Accents on missing or untimed words are skipped. */
export function prepareAccents(timeline: Timeline, options: AccentsOptions = {}): PreparedAccents {
  const words = new Map<string, LyricWord>()
  for (const line of timeline.lyrics?.lines ?? []) for (const w of line.words) words.set(w.id, w)
  const styleParams = (options.style && EFFECT_STYLES[options.style]?.accentParams) || {}
  const seed = options.seed ?? 1

  const accents: PreparedAccent[] = []
  for (const accent of timeline.accents) {
    const def = ACCENT_EFFECTS[accent.effect]
    const word = words.get(accent.wordId)
    if (!def || !word || word.start === null) continue
    const params = resolveParams(def.params, { ...styleParams[accent.effect], ...accent.params })
    accents.push({
      accent,
      def,
      word,
      window: accentWindow(word.start, word.end, accent.preRollSec, accent.durationSec),
      shape: envelopeShapeOf(params),
      params,
      seed: hash32(seed, accent.id),
    })
  }
  accents.sort((a, b) => a.window.start - b.window.start)
  return { accents }
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
  for (const p of prepared.accents) {
    if (p.window.start > time) break
    if (time >= p.window.end) continue
    const envelope = envelopeAt(p.window, time, p.shape)
    const intensity = Math.min(Math.max(p.accent.intensity, 0), 1)
    p.def.apply(
      {
        time,
        window: p.window,
        envelope,
        intensity,
        level: envelope * intensity,
        progress: windowProgress(p.window, time),
        sinceHit: time - p.window.wordStart,
        word: p.word,
        params: p.params,
        seed: p.seed,
      },
      out,
    )
    active.push({ accentId: p.accent.id, effect: p.accent.effect, level: envelope * intensity })
  }
  // Stable sort keeps accent order within a kind.
  out.overlays.sort((a, b) => OVERLAY_ORDER[a.kind] - OVERLAY_ORDER[b.kind])
  return { time, camera: out.camera, overlays: out.overlays, post: out.post, timeLag: out.timeLag, active }
}
