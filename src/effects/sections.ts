/**
 * The "story" of a video by song sections: every role (intro, build, drop, bridge…) has a mood that
 * scales the style effects, and section boundaries get a short transition (flash, glitch, zoom, whip)
 * picked from the scene seed — same seed → same video, another seed → other transitions.
 *
 * Everything is a pure function of (sections, time, seed); boundaries and moods are cheap to
 * recompute, so nothing is carried between frames.
 *
 * With a render host that has a director, effects read the shot (`FrameContext.shot`: role, `enter`,
 * `intensity`) instead of finding the section themselves, so their mood crossfades exactly with the
 * director's shot change. Director shots are the song sections, so transition cuts land on them too.
 */

import type { ShotState } from '@/render'
import { sectionRole, type AudioAnalysis, type AudioSection, type LyricLine, type SectionRole } from '@/shared'
import { clamp01, ease, lerp, rand, smoothstep } from './math'
import { num, str, type LocalizedText, type ParamSpec, type ParamValues } from './params'
import { addSplit, IDENTITY_CAMERA, NEUTRAL_POST, type CameraTransform, type FlashOverlay, type PostDynamics } from './types'

// ---------------------------------------------------------------------------
// Moods
// ---------------------------------------------------------------------------

/**
 * How a section shapes the style effects. `energy` multiplies motion and glow (1 = as the style
 * sets it); the rest are offsets added to the color grade / vignette / grain.
 */
export interface SectionMood {
  energy: number
  saturation: number
  contrast: number
  temperature: number
  exposure: number
  vignette: number
  grain: number
}

export const NEUTRAL_MOOD: Readonly<SectionMood> = {
  energy: 1,
  saturation: 0,
  contrast: 0,
  temperature: 0,
  exposure: 0,
  vignette: 0,
  grain: 0,
}

const mood = (m: Partial<SectionMood>): SectionMood => ({ ...NEUTRAL_MOOD, ...m })

/**
 * Intro — restrained; verse — a notch under the style; pre-chorus — tension grows (see `moodAt`);
 * chorus / drop — maximum; bridge — another character (cool, washed out); breakdown — almost mono.
 */
export const SECTION_MOODS: Readonly<Record<SectionRole, SectionMood>> = {
  intro: mood({ energy: 0.45, saturation: -0.15, contrast: -0.04, vignette: 0.15, exposure: -0.05 }),
  verse: mood({ energy: 0.8, saturation: -0.05 }),
  'pre-chorus': mood({ energy: 1.3, contrast: 0.06, vignette: 0.1, grain: 0.3 }),
  chorus: mood({ energy: 1.3, saturation: 0.1, contrast: 0.05 }),
  drop: mood({ energy: 1.6, saturation: 0.15, contrast: 0.1, exposure: 0.04 }),
  bridge: mood({ energy: 0.7, saturation: -0.25, temperature: -0.3, contrast: -0.03, grain: 0.4 }),
  breakdown: mood({ energy: 0.4, saturation: -0.55, contrast: 0.12, vignette: 0.2, grain: 0.5 }),
  outro: mood({ energy: 0.5, saturation: -0.2, exposure: -0.08, vignette: 0.2 }),
}

/** Start mood of a pre-chorus; it ramps to SECTION_MOODS['pre-chorus'] by the section end. */
const BUILD_START = mood({ energy: 0.85 })

/** Crossfade between section moods, seconds after a boundary. */
const MOOD_FADE_SEC = 0.35

export interface SectionState {
  index: number
  section: AudioSection
  role: SectionRole
  /** 0..1 through the section. */
  progress: number
}

/** Section at time t, or null without sections / outside them. */
export function sectionAt(audio: AudioAnalysis, t: number): SectionState | null {
  const sections = audio.sections
  if (!sections || sections.length === 0) return null
  let index = -1
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    if (s && t >= s.start && t < s.end) {
      index = i
      break
    }
  }
  if (index < 0) return null
  const section = sections[index] as AudioSection
  const span = section.end - section.start
  return {
    index,
    section,
    role: sectionRole(sections, index),
    progress: span > 0 ? clamp01((t - section.start) / span) : 0,
  }
}

