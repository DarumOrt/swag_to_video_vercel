/**
 * The director: a layer above the scene that turns the song structure into a "story". Each section
 * (`sectionRole`: intro / verse / chorus / drop / bridge…) gets a shot — which layers lead, how the
 * text is laid out, how the camera moves, how hard everything reacts — and section changes get a
 * transition (cut, dip to black, flash, zoom, whip, glitch).
 *
 * Randomness comes only from the scene seed: a new seed is another "edit" of the same track, the same
 * seed is the same frame. Sections of one `repeatGroup` share their look (choruses rhyme). Everything
 * here is a pure function of (timeline, director spec, seed, time).
 */

import { sectionRole, type AudioSection, type SectionRole, type Timeline } from '@/shared'
import type { CameraTransform } from './effectsHost'
import { createRng, hash32 } from './random'
import type { BeatInfo } from './rhythm'
import type { Ctx2D } from './types'

export type TransitionKind = 'cut' | 'fade' | 'flash' | 'zoom' | 'whip' | 'glitch'
export const TRANSITION_KINDS: readonly TransitionKind[] = [
  'cut',
  'fade',
  'flash',
  'zoom',
  'whip',
  'glitch',
]

/** Layer groups a shot can bring forward or push back (by layer type). */
export type LayerGroup = 'background' | 'visual' | 'text'

/** Camera of a shot. Amounts are relative (≈0..1.5) and scaled by the director's `chaos` / `energy`. */
export interface ShotCamera {
  /** Base zoom of the section (1 = none). */
  zoom?: number
  /** Zoom added over the whole section (push-in > 0, pull-out < 0). */
  push?: number
  /** Slow wandering offset. */
  drift?: number
  /** Slow roll (rotation). */
  roll?: number
  /** 3D lean (rotation about the horizontal axis); only with `camera3d`. */
  tilt?: number
  /** 3D orbit (swing about the vertical axis); only with `camera3d`. */
  orbit?: number
  /** Zoom kick on beats. */
  punch?: number
}

/** How a section looks. Preset scenes override the built-in role shots field by field. */
export interface ShotSpec {
  /** Reaction multiplier for layers (beat kicks) — `FrameContext.shot.intensity`. */
  intensity?: number
  /** Opacity multipliers by layer group. */
  groups?: Partial<Record<LayerGroup, number>>
  /** Opacity multipliers by layer id (win over groups). */
  layers?: Record<string, number>
  /** Text layout for directed text layers (kinetic: flow/stack/focus; fulltext: word/phrase/stack). A list = seeded pick. */
  layout?: string | string[]
  camera?: ShotCamera
  /** Transition into this section. A list = seeded pick. */
  transition?: TransitionKind | TransitionKind[]
}

export interface DirectorSpec {
  /** 0..1: how hard the video reacts (beat kicks, intensity contrast between sections). */
  energy: number
  /** 0..1: how much the camera wanders, rolls, leans; how often text flips. */
  chaos: number
  /** 0..1: how much the seed changes choices (transitions, angles, layouts); 0 = role defaults only. */
  randomness: number
  /** Transition length, seconds. */
  transitionSec: number
  /** 'auto' = per role (and seed); otherwise the same transition at every section change. */
  transitions: 'auto' | TransitionKind
  /** Allow 3D camera (tilt / orbit) — a WebGL perspective pass over the frame. */
  camera3d: boolean
  /** Shots by role, merged over the built-in `ROLE_SHOTS`. */
  scenes: Partial<Record<SectionRole, ShotSpec>>
}

export type DirectorInput = Partial<DirectorSpec>

export const DIRECTOR_DEFAULTS: DirectorSpec = {
  energy: 0.5,
  chaos: 0.3,
  randomness: 0.5,
  transitionSec: 0.45,
  transitions: 'auto',
  camera3d: false,
  scenes: {},
}

