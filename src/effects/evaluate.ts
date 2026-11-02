/**
 * Effects for one frame: `prepareEffects` resolves accents once (word lookup, windows, params),
 * `evaluateEffects` turns (prepared, time) into an `EffectFrame`. Same inputs → same output.
 */

import type { Accent, LyricWord, Timeline } from '@/shared'
import { ACCENT_EFFECTS, envelopeShapeOf, type AccentEffectDef, type FrameBuilder } from './accents'
import { accentWindow, envelopeAt, windowProgress, type AccentWindow, type EnvelopeShape } from './envelope'
import { hash32 } from './math'
import { resolveParams, type ParamValues } from './params'
import { normalizePostSettings, type DeepPartial, type PostSettings } from './post/settings'
import { EFFECT_STYLES, type EffectStyleId } from './presets'
import { applyRhythm, type RhythmSettings } from './rhythm'
import { IDENTITY_CAMERA, NEUTRAL_POST, type EffectFrame, type OverlayItem } from './types'

/** What a scene says about effects (serializable). Everything optional. */
export interface EffectsConfigInput {
  style?: EffectStyleId
  /** Overrides on top of the style. */
  rhythm?: Partial<RhythmSettings>
  post?: DeepPartial<PostSettings>
  /** false = ignore timeline accents. */
  accents?: boolean
  seed?: number
}

export interface EffectsConfig {
  style: EffectStyleId
  rhythm: RhythmSettings
  post: PostSettings
  accents: boolean
  seed: number
}

export function resolveEffectsConfig(input: EffectsConfigInput = {}): EffectsConfig {
  const style = EFFECT_STYLES[input.style ?? 'studio'] ?? EFFECT_STYLES.studio
  const post = input.post
  return {
    style: style.id,
    rhythm: { ...style.rhythm, ...input.rhythm },
    post: normalizePostSettings({
      bloom: { ...style.post.bloom, ...post?.bloom },
      chroma: { ...style.post.chroma, ...post?.chroma },
      grain: { ...style.post.grain, ...post?.grain },
      vhs: { ...style.post.vhs, ...post?.vhs },
      vignette: { ...style.post.vignette, ...post?.vignette },
      color: { ...style.post.color, ...post?.color },
    }),
    accents: input.accents ?? true,
    seed: input.seed ?? 1,
  }
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

export interface PreparedEffects {
  timeline: Timeline
  config: EffectsConfig
  /** Sorted by window start. */
  accents: PreparedAccent[]
}

/** Resolves accents against the lyrics. Accents on missing or untimed words are skipped. */
export function prepareEffects(timeline: Timeline, config: EffectsConfig): PreparedEffects {
  const words = new Map<string, LyricWord>()
  for (const line of timeline.lyrics?.lines ?? []) for (const w of line.words) words.set(w.id, w)
  const styleParams = EFFECT_STYLES[config.style]?.accentParams ?? {}

  const accents: PreparedAccent[] = []
  if (config.accents) {
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
        seed: hash32(config.seed, accent.id),
      })
    }
  }
  accents.sort((a, b) => a.window.start - b.window.start)
  return { timeline, config, accents }
}

const OVERLAY_ORDER: Record<OverlayItem['kind'], number> = { word: 0, particles: 1, flash: 2 }

export function evaluateEffects(prepared: PreparedEffects, time: number): EffectFrame {
  const { timeline, config } = prepared
  const out: FrameBuilder = {
    camera: { ...IDENTITY_CAMERA },
    overlays: [],
    post: { ...NEUTRAL_POST },
    timeLag: 0,
  }

  const { beat, drop } = applyRhythm(timeline.audio, time, config.rhythm, config.seed, out)

  const active: EffectFrame['active'] = []
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

  return {
    time,
    layerTime: Math.max(0, time - out.timeLag),
    camera: out.camera,
    overlays: out.overlays,
    post: out.post,
    beat,
    drop,
    active,
  }
}