function mixMood(a: SectionMood, b: SectionMood, k: number): SectionMood {
  return {
    energy: lerp(a.energy, b.energy, k),
    saturation: lerp(a.saturation, b.saturation, k),
    contrast: lerp(a.contrast, b.contrast, k),
    temperature: lerp(a.temperature, b.temperature, k),
    exposure: lerp(a.exposure, b.exposure, k),
    vignette: lerp(a.vignette, b.vignette, k),
    grain: lerp(a.grain, b.grain, k),
  }
}

function roleMood(role: SectionRole, progress: number): SectionMood {
  const m = SECTION_MOODS[role]
  // Growing tension: the build ramps up and peaks right before the drop.
  return role === 'pre-chorus' ? mixMood(BUILD_START, m, ease('ease', progress) ** 1.5) : m
}

/** Mood at time t, crossfaded after each boundary. Neutral without sections. */
export function moodAt(audio: AudioAnalysis, t: number): SectionMood {
  const state = sectionAt(audio, t)
  if (!state) return NEUTRAL_MOOD
  const current = roleMood(state.role, state.progress)
  const sections = audio.sections ?? []
  const since = t - state.section.start
  if (state.index === 0 || since >= MOOD_FADE_SEC) return current
  const prev = roleMood(sectionRole(sections, state.index - 1), 1)
  return mixMood(prev, current, smoothstep(0, MOOD_FADE_SEC, since))
}

/** Shot as effects see it (the render engine's `ShotState`); older hosts have none. */
export type Shot = ShotState

/**
 * True when the shot comes from a director (its `enter` is a real crossfade). The engine's neutral
 * shot (no director) has zero knobs and variant.
 */
export function isDirectedShot(shot: Shot): boolean {
  return shot.variant !== 0 || shot.energy > 0 || shot.chaos > 0
}

/**
 * Mood of a shot: its role and progress, crossfaded from the previous section by `shot.enter` (the
 * director's transition), energy × `shot.intensity`. Without a director the crossfade is our own.
 */
export function shotMood(audio: AudioAnalysis, shot: Shot, t: number): SectionMood {
  if (shot.index < 0) return NEUTRAL_MOOD
  const current = roleMood(shot.role, shot.progress)
  let k = 1
  if (shot.index > 0) k = isDirectedShot(shot) ? clamp01(shot.enter) : smoothstep(0, MOOD_FADE_SEC, t - shot.start)
  const m = k >= 1 ? current : mixMood(roleMood(sectionRole(audio.sections ?? [], shot.index - 1), 1), current, k)
  return shot.intensity === 1 ? m : { ...m, energy: m.energy * Math.max(shot.intensity, 0) }
}

/** Mood scaled by `react` (0 = neutral, 1 = full mood); from the shot when the host gives one. */
export function scaledMood(audio: AudioAnalysis, t: number, react: number, shot?: Shot): SectionMood {
  if (react <= 0) return NEUTRAL_MOOD
  const m = shot ? shotMood(audio, shot, t) : moodAt(audio, t)
  return react >= 1 ? m : mixMood(NEUTRAL_MOOD, m, react)
}

export const SECTION_REACT_PARAM: ParamSpec = {
  key: 'sectionReact',
  type: 'number',
  label: { ru: 'Реакция на секции', en: 'Section reaction' },
  hint: {
    ru: 'Насколько эффект меняется по секциям: тише в интро, максимум в дропе',
    en: 'How much the effect follows the sections: calm intro, peak in the drop',
  },
  min: 0,
  max: 1,
  step: 0.05,
  default: 1,
}