/** Built-in soft shots: quiet parts breathe, choruses and drops open up, bridges float. */
export const ROLE_SHOTS: Record<SectionRole, ShotSpec> = {
  intro: {
    intensity: 0.6,
    groups: { visual: 0.65 },
    camera: { push: 0.05, drift: 0.4, roll: 0.2, tilt: 0.3, orbit: 0.3, punch: 0.3 },
    transition: 'fade',
  },
  verse: {
    intensity: 0.85,
    groups: { visual: 0.85 },
    camera: { push: 0.03, drift: 0.5, roll: 0.3, tilt: 0.2, orbit: 0.4, punch: 0.5 },
    transition: ['cut', 'zoom'],
  },
  'pre-chorus': {
    intensity: 0.95,
    camera: { push: 0.08, drift: 0.5, roll: 0.4, tilt: 0.4, orbit: 0.5, punch: 0.7 },
    transition: ['zoom', 'cut'],
  },
  chorus: {
    intensity: 1.15,
    camera: { zoom: 1.03, push: 0.02, drift: 0.7, roll: 0.6, tilt: 0.6, orbit: 0.8, punch: 1 },
    transition: ['flash', 'whip', 'zoom'],
  },
  drop: {
    intensity: 1.3,
    camera: { zoom: 1.05, drift: 0.9, roll: 0.8, tilt: 0.8, orbit: 1, punch: 1.3 },
    transition: ['flash', 'zoom', 'glitch'],
  },
  bridge: {
    intensity: 0.75,
    groups: { visual: 0.75 },
    camera: { push: 0.04, drift: 0.6, roll: 0.5, tilt: 0.7, orbit: 0.9, punch: 0.4 },
    transition: ['fade', 'whip'],
  },
  breakdown: {
    intensity: 0.6,
    groups: { visual: 0.6 },
    camera: { push: -0.03, drift: 0.4, roll: 0.3, tilt: 0.5, orbit: 0.6, punch: 0.3 },
    transition: ['fade', 'cut'],
  },
  outro: {
    intensity: 0.5,
    groups: { visual: 0.7, text: 0.9 },
    camera: { push: -0.04, drift: 0.3, roll: 0.2, tilt: 0.3, orbit: 0.4, punch: 0.2 },
    transition: 'fade',
  },
}

/** The shot at a frame, as layers and effects see it (`FrameContext.shot`). */
export interface ShotState {
  role: SectionRole
  /** Section index, -1 when the track has no sections. */
  index: number
  /** Section bounds, seconds (the whole track without sections). */
  start: number
  end: number
  /** 0..1 through the section. */
  progress: number
  /** 0 at the section change → 1 after `transitionSec` (smoothstep); 1 without a director. */
  enter: number
  /** Seeded 32-bit number for this section; the same for sections of one repeat group. */
  variant: number
  /** Reaction multiplier (1 = as authored). */
  intensity: number
  /** Text layout chosen for the section, null = the layer's own. */
  layout: string | null
  /** Director knobs (0 when there is no director). */
  energy: number
  chaos: number
}

