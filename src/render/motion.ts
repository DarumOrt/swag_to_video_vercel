/**
 * Generic layer motion the engine applies around any layer: opacity by song section (quiet / build /
 * drop), a beat "kick" (scale + brightness that decays after each beat) and depth (how strongly the
 * layer follows the effects camera — parallax). Pure functions of (timeline, time, camera).
 */

import type { SectionKind, Timeline } from '@/shared'
import type { CameraTransform } from './effectsHost'
import type { BeatInfo } from './rhythm'

export interface LayerMotion {
  /** Opacity multiplier per section kind; missing kinds (and tracks without sections) = 1. */
  sections?: Partial<Record<SectionKind, number>>
  /** Crossfade between section levels, seconds (default 0.6). */
  sectionFadeSec?: number
  /** Scale kick on each beat: 1 + beatScale × strength × decay. */
  beatScale?: number
  /** Opacity kick on each beat (multiplier 1 + beatAlpha × …, capped by the final alpha of 1). */
  beatAlpha?: number
  /** Decay time of the beat kick, seconds (default 0.18). */
  beatDecaySec?: number
  /** Downbeats only (bar starts) for the kick. */
  downbeatsOnly?: boolean
  /** Kick multiplier per section kind (e.g. stronger on drops); missing = 1. */
  beatSections?: Partial<Record<SectionKind, number>>
  /** Scale origin in frame fractions (default center). */
  origin?: [number, number]
  /**
   * Camera follow: 1 = as the effects camera (default), 0 = static, 0.5 = half the movement
   * (far layer), 1.5 = exaggerated (near layer). Ignored for layers with `camera: false`.
   */
  depth?: number
}

export interface MotionState {
  /** Opacity multiplier. */
  alpha: number
  /** Scale around `origin`. */
  scale: number
}

/** Section-dependent level at time t with a crossfade from the previous section. */
export function sectionLevel(
  timeline: Timeline,
  t: number,
  levels: Partial<Record<SectionKind, number>> | undefined,
  fadeSec = 0.6,
): number {
  const sections = timeline.audio.sections
  if (!levels || !sections || sections.length === 0) return 1
  let i = 0
  for (let k = 0; k < sections.length; k++) {
    if ((sections[k]?.start ?? Infinity) <= t) i = k
  }
  const cur = sections[i]
  if (!cur) return 1
  const level = levels[cur.kind] ?? 1
  const prev = sections[i - 1]
  if (!prev || fadeSec <= 0) return level
  const k = Math.min(Math.max((t - cur.start) / fadeSec, 0), 1)
  const from = levels[prev.kind] ?? 1
  // Smoothstep: no visible kink at either end of the fade.
  const e = k * k * (3 - 2 * k)
  return from + (level - from) * e
}

/** Beat kick envelope 0..1 at the current beat. */
export function beatKick(beat: BeatInfo, decaySec: number, downbeatsOnly: boolean): number {
  if (beat.index < 0) return 0
  if (downbeatsOnly && !beat.downbeat) return 0
  return beat.strength * Math.exp(-beat.since / Math.max(decaySec, 1e-3))
}

export function layerMotionAt(
  m: LayerMotion,
  timeline: Timeline,
  time: number,
  beat: BeatInfo,
): MotionState {
  const section = sectionLevel(timeline, time, m.sections, m.sectionFadeSec ?? 0.6)
  let alpha = section
  let scale = 1
  if (m.beatScale || m.beatAlpha) {
    const kick =
      beatKick(beat, m.beatDecaySec ?? 0.18, m.downbeatsOnly === true) *
      sectionLevel(timeline, time, m.beatSections, m.sectionFadeSec ?? 0.6)
    scale += (m.beatScale ?? 0) * kick
    alpha *= 1 + (m.beatAlpha ?? 0) * kick
  }
  return { alpha, scale }
}

/** Camera scaled by depth: zoom, offset and rotation all follow `depth` times as much. */
export function cameraAtDepth(c: Readonly<CameraTransform>, depth: number): CameraTransform {
  if (depth === 1) return { ...c }
  return {
    zoom: Math.pow(Math.max(c.zoom, 1e-3), depth),
    x: c.x * depth,
    y: c.y * depth,
    rotation: c.rotation * depth,
  }
}