/** Mood for an effect with a resolved `sectionReact` param. */
export function effectMood(audio: AudioAnalysis, t: number, params: ParamValues, shot?: Shot): SectionMood {
  return scaledMood(audio, t, num(params, 'sectionReact'), shot)
}

/** Reaction gain of a shot for motion effects: `shot.intensity` (1 without a shot), capped. */
export function shotGain(shot: Shot | undefined): number {
  return shot ? Math.min(Math.max(shot.intensity, 0), 1.5) : 1
}

// ---------------------------------------------------------------------------
// Transitions between sections
// ---------------------------------------------------------------------------

/**
 * flash / glitch / zoom / whip — the base set. Edit cuts (`edit` style): `whip-zoom` (hard push through
 * the cut with a 3D swing), `flash-cut` (a white or black frame), `rgb` (an RGB-shift burst).
 */
export type TransitionKind = 'flash' | 'glitch' | 'zoom' | 'whip' | 'whip-zoom' | 'flash-cut' | 'rgb'

/** The `auto` set. */
export const TRANSITION_KINDS: readonly TransitionKind[] = ['flash', 'glitch', 'zoom', 'whip']

export const EDIT_TRANSITION_KINDS: readonly TransitionKind[] = ['whip-zoom', 'glitch', 'flash-cut', 'rgb']

/** Choice weights by the role being entered: drops like flash and zoom, bridges like glitch and whip. Missing = 1. */
const KIND_WEIGHTS: Readonly<Record<SectionRole, Partial<Record<TransitionKind, number>>>> = {
  intro: { flash: 1, glitch: 1, zoom: 1, whip: 1 },
  verse: { flash: 1, glitch: 1.2, zoom: 1, whip: 1.2, rgb: 1.2 },
  'pre-chorus': { flash: 0.6, glitch: 1, zoom: 1.5, whip: 1, 'whip-zoom': 1.5 },
  chorus: { flash: 1.5, glitch: 0.8, zoom: 1.4, whip: 1, 'flash-cut': 1.4 },
  drop: { flash: 2, glitch: 1, zoom: 2, whip: 0.6, 'whip-zoom': 1.8, 'flash-cut': 1.8 },
  bridge: { flash: 0.6, glitch: 1.6, zoom: 0.8, whip: 1.6, rgb: 1.4, 'flash-cut': 0.6 },
  breakdown: { flash: 0.8, glitch: 1.4, zoom: 0.6, whip: 1.2, rgb: 1.2 },
  outro: { flash: 1.2, glitch: 0.8, zoom: 0.8, whip: 0.8 },
}

/** Strength by the role being entered. */
const ENTRY_STRENGTH: Readonly<Record<SectionRole, number>> = {
  intro: 0.5,
  verse: 0.6,
  'pre-chorus': 0.7,
  chorus: 0.9,
  drop: 1,
  bridge: 0.75,
  breakdown: 0.65,
  outro: 0.55,
}

const KIND_SETS: Readonly<Record<string, readonly TransitionKind[]>> = {
  auto: TRANSITION_KINDS,
  clean: ['flash', 'zoom'],
  rough: ['glitch', 'whip', 'flash'],
  edit: EDIT_TRANSITION_KINDS,
  flash: ['flash'],
  glitch: ['glitch'],
  zoom: ['zoom'],
  whip: ['whip'],
  'whip-zoom': ['whip-zoom'],
  'flash-cut': ['flash-cut'],
  rgb: ['rgb'],
}

/** Boundaries closer than this to the previous transition are skipped (too busy). */
const MIN_GAP_SEC = 1.5
/** Line cuts: at least this far from any section cut and from the previous line cut. */
const LINE_CLEAR_SEC = 0.6
const LINE_GAP_SEC = 0.9
/** Line cuts are shorter and weaker than section cuts. */
const LINE_DURATION = 0.6
const LINE_STRENGTH = 0.7

