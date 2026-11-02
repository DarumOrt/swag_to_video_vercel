/**
 * Reaction to the rhythm: camera pulse on beats, flashes on strong beats, boost inside drops.
 * Uses `rhythm.beatStrength` and `audio.sections` when present, with fallbacks when they are not:
 * downbeats count as strong (1), other beats as medium (0.6); without sections there is no drop.
 */

import type { AudioAnalysis } from '@/shared'
import type { FrameBuilder } from './accents'
import { clamp01, lastIndexAtOrBefore, noise1 } from './math'
import type { LocalizedText, ParamSpec } from './params'

export interface RhythmSettings {
  enabled: boolean
  /** Zoom added on a full-strength beat (0.03 = +3%). */
  zoom: number
  /** Camera kick on a beat, units. */
  shake: number
  /** Slow ambient drift ("handheld"), units. */
  sway: number
  /** Beat pulse decay time constant, seconds. */
  decaySec: number
  /** Flash alpha on strong beats (0 = off). */
  flash: number
  /** Beats at least this strong flash, 0..1. */
  flashThreshold: number
  flashColor: string
  /** Multiplier for every beat reaction inside a drop (1 = no boost). */
  dropBoost: number
  /** Bloom multiplier added on a beat (0.5 → bloom ×1.5 at the hit). */
  bloomPulse: number
  /** Chromatic aberration added on a beat, fraction of the width. */
  chromaPulse: number
}

export const DEFAULT_RHYTHM: RhythmSettings = {
  enabled: true,
  zoom: 0.025,
  shake: 0.004,
  sway: 0.004,
  decaySec: 0.14,
  flash: 0,
  flashThreshold: 0.85,
  flashColor: '#ffffff',
  dropBoost: 1.7,
  bloomPulse: 0.4,
  chromaPulse: 0.0015,
}

const l = (ru: string, en: string): LocalizedText => ({ ru, en })

export const RHYTHM_PARAM_SPECS: ParamSpec[] = [
  { key: 'enabled', type: 'boolean', label: l('Реакция на ритм', 'React to rhythm'), default: true },
  { key: 'zoom', type: 'number', label: l('Пульс камеры', 'Camera pulse'), min: 0, max: 0.15, step: 0.001, default: DEFAULT_RHYTHM.zoom },
  { key: 'shake', type: 'number', label: l('Толчок', 'Kick shake'), min: 0, max: 0.04, step: 0.001, default: DEFAULT_RHYTHM.shake },
  { key: 'sway', type: 'number', label: l('Покачивание', 'Sway'), min: 0, max: 0.03, step: 0.001, default: DEFAULT_RHYTHM.sway },
  { key: 'decaySec', type: 'number', label: l('Затухание', 'Decay'), min: 0.04, max: 0.6, step: 0.01, default: DEFAULT_RHYTHM.decaySec, unit: 's' },
  { key: 'flash', type: 'number', label: l('Вспышки на сильных долях', 'Flash on strong beats'), min: 0, max: 1, step: 0.01, default: DEFAULT_RHYTHM.flash },
  { key: 'flashThreshold', type: 'number', label: l('Порог вспышки', 'Flash threshold'), min: 0, max: 1, step: 0.01, default: DEFAULT_RHYTHM.flashThreshold },
  { key: 'flashColor', type: 'color', label: l('Цвет вспышки', 'Flash color'), default: DEFAULT_RHYTHM.flashColor },
  { key: 'dropBoost', type: 'number', label: l('Усиление в дропе', 'Drop boost'), min: 1, max: 4, step: 0.05, default: DEFAULT_RHYTHM.dropBoost },
  { key: 'bloomPulse', type: 'number', label: l('Пульс свечения', 'Bloom pulse'), min: 0, max: 2, step: 0.05, default: DEFAULT_RHYTHM.bloomPulse },
  { key: 'chromaPulse', type: 'number', label: l('Пульс аберрации', 'Aberration pulse'), min: 0, max: 0.01, step: 0.0005, default: DEFAULT_RHYTHM.chromaPulse },
]