interface ResolvedShot {
  role: SectionRole
  index: number
  start: number
  end: number
  variant: number
  intensity: number
  groups: Partial<Record<LayerGroup, number>>
  layers: Record<string, number>
  layout: string | null
  transition: TransitionKind
  /** Camera amounts already scaled by chaos / energy / seed. */
  cam: {
    zoom: number
    push: number
    drift: number
    roll: number
    tilt: number
    orbit: number
    punch: number
    phase: number
    sign: number
    period: number
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const smooth = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

export function normalizeDirector(input: DirectorInput | null | undefined): DirectorSpec | null {
  if (!input || typeof input !== 'object') return null
  const d = DIRECTOR_DEFAULTS
  const transitions =
    input.transitions === 'auto' || TRANSITION_KINDS.includes(input.transitions as TransitionKind)
      ? (input.transitions as DirectorSpec['transitions'])
      : d.transitions
  return {
    energy: clamp01(num(input.energy, d.energy)),
    chaos: clamp01(num(input.chaos, d.chaos)),
    randomness: clamp01(num(input.randomness, d.randomness)),
    transitionSec: Math.max(0, num(input.transitionSec, d.transitionSec)),
    transitions,
    camera3d: input.camera3d === true,
    scenes: structuredClone(input.scenes ?? {}),
  }
}

/** Group of a layer type: what a shot's `groups` multipliers act on. */
export function layerGroup(type: string): LayerGroup {
  if (type === 'background' || type === 'noise') return 'background'
  if (type === 'text' || type === 'lyrics' || type === 'kinetic' || type === 'fulltext')
    return 'text'
  return 'visual'
}

function mergeShot(base: ShotSpec, over: ShotSpec | undefined): ShotSpec {
  if (!over) return base
  return {
    intensity: over.intensity ?? base.intensity,
    groups: { ...base.groups, ...over.groups },
    layers: { ...base.layers, ...over.layers },
    layout: over.layout ?? base.layout,
    camera: { ...base.camera, ...over.camera },
    transition: over.transition ?? base.transition,
  }
}

function pick<T>(list: T | T[] | undefined, rnd: number, randomness: number, fallback: T): T {
  if (list === undefined) return fallback
  if (!Array.isArray(list)) return list
  if (list.length === 0) return fallback
  // randomness 0 → always the first (role default); 1 → uniform over the list.
  if (rnd >= randomness) return list[0] as T
  return list[Math.floor((rnd / Math.max(randomness, 1e-6)) * list.length) % list.length] as T
}

export class Director {
  readonly spec: DirectorSpec
  private readonly shots: ResolvedShot[]
  private readonly transitions: boolean

  /**
   * `options.transitions: false` — section transitions are drawn by someone else (the effects'
   * `section-transitions`); the director then only changes shots (with the crossfade).
   */
  constructor(
    spec: DirectorSpec,
    seed: number,
    timeline: Timeline,
    options: { transitions?: boolean } = {},
  ) {
    this.spec = spec
    this.transitions = options.transitions ?? true
    const sections: readonly AudioSection[] = timeline.audio.sections ?? []
    const list =
      sections.length > 0
        ? sections
        : [{ start: 0, end: timeline.audio.durationSec, kind: 'normal' as const, energy: 1 }]
    this.shots = list.map((s, i) => this.resolve(s, sections.length > 0 ? i : -1, list, seed))
  }

  private resolve(
    s: AudioSection,
    index: number,
    list: readonly AudioSection[],
    seed: number,
  ): ResolvedShot {
    const { spec } = this
    const role = index < 0 ? 'verse' : sectionRole(list, index)
    const shot = mergeShot(ROLE_SHOTS[role], spec.scenes[role])
    // Look (variant, angles, layout) per repeat group; transition per section.
    const variant = hash32(
      seed,
      'shot',
      s.repeatGroup !== undefined ? `g${s.repeatGroup}` : `s${index}`,
      role,
    )
    const rng = createRng(variant)
    const trRnd = createRng(hash32(seed, 'transition', index))()
    const r = spec.randomness
    const c = shot.camera ?? {}
    const vary = () => 1 - r + r * (0.4 + 1.2 * rng())
    const transition =
      spec.transitions === 'auto' ? pick(shot.transition, trRnd, r, 'cut') : spec.transitions
    const layout = pick<string | null>(shot.layout ?? undefined, rng(), r, null)
    return {
      role,
      index,
      start: s.start,
      end: Math.max(s.end, s.start + 1e-3),
      variant,
      intensity: 1 + ((shot.intensity ?? 1) - 1) * (0.5 + spec.energy),
      groups: shot.groups ?? {},
      layers: shot.layers ?? {},
      layout,
      transition,
      cam: {
        zoom: num(c.zoom, 1),
        push: num(c.push, 0),
        drift: 0.025 * num(c.drift, 0) * spec.chaos * vary(),
        roll: 0.05 * num(c.roll, 0) * spec.chaos * vary(),
        tilt: spec.camera3d ? 0.3 * num(c.tilt, 0) * spec.chaos * vary() : 0,
        orbit: spec.camera3d ? 0.4 * num(c.orbit, 0) * spec.chaos * vary() : 0,
        punch: 0.03 * num(c.punch, 0) * spec.energy,
        phase: rng() * Math.PI * 2,
        sign: r > 0 && rng() < 0.5 ? -1 : 1,
        period: 6 + 4 * rng(),
      },
    }
  }

  private indexAt(t: number): number {
    let i = 0
    for (let k = 0; k < this.shots.length; k++) {
      if ((this.shots[k]?.start ?? Infinity) <= t) i = k
      else break
    }
    return i
  }

  private enterAt(t: number, i: number): number {
    const cur = this.shots[i]
    if (!cur || i === 0) return 1
    return smooth((t - cur.start) / Math.max(this.spec.transitionSec, 1e-3))
  }

  shotAt(t: number): ShotState {
    const i = this.indexAt(t)
    const cur = this.shots[i] as ResolvedShot
    const prev = this.shots[i - 1]
    const enter = this.enterAt(t, i)
    const intensity = prev
      ? prev.intensity + (cur.intensity - prev.intensity) * enter
      : cur.intensity
    return {
      role: cur.role,
      index: cur.index,
      start: cur.start,
      end: cur.end,
      progress: clamp01((t - cur.start) / (cur.end - cur.start)),
      enter,
      variant: cur.variant,
      intensity,
      layout: cur.layout,
      energy: this.spec.energy,
      chaos: this.spec.chaos,
    }
  }

  /** Opacity multiplier of a layer in the shot at `t`, crossfaded from the previous section. */
  layerAlpha(t: number, layerId: string, group: LayerGroup): number {
    const i = this.indexAt(t)
    const level = (s: ResolvedShot | undefined) =>
      s ? (s.layers[layerId] ?? s.groups[group] ?? 1) : 1
    const cur = level(this.shots[i])
    const prev = this.shots[i - 1]
    if (!prev) return cur
    const from = level(prev)
    return from + (cur - from) * this.enterAt(t, i)
  }

  /**
   * Contribute the director camera (composed like an effect: multiply zoom, add the rest). Runs
   * before the effects' camera hooks.
   */
  camera(t: number, beat: BeatInfo, out: CameraTransform): void {
    const i = this.indexAt(t)
    const cur = this.shots[i] as ResolvedShot
    const prev = this.shots[i - 1]
    const e = this.enterAt(t, i)
    const a = this.shotCamera(cur, t)
    const b = prev && e < 1 ? this.shotCamera(prev, t) : a
    const mix = (x: number, y: number) => y + (x - y) * e
    let zoom = mix(a.zoom, b.zoom)
    let rotation = mix(a.rotation, b.rotation)
    let x = mix(a.x, b.x)
    const y = mix(a.y, b.y)
    const tiltX = mix(a.tiltX, b.tiltX)
    const tiltY = mix(a.tiltY, b.tiltY)

    // Beat kick, scaled by the shot intensity.
    if (beat.index >= 0 && cur.cam.punch > 0) {
      zoom *= 1 + cur.cam.punch * beat.strength * Math.exp(-beat.since / 0.15)
    }

    // Camera part of the transition into this section (and the whip out of the previous one).
    const tr = this.transitionAt(t)
    if (tr) {
      const { kind, u, sign } = tr
      if (kind === 'zoom' && u >= 0) zoom *= 1 + 0.2 * (1 - smooth(u))
      if (kind === 'whip') {
        const w = u < 0 ? -smooth((u + 0.3) / 0.3) : 1 - smooth(u / 0.7)
        x += sign * 0.45 * w * Math.abs(w)
        rotation += sign * 0.12 * w * Math.abs(w)
      }
    }

    out.zoom *= zoom
    out.rotation += rotation
    out.x += x
    out.y += y
    if (tiltX !== 0) out.tiltX = (out.tiltX ?? 0) + tiltX
    if (tiltY !== 0) out.tiltY = (out.tiltY ?? 0) + tiltY
  }

  private shotCamera(s: ResolvedShot, t: number) {
    const c = s.cam
    const local = t - s.start
    const progress = clamp01(local / (s.end - s.start))
    const w = (Math.PI * 2) / c.period
    return {
      zoom: c.zoom * (1 + c.push * smooth(progress)),
      rotation: c.roll * Math.sin(w * 0.7 * t + c.phase),
      x: c.drift * Math.sin(w * t + c.phase),
      y: c.drift * 0.7 * Math.sin(w * 1.3 * t + c.phase * 1.7),
      tiltX: c.tilt * c.sign * (0.55 + 0.45 * Math.sin(w * 0.5 * t + c.phase * 0.3)),
      tiltY: c.orbit * Math.sin(w * 0.6 * t + c.phase * 2.1),
    }
  }

  /**
   * Transition near a section boundary: `u` = (t − boundary) / transitionSec (negative before it).
   * Null when no transition is running.
   */
  transitionAt(t: number): { kind: TransitionKind; u: number; sign: number; index: number } | null {
    if (!this.transitions) return null
    const T = Math.max(this.spec.transitionSec, 1e-3)
    for (let j = 1; j < this.shots.length; j++) {
      const s = this.shots[j] as ResolvedShot
      const u = (t - s.start) / T
      if (u < -0.5) break
      if (u > 1 || s.transition === 'cut') continue
      return { kind: s.transition, u, sign: s.variant & 1 ? -1 : 1, index: j }
    }
    return null
  }

  /** Screen-space part of transitions (dip to black, flash, glitch slices), above the layers. */
  overlay(g: Ctx2D, t: number, width: number, height: number): void {
    const tr = this.transitionAt(t)
    if (!tr) return
    const { kind, u } = tr
    if (kind === 'fade' && u >= -0.5 && u <= 0.5) {
      g.globalAlpha = smooth(1 - Math.abs(u) * 2)
      g.fillStyle = '#000000'
      g.fillRect(0, 0, width, height)
    } else if (kind === 'flash' && u >= 0) {
      g.globalAlpha = 0.85 * (1 - u) * (1 - u)
      g.globalCompositeOperation = 'lighter'
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, width, height)
    } else if (kind === 'glitch' && u >= -0.2 && u <= 0.6) {
      const src = g.canvas as unknown
      if (typeof src !== 'object' || src === null) return
      // Re-rolled every ~2 frames' worth of transition progress.
      const rng = createRng(hash32(tr.index, Math.floor(u * 12)))
      const strength = 1 - Math.abs(u - 0.2) / 0.4
      const slices = 6
      for (let k = 0; k < slices; k++) {
        const y = Math.floor(rng() * height)
        const h = Math.ceil(height * (0.02 + 0.08 * rng()))
        const dx = (rng() - 0.5) * width * 0.25 * strength
        g.drawImage(src as CanvasImageSource, 0, y, width, h, dx, y, width, h)
      }
    }
  }
}

/** Shot without a director: the section and its role, neutral levels. */
export function neutralShot(timeline: Timeline, t: number): ShotState {
  const sections = timeline.audio.sections ?? []
  let index = -1
  for (let k = 0; k < sections.length; k++) {
    if ((sections[k]?.start ?? Infinity) <= t) index = k
    else break
  }
  if (sections.length > 0 && index < 0) index = 0
  const s = sections[index]
  const start = s?.start ?? 0
  const end = Math.max(s?.end ?? timeline.audio.durationSec, start + 1e-3)
  return {
    role: index < 0 ? 'verse' : sectionRole(sections, index),
    index,
    start,
    end,
    progress: clamp01((t - start) / (end - start)),
    enter: 1,
    variant: 0,
    intensity: 1,
    layout: null,
    energy: 0,
    chaos: 0,
  }
}