export interface SectionTransition {
  /** Section start (the cut). */
  time: number
  kind: TransitionKind
  /** 0..1, from the role being entered. */
  strength: number
  /** -1 or 1: direction of whips / glitch splits. */
  direction: number
  /** Index of the section being entered (or of the lyric line for a line cut). */
  index: number
  /** Cut at a lyric line start (shorter, weaker) instead of a section start. */
  line?: boolean
}

const l = (ru: string, en: string): LocalizedText => ({ ru, en })

export const TRANSITION_PARAMS: ParamSpec[] = [
  { key: 'amount', type: 'number', label: l('Сила', 'Amount'), min: 0, max: 1, step: 0.01, default: 0.8 },
  {
    key: 'durationSec',
    type: 'number',
    label: l('Длительность', 'Duration'),
    min: 0.1,
    max: 1.2,
    step: 0.01,
    default: 0.4,
    unit: 's',
  },
  {
    key: 'kinds',
    type: 'enum',
    label: l('Переходы', 'Transitions'),
    hint: l('Из каких переходов выбирать по сиду сцены', 'Which transitions the scene seed picks from'),
    options: [
      { value: 'auto', label: l('Все, по секции', 'All, by section') },
      { value: 'clean', label: l('Чистые: вспышка, наезд', 'Clean: flash, zoom') },
      { value: 'rough', label: l('Резкие: глитч, рывок, вспышка', 'Rough: glitch, whip, flash') },
      {
        value: 'edit',
        label: l('Монтаж: рывок-наезд, глитч, вспышка-склейка, RGB', 'Edit: whip zoom, glitch, flash cut, RGB'),
      },
      { value: 'flash', label: l('Вспышка', 'Flash') },
      { value: 'glitch', label: l('Глитч', 'Glitch') },
      { value: 'zoom', label: l('Наезд', 'Zoom') },
      { value: 'whip', label: l('Рывок камеры', 'Whip pan') },
      { value: 'whip-zoom', label: l('Рывок-наезд', 'Whip zoom') },
      { value: 'flash-cut', label: l('Вспышка-склейка', 'Flash cut') },
      { value: 'rgb', label: l('RGB-сдвиг', 'RGB shift') },
    ],
    default: 'auto',
  },
  { key: 'color', type: 'color', label: l('Цвет вспышки', 'Flash color'), default: '#ffffff' },
  {
    key: 'lines',
    type: 'number',
    label: l('Склейки на строках', 'Cuts on lines'),
    hint: l(
      'Сила коротких переходов на смене строки текста; 0 — только на секциях',
      'Short cuts where a lyric line starts; 0 = sections only',
    ),
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
]

function pickKind(allowed: readonly TransitionKind[], role: SectionRole, r: number): TransitionKind {
  const weights = KIND_WEIGHTS[role]
  const total = allowed.reduce((sum, k) => sum + (weights[k] ?? 1), 0)
  let x = r * total
  for (const k of allowed) {
    x -= weights[k] ?? 1
    if (x < 0) return k
  }
  return allowed[allowed.length - 1] ?? 'flash'
}

/** Transitions at section starts (the first section has none). Pure: (sections, seed, kinds). */
export function planTransitions(
  sections: readonly AudioSection[] | undefined,
  seed: number,
  kinds = 'auto',
): SectionTransition[] {
  if (!sections || sections.length < 2) return []
  const allowed = KIND_SETS[kinds] ?? TRANSITION_KINDS
  const out: SectionTransition[] = []
  let last = -Infinity
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i]
    if (!s || s.start - last < MIN_GAP_SEC) continue
    const role = sectionRole(sections, i)
    out.push({
      time: s.start,
      kind: pickKind(allowed, role, rand(seed, i * 3)),
      strength: ENTRY_STRENGTH[role],
      direction: rand(seed, i * 3 + 1) < 0.5 ? -1 : 1,
      index: i,
    })
    last = s.start
  }
  return out
}

