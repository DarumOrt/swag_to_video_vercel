/**
 * Reaction to the rhythm: camera pulse on beats, flashes on strong beats, boost inside drops.
 * Uses `rhythm.beatStrength` and `audio.sections` when present, with fallbacks when they are not:
 * downbeats count as strong (1), other beats as medium (0.6); without sections there is no drop.
 */

import type { AudioAnalysis } from '@/shared'
import { clamp01, lastIndexAtOrBefore, noise1 } from './math'
import { num, str, type LocalizedText, type ParamSpec, type ParamValues } from './params'
import { effectMood, SECTION_REACT_PARAM, type Shot } from './sections'
import type { CameraTransform, FlashOverlay } from './types'

const FALLBACK_DOWNBEAT = 1
const FALLBACK_BEAT = 0.6
const DROP_RAMP_SEC = 0.2

export interface BeatState {
  /** Index into rhythm.beats of the last beat at or before t, -1 before the first. */
  index: number
  /** Seconds since that beat (Infinity before the first). */
  since: number
  /** 0..1 */
  strength: number
}

export function beatAt(audio: AudioAnalysis, t: number): BeatState {
  const { beats, beatStrength, downbeats } = audio.rhythm
  const index = lastIndexAtOrBefore(beats, t + 1e-6)
  if (index < 0) return { index, since: Infinity, strength: 0 }
  const time = beats[index] ?? 0
  const s = beatStrength?.[index]
  let strength: number
  if (s !== undefined && Number.isFinite(s)) strength = clamp01(s)
  else {
    const d = lastIndexAtOrBefore(downbeats, time + 1e-3)
    strength = d >= 0 && Math.abs((downbeats[d] ?? -1) - time) < 2e-3 ? FALLBACK_DOWNBEAT : FALLBACK_BEAT
  }
  return { index, since: Math.max(t - time, 0), strength }
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

/** Beat pulse 0..1 (strength × exponential decay), multiplied by `dropBoost` inside drops. */
export function beatPulse(audio: AudioAnalysis, t: number, decaySec: number, dropBoost = 1): number {
  const beat = beatAt(audio, t)
  if (beat.index < 0) return 0
  const pulse = beat.strength * Math.exp(-beat.since / Math.max(decaySec, 0.01))
  return pulse * (1 + (dropBoost - 1) * dropAmountAt(audio, t))
}

const l = (ru: string, en: string): LocalizedText => ({ ru, en })
const n = (key: string, label: LocalizedText, min: number, max: number, step: number, def: number, unit?: string): ParamSpec =>
  ({ key, type: 'number', label, min, max, step, default: def, unit })

// ---------------------------------------------------------------------------
// beat-camera
// ---------------------------------------------------------------------------

export const BEAT_CAMERA_PARAMS: ParamSpec[] = [
  n('amount', l('Пульс зума', 'Zoom pulse'), 0, 0.15, 0.001, 0.025),
  n('shake', l('Толчок', 'Kick shake'), 0, 0.04, 0.001, 0.004),
  n('rotation', l('Поворот на долю', 'Beat rotation'), 0, 4, 0.1, 0, '°'),
  {
    ...n('tilt', l('3D-наклон на долю', 'Beat 3D tilt'), 0, 12, 0.5, 0, '°'),
    hint: l('Камера кивает в глубину на долях (перспектива в 3D-сцене)', 'The camera nods in depth on beats (perspective in a 3D scene)'),
  },
  n('sway', l('Покачивание', 'Sway'), 0, 0.03, 0.001, 0.004),
  n('decay', l('Затухание', 'Decay'), 0.04, 0.6, 0.01, 0.14, 's'),
  n('dropBoost', l('Усиление в дропе', 'Drop boost'), 1, 4, 0.05, 1.7),
  SECTION_REACT_PARAM,
]

const DEG = Math.PI / 180

/**
 * Adds the beat reaction to `cam` (mutates). `params` resolved against BEAT_CAMERA_PARAMS. With a
 * `shot` (render host) the section mood follows the director's shot.
 */
export function applyBeatCamera(
  audio: AudioAnalysis,
  t: number,
  params: ParamValues,
  seed: number,
  cam: CameraTransform,
  shot?: Shot,
): void {
  const beat = beatAt(audio, t)
  // Section energy: a restrained intro, tension growing in the build, full swing in the drop.
  const energy = effectMood(audio, t, params, shot).energy
  const p = beatPulse(audio, t, num(params, 'decay'), num(params, 'dropBoost')) * energy
  const shake = num(params, 'shake')
  const sway = num(params, 'sway') * Math.sqrt(energy)
  cam.zoom *= 1 + num(params, 'amount') * p
  // Kick: a direction picked per beat, decaying with the pulse.
  cam.x += shake * p * noise1(seed, beat.index * 1.37)
  cam.y += shake * p * noise1(seed ^ 0x9e3779b9, beat.index * 1.37)
  cam.rotation += num(params, 'rotation') * DEG * p * (beat.index % 2 === 0 ? 1 : -1)
  // Depth nod: a seeded swing per beat (yaw) and a lean forward (pitch).
  const tilt = num(params, 'tilt') * DEG * p
  if (tilt !== 0) {
    cam.tiltY = (cam.tiltY ?? 0) + tilt * noise1(seed ^ 0x165667b1, beat.index * 1.37 + 0.5)
    cam.tiltX = (cam.tiltX ?? 0) + tilt * 0.5 * (0.5 + 0.5 * noise1(seed ^ 0xd3a2646c, beat.index * 1.37))
  }
  // Slow ambient drift ("handheld").
  cam.x += sway * noise1(seed ^ 0x85ebca6b, t * 0.35)
  cam.y += sway * noise1(seed ^ 0xc2b2ae35, t * 0.29)
  cam.rotation += sway * 0.6 * noise1(seed ^ 0x27d4eb2f, t * 0.23)
}

// ---------------------------------------------------------------------------
// beat-flash
// ---------------------------------------------------------------------------

export const BEAT_FLASH_PARAMS: ParamSpec[] = [
  n('amount', l('Яркость', 'Opacity'), 0, 1, 0.01, 0.2),
  n('threshold', l('Порог силы доли', 'Beat strength threshold'), 0, 1, 0.01, 0.85),
  n('decay', l('Затухание', 'Decay'), 0.03, 0.5, 0.01, 0.09, 's'),
  { key: 'color', type: 'color', label: l('Цвет', 'Color'), default: '#ffffff' },
  n('dropBoost', l('Усиление в дропе', 'Drop boost'), 1, 3, 0.05, 1.5),
  SECTION_REACT_PARAM,
]

/** Flash on strong beats; inside a drop weaker beats flash too. null when nothing to draw. */
export function beatFlash(audio: AudioAnalysis, t: number, params: ParamValues, shot?: Shot): FlashOverlay | null {
  const amount = num(params, 'amount')
  if (amount <= 0) return null
  const beat = beatAt(audio, t)
  if (beat.index < 0) return null
  const drop = dropAmountAt(audio, t)
  if (beat.strength < num(params, 'threshold') * (1 - 0.35 * drop)) return null
  const energy = effectMood(audio, t, params, shot).energy
  const boost = (1 + (num(params, 'dropBoost') - 1) * drop) * energy * energy
  const alpha = clamp01(amount * boost * Math.exp(-beat.since / Math.max(num(params, 'decay'), 0.01)))
  if (alpha < 0.003) return null
  return { kind: 'flash', color: str(params, 'color'), alpha, blend: 'screen' }
}
