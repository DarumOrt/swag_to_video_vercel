/**
 * Drop bursts (`drop-bursts`, the "edit" look): inside drops — or every peak section — short series
 * of strobe blinks or RGB splits on the beat grid. Which bars get a series, its length, kind and blink
 * rate are picked by the seed, so another seed gives another pattern. Pure: (audio, time, seed,
 * params, shot role); nothing is carried between frames.
 */

import type { AudioAnalysis, SectionRole } from '@/shared'
import { rand } from './math'
import { num, str, type LocalizedText, type ParamSpec, type ParamValues } from './params'
import { beatAt } from './rhythm'
import { sectionAt, shotGain, type Shot } from './sections'
import { IDENTITY_CAMERA, NEUTRAL_POST, type CameraTransform, type FlashOverlay, type PostDynamics } from './types'

export type BurstKind = 'strobe' | 'rgb'

const l = (ru: string, en: string): LocalizedText => ({ ru, en })

export const BURST_PARAMS: ParamSpec[] = [
  { key: 'amount', type: 'number', label: l('Сила', 'Amount'), min: 0, max: 1, step: 0.01, default: 0.8 },
  {
    key: 'density',
    type: 'number',
    label: l('Частота серий', 'Series density'),
    hint: l('Доля тактов с серией вспышек или сдвигов', 'Share of bars that get a series'),
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: 'sections',
    type: 'enum',
    label: l('Где', 'Where'),
    options: [
      { value: 'drop', label: l('Только дропы', 'Drops only') },
      { value: 'peak', label: l('Дропы и припевы', 'Drops and choruses') },
    ],
    default: 'drop',
  },
  {
    key: 'kinds',
    type: 'enum',
    label: l('Серии', 'Series'),
    options: [
      { value: 'auto', label: l('Строб и RGB, по сиду', 'Strobe and RGB, by seed') },
      { value: 'strobe', label: l('Строб', 'Strobe') },
      { value: 'rgb', label: l('RGB-сдвиг', 'RGB split') },
    ],
    default: 'auto',
  },
  { key: 'color', type: 'color', label: l('Цвет строба', 'Strobe color'), default: '#ffffff' },
]

const ROLE_SETS: Readonly<Record<string, readonly SectionRole[]>> = {
  drop: ['drop'],
  peak: ['drop', 'chorus'],
}

/** Beats per bar for picking series (the beat grid, not the downbeats: works without them). */
const BAR = 4
const FALLBACK_BEAT_SEC = 0.5

export interface BurstFrame {
  kind: BurstKind | null
  camera: CameraTransform
  flash: FlashOverlay | null
  post: PostDynamics
}

/** The burst at time t, or a neutral frame (kind null) outside a series. */
export function burstAt(
  audio: AudioAnalysis,
  t: number,
  params: ParamValues,
  seed: number,
  shot?: Shot,
): BurstFrame {
  const out: BurstFrame = { kind: null, camera: { ...IDENTITY_CAMERA }, flash: null, post: { ...NEUTRAL_POST } }
  const amount = num(params, 'amount') * shotGain(shot)
  if (amount <= 0) return out
  const role = shot && shot.index >= 0 ? shot.role : sectionAt(audio, t)?.role
  if (!role || !(ROLE_SETS[str(params, 'sections')] ?? ROLE_SETS.drop)?.includes(role)) return out

  const beat = beatAt(audio, t)
  if (beat.index < 0) return out
  const bar = Math.floor(beat.index / BAR)
  const pos = beat.index % BAR
  const r = (i: number) => rand(seed, bar * 5 + i)
  if (r(0) >= num(params, 'density')) return out
  // A series fills the last 1–2 beats of the bar.
  const len = 1 + Math.floor(r(1) * 2)
  if (pos < BAR - len) return out
  const kinds = str(params, 'kinds')
  const kind: BurstKind = kinds === 'strobe' || kinds === 'rgb' ? kinds : r(2) < 0.5 ? 'strobe' : 'rgb'
  const rate = r(3) < 0.5 ? 2 : 4

  const beats = audio.rhythm.beats
  const time = beats[beat.index] ?? t
  const next = beats[beat.index + 1]
  const interval = next !== undefined && next > time ? next - time : FALLBACK_BEAT_SEC
  const phase = (beat.since / interval) * rate
  if (phase >= rate) return out
  const blink = Math.floor(phase)
  const p = phase - blink
  // Blink counter across the series: alternates colors / split directions.
  const n = (pos - (BAR - len)) * rate + blink
  out.kind = kind
  if (kind === 'strobe') {
    if (p < 0.5) {
      const dark = n % 2 === 1 && r(4) < 0.5
      out.flash = {
        kind: 'flash',
        color: dark ? '#000000' : str(params, 'color'),
        alpha: Math.min(amount, 1),
        blend: dark ? 'normal' : 'screen',
      }
    }
    out.camera.zoom *= 1 + 0.04 * amount * (1 - p)
  } else {
    const sign = n % 2 === 0 ? 1 : -1
    out.post.rgbSplit = sign * 0.035 * amount * (1 - 0.6 * p)
    out.post.rgbSplitY = 0.01 * amount * (rand(seed ^ 0x27d4eb2f, bar * 16 + n) - 0.5)
    out.camera.x += 0.01 * amount * sign * (1 - p)
  }
  return out
}