/** Start of a line: its first timed word, null when none is timed. */
function lineStart(line: LyricLine): number | null {
  for (const w of line.words) if (w.start !== null) return w.start
  return null
}

/**
 * Section cuts plus short cuts at lyric line starts (away from the section cuts), sorted by time.
 * The first line has none. Pure: (sections, lines, seed, kinds).
 */
export function planLineTransitions(
  sections: readonly AudioSection[] | undefined,
  lines: readonly LyricLine[] | undefined,
  seed: number,
  kinds = 'auto',
): SectionTransition[] {
  const sectionPlan = planTransitions(sections, seed, kinds)
  if (!lines || lines.length < 2) return sectionPlan
  const allowed = KIND_SETS[kinds] ?? TRANSITION_KINDS
  const lineSeed = (seed ^ 0x5bd1e995) >>> 0
  const cuts: SectionTransition[] = []
  let last = NaN
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line ? lineStart(line) : null
    if (t === null) continue
    if (Number.isNaN(last)) {
      last = t
      continue
    }
    if (t - last < LINE_GAP_SEC || sectionPlan.some((s) => Math.abs(s.time - t) < LINE_CLEAR_SEC)) continue
    let role: SectionRole = 'verse'
    const k = sections ? sections.findIndex((s) => t >= s.start && t < s.end) : -1
    if (sections && k >= 0) role = sectionRole(sections, k)
    cuts.push({
      time: t,
      kind: pickKind(allowed, role, rand(lineSeed, i * 3)),
      strength: ENTRY_STRENGTH[role] * LINE_STRENGTH,
      direction: rand(lineSeed, i * 3 + 1) < 0.5 ? -1 : 1,
      index: i,
      line: true,
    })
    last = t
  }
  return [...sectionPlan, ...cuts].sort((a, b) => a.time - b.time)
}

/** What a transition adds to one frame. */
export interface TransitionFrame {
  camera: CameraTransform
  flash: FlashOverlay | null
  post: PostDynamics
}

/** Share of the duration before the cut (anticipation) for camera moves. */
const LEAD_SHARE = 0.45

/** Window of a transition: camera moves start before the cut, flash and glitch hit on it. */
export function transitionWindow(tr: SectionTransition, durationSec: number): { start: number; end: number } {
  const dur = tr.line ? durationSec * LINE_DURATION : durationSec
  const lead = tr.kind === 'zoom' || tr.kind === 'whip' || tr.kind === 'whip-zoom' ? dur * LEAD_SHARE : 0
  return { start: tr.time - lead, end: tr.time + dur }
}

/**
 * Contribution of the transitions at time t (several may overlap only with very short sections).
 * `gain` scales the strength (the shot intensity); line cuts are scaled by the `lines` param.
 */