const FALLBACK_DOWNBEAT = 1
const FALLBACK_BEAT = 0.6
const DROP_RAMP_SEC = 0.2

export interface BeatState {
  /** Index into rhythm.beats of the last beat at or before t, -1 before the first. */
  index: number
  /** Seconds since that beat. */
  since: number
  /** 0..1 */
  strength: number
}

export function beatAt(audio: AudioAnalysis, t: number): BeatState {
  const { beats, beatStrength, downbeats } = audio.rhythm
  const index = lastIndexAtOrBefore(beats, t)
  if (index < 0) return { index, since: Infinity, strength: 0 }
  const time = beats[index] ?? 0
  return { index, since: t - time, strength: beatStrengthOf(index, time, beatStrength, downbeats) }
}

function beatStrengthOf(
  index: number,
  time: number,
  beatStrength: Float32Array | undefined,
  downbeats: Float32Array,
): number {
  const s = beatStrength?.[index]
  if (s !== undefined && Number.isFinite(s)) return clamp01(s)
  const d = lastIndexAtOrBefore(downbeats, time + 1e-3)
  const isDown = d >= 0 && Math.abs((downbeats[d] ?? -1) - time) < 2e-3
  return isDown ? FALLBACK_DOWNBEAT : FALLBACK_BEAT
}

/** 0..1: how deep t is inside a `drop` section, with short ramps at the edges. 0 without sections. */
export function dropAmountAt(audio: AudioAnalysis, t: number): number {
  const sections = audio.sections
  if (!sections) return 0
  for (const s of sections) {
    if (s.kind !== 'drop' || t < s.start - DROP_RAMP_SEC || t >= s.end) continue
    const rampIn = clamp01((t - s.start + DROP_RAMP_SEC) / DROP_RAMP_SEC)
    const rampOut = clamp01((s.end - t) / DROP_RAMP_SEC)
    return Math.min(rampIn, rampOut)
  }
  return 0
}

/** Adds the rhythm reaction to the frame; returns the beat pulse and drop amount. */
export function applyRhythm(
  audio: AudioAnalysis,
  t: number,
  settings: RhythmSettings,
  seed: number,
  out: FrameBuilder,
): { beat: number; drop: number } {
  const drop = dropAmountAt(audio, t)
  const beat = beatAt(audio, t)
  const pulse =
    beat.index >= 0 ? beat.strength * Math.exp(-beat.since / Math.max(settings.decaySec, 0.01)) : 0
  if (!settings.enabled) return { beat: pulse, drop }

  const boost = 1 + (settings.dropBoost - 1) * drop
  const p = pulse * boost
  out.camera.zoom *= 1 + settings.zoom * p
  // Kick: a direction picked per beat, decaying with the pulse.
  out.camera.x += settings.shake * p * noise1(seed, beat.index * 1.37)
  out.camera.y += settings.shake * p * noise1(seed ^ 0x9e3779b9, beat.index * 1.37)
  out.camera.x += settings.sway * noise1(seed ^ 0x85ebca6b, t * 0.35)
  out.camera.y += settings.sway * noise1(seed ^ 0xc2b2ae35, t * 0.29)
  out.camera.rotation += settings.sway * 0.6 * noise1(seed ^ 0x27d4eb2f, t * 0.23)

  out.post.bloomBoost += settings.bloomPulse * p
  out.post.chroma += settings.chromaPulse * p

  if (settings.flash > 0 && beat.index >= 0) {
    // Inside a drop weaker beats flash too.
    const threshold = settings.flashThreshold * (1 - 0.35 * drop)
    if (beat.strength >= threshold) {
      const alpha = settings.flash * Math.exp(-beat.since / 0.09) * Math.min(boost, 1.5)
      if (alpha > 0.002) {
        out.overlays.push({ kind: 'flash', color: settings.flashColor, alpha: clamp01(alpha), blend: 'screen' })
      }
    }
  }
  return { beat: pulse, drop }
}