export function transitionAt(
  transitions: readonly SectionTransition[],
  t: number,
  params: ParamValues,
  seed: number,
  gain = 1,
): TransitionFrame {
  const out: TransitionFrame = { camera: { ...IDENTITY_CAMERA }, flash: null, post: { ...NEUTRAL_POST } }
  const amount = num(params, 'amount') * gain
  const baseDur = Math.max(num(params, 'durationSec'), 0.05)
  if (amount <= 0) return out
  const lines = num(params, 'lines')
  for (const tr of transitions) {
    const w = transitionWindow(tr, baseDur)
    // Sorted by cut time; a lead never reaches further back than one duration.
    if (t < tr.time - baseDur) break
    if (t < w.start || t >= w.end) continue
    const k = amount * tr.strength * (tr.line ? lines : 1)
    if (k <= 0) continue
    const dur = tr.line ? baseDur * LINE_DURATION : baseDur
    const after = (t - tr.time) / dur // 0..1 after the cut, negative before
    switch (tr.kind) {
      case 'flash': {
        const alpha = clamp01(k * (1 - ease('soft', after)))
        if (alpha > 0.002) out.flash = { kind: 'flash', color: str(params, 'color'), alpha, blend: 'screen' }
        break
      }
      case 'glitch': {
        const level = k * (1 - ease('ease', after))
        const step = Math.floor((t - tr.time) * 24)
        out.post.glitch = Math.max(out.post.glitch, level)
        out.post.glitchSeed = (seed ^ Math.imul(step + 1, 0x9e3779b1)) >>> 0
        out.post.glitchSlices = 12
        out.post.rgbSplit += tr.direction * 0.03 * level * (rand(seed, step) < 0.5 ? 0.5 : 1)
        break
      }
      case 'zoom': {
        // Push in towards the cut, snap back after it.
        const z =
          after < 0 ? ease('ease', 1 + after / LEAD_SHARE) : 1 - ease('sharp', Math.min(after * 2.5, 1))
        out.camera.zoom *= 1 + 0.35 * k * z
        out.post.rgbSplit += 0.006 * k * z * tr.direction
        break
      }
      case 'whip': {
        // A fast pan through the cut: offset and roll ease in-out across the window.
        const u = (t - w.start) / (w.end - w.start)
        const swing = Math.sin(Math.PI * u) * (u < LEAD_SHARE / (1 + LEAD_SHARE) ? 1 : -1)
        const blur = Math.sin(Math.PI * u)
        out.camera.x += tr.direction * 0.22 * k * swing
        out.camera.rotation += tr.direction * 0.09 * k * swing
        out.camera.zoom *= 1 + 0.08 * k * blur
        out.post.rgbSplit += tr.direction * 0.012 * k * blur
        break
      }
      case 'whip-zoom': {
        // Accelerating push into the cut with a 3D swing; the new shot lands zoomed in and settles.
        const before = after < 0
        const z = before ? clamp01(1 + after / LEAD_SHARE) ** 3 : 1 - ease('sharp', Math.min(after * 2, 1))
        const side = before ? 1 : -1
        out.camera.zoom *= 1 + (before ? 0.6 : 0.28) * k * z
        out.camera.rotation += tr.direction * 0.06 * k * z * side
        out.camera.tiltY = (out.camera.tiltY ?? 0) + tr.direction * 0.35 * k * z * side
        out.camera.tiltX = (out.camera.tiltX ?? 0) + 0.12 * k * z
        out.post.rgbSplit = addSplit(out.post.rgbSplit, tr.direction * 0.022 * k * z)
        break
      }
      case 'flash-cut': {
        // A hard frame (white or black by direction) for ~2 frames, gone after a third of the window.
        const hold = 0.08
        const alpha = clamp01(k * 1.4 * (after < hold ? 1 : 1 - (after - hold) / 0.25))
        if (alpha > 0.002) {
          const dark = tr.direction < 0
          out.flash = {
            kind: 'flash',
            color: dark ? '#000000' : str(params, 'color'),
            alpha,
            blend: dark ? 'normal' : 'screen',
          }
        }
        out.camera.zoom *= 1 + 0.12 * k * (1 - ease('soft', Math.min(after * 3, 1)))
        break
      }
      case 'rgb': {
        // Channels jump apart and flicker back together in steps.
        const level = k * (1 - ease('ease', after))
        const step = Math.floor((t - tr.time) * 30)
        const flick = step % 2 === 0 ? 1 : -0.6
        out.post.rgbSplit = addSplit(out.post.rgbSplit, tr.direction * 0.045 * level * flick)
        out.post.rgbSplitY += 0.012 * level * (rand(seed, step + tr.index * 97) - 0.5)
        out.post.glitch = Math.max(out.post.glitch, 0.25 * level)
        out.post.glitchSeed = (seed ^ Math.imul(step + 7, 0x85ebca6b)) >>> 0
        out.camera.zoom *= 1 + 0.05 * level
        break
      }
    }
  }
  return out
}
