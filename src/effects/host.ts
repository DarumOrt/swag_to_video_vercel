/**
 * Adapters from the pure effect logic to the render engine's effects host (`createEffect`).
 * Scene effect types:
 *
 *   accents              — every accent of timeline.accents (camera, overlay, time warp, post pass)
 *   beat-camera          — camera pulse / kick / sway on beats, boosted in drops
 *   beat-flash           — overlay flash on strong beats
 *   section-transitions  — a short flash / glitch / zoom / whip at section starts, picked by the seed
 *                          (optionally also at lyric line starts: `lines`)
 *   drop-bursts          — seeded series of strobe blinks / RGB splits on beats inside drops
 *   bloom, chromatic-aberration, color-grade, vignette, scanlines, grain — WebGL2 post passes
 *
 * Section-aware effects read `FrameContext.shot` (the director's shot) when the host provides it.
 * Camera tilt goes to `CameraTransform.tiltX/tiltY`; only a host without them (no `shot` either —
 * both came in the same engine version) gets the accent pass homography instead (`tiltFallback`).
 *
 * Effects keep no state between frames. The `accents` effect memoizes the last evaluated time
 * (the engine calls several hooks per frame); that is a pure cache, not carried state.
 */

import type { Timeline } from '@/shared'
// TODO(render): import from '@/render' once its index re-exports the effects host types.
import type { Effect, EffectFactory, EffectSpec } from '@/render/effectsHost'
import type { FrameContext } from '@/render'
import { evaluateAccents, prepareAccents, type PreparedAccents } from './evaluate'
import { drawOverlays } from './overlay'
import { num, resolveParams, str, type LocalizedText, type ParamSpec, type ParamValues } from './params'
import { BURST_PARAMS, burstAt, type BurstFrame } from './bursts'
import { accentsPass, createPostPass } from './post/passes'
import { POST_EFFECTS, type PostEffectType } from './post/settings'
import { EFFECT_STYLE_ORDER, EFFECT_STYLES, type EffectStyleId } from './presets'
import { applyBeatCamera, BEAT_CAMERA_PARAMS, BEAT_FLASH_PARAMS, beatFlash } from './rhythm'
import {
  planLineTransitions,
  shotGain,
  TRANSITION_PARAMS,
  transitionAt,
  type SectionTransition,
  type TransitionFrame,
} from './sections'
import { composeCamera, isNeutralPost, type AccentFrame, type OverlayItem, type PostDynamics } from './types'

export type EffectType =
  | 'accents'
  | 'beat-camera'
  | 'beat-flash'
  | 'section-transitions'
  | 'drop-bursts'
  | PostEffectType

export type EffectHook = 'time' | 'camera' | 'overlay' | 'post'

export interface EffectTypeInfo {
  type: EffectType
  label: LocalizedText
  description: LocalizedText
  params: ParamSpec[]
  hooks: EffectHook[]
}

/** Families of the embedded fonts (render `FONT_FAMILY`), by our param value. */
const WORD_FONTS: Record<string, string> = {
  display: '"STV Unbounded", system-ui, sans-serif',
  grotesk: '"STV Inter", system-ui, sans-serif',
  condensed: '"STV Oswald", system-ui, sans-serif',
}

const ACCENTS_PARAMS: ParamSpec[] = [
  {
    key: 'style',
    type: 'enum',
    label: { ru: 'Стиль акцентов', en: 'Accent style' },
    hint: { ru: 'Значения параметров акцентов по умолчанию', en: 'Default accent parameters' },
    options: [
      { value: 'none', label: { ru: 'Без стиля', en: 'None' } },
      ...EFFECT_STYLE_ORDER.map((id) => ({ value: id, label: EFFECT_STYLES[id].label })),
    ],
    default: 'none',
  },
  {
    key: 'font',
    type: 'enum',
    label: { ru: 'Шрифт слова на весь экран', en: 'Full-screen word font' },
    options: [
      { value: 'display', label: { ru: 'Акцидентный', en: 'Display' } },
      { value: 'grotesk', label: { ru: 'Гротеск', en: 'Grotesk' } },
      { value: 'condensed', label: { ru: 'Узкий', en: 'Condensed' } },
    ],
    default: 'display',
  },
  {
    key: 'fontWeight',
    type: 'number',
    label: { ru: 'Насыщенность шрифта', en: 'Font weight' },
    min: 300,
    max: 900,
    step: 100,
    default: 800,
  },
]

export const EFFECT_TYPES: Readonly<Record<EffectType, EffectTypeInfo>> = {
  accents: {
    type: 'accents',
    label: { ru: 'Акценты на словах', en: 'Word accents' },
    description: {
      ru: 'Эффекты, привязанные к словам (timeline.accents)',
      en: 'Effects bound to words (timeline.accents)',
    },
    params: ACCENTS_PARAMS,
    hooks: ['time', 'camera', 'overlay', 'post'],
  },
  'beat-camera': {
    type: 'beat-camera',
    label: { ru: 'Камера под биты', en: 'Beat camera' },
    description: { ru: 'Пульс и толчки камеры на долях', en: 'Camera pulse and kicks on beats' },
    params: BEAT_CAMERA_PARAMS,
    hooks: ['camera'],
  },
  'beat-flash': {
    type: 'beat-flash',
    label: { ru: 'Вспышки на сильных долях', en: 'Flash on strong beats' },
    description: { ru: 'Короткая засветка на сильных долях', en: 'A short flash on strong beats' },
    params: BEAT_FLASH_PARAMS,
    hooks: ['overlay'],
  },
  'section-transitions': {
    type: 'section-transitions',
    label: { ru: 'Переходы между секциями', en: 'Section transitions' },
    description: {
      ru: 'Короткая вспышка, глитч, наезд или рывок камеры на стыке секций; выбор зависит от сида сцены',
      en: 'A short flash, glitch, zoom or whip pan where sections change; picked by the scene seed',
    },
    params: TRANSITION_PARAMS,
    hooks: ['camera', 'overlay', 'post'],
  },
  'drop-bursts': {
    type: 'drop-bursts',
    label: { ru: 'Серии на дропе', en: 'Drop bursts' },
    description: {
      ru: 'Короткие серии строба или RGB-сдвига на долях внутри дропа; рисунок зависит от сида сцены',
      en: 'Short strobe or RGB-split series on beats inside drops; the pattern follows the scene seed',
    },
    params: BURST_PARAMS,
    hooks: ['camera', 'overlay', 'post'],
  },
  ...(Object.fromEntries(
    (Object.keys(POST_EFFECTS) as PostEffectType[]).map((type) => [
      type,
      { type, ...POST_EFFECTS[type], hooks: ['post'] as EffectHook[] },
    ]),
  ) as Record<PostEffectType, EffectTypeInfo>),
}

export function isEffectType(type: string): type is EffectType {
  return Object.hasOwn(EFFECT_TYPES, type)
}

/** Font families an effect draws with; the engine must load them before the first frame. */
export function effectFontFamilies(spec: EffectSpec): string[] {
  if (spec.type !== 'accents') return []
  const params = resolveParams(ACCENTS_PARAMS, spec.params)
  const stack = WORD_FONTS[str(params, 'font')] ?? WORD_FONTS.display ?? ''
  return [stack.split(',')[0]?.replace(/"/g, '').trim() ?? '']
}

export const createEffect: EffectFactory = (spec, { seed }) => {
  if (!isEffectType(spec.type)) return null
  const params = resolveParams(EFFECT_TYPES[spec.type].params, spec.params)
  switch (spec.type) {
    case 'accents':
      return accentsEffect(spec.id, params, seed)
    case 'beat-camera':
      return {
        id: spec.id,
        camera: (f, cam) => applyBeatCamera(f.timeline.audio, f.baseTime, params, seed, cam, f.shot),
      }
    case 'beat-flash':
      return {
        id: spec.id,
        overlay(g, f) {
          const flash = beatFlash(f.timeline.audio, f.baseTime, params, f.shot)
          if (flash) drawOverlays(g, [flash], f.layout)
        },
      }
    case 'section-transitions':
      return transitionsEffect(spec.id, params, seed)
    case 'drop-bursts':
      return burstsEffect(spec.id, params, seed)
    default:
      return { id: spec.id, post: createPostPass(spec.type, params) }
  }
}

/** True when the host renders `CameraTransform.tiltX/tiltY` (engines with a director shot do). */
function hostHasTilt(f: FrameContext): boolean {
  return (f as Partial<FrameContext>).shot !== undefined
}

/** Effect with camera / overlay / post from one memoized per-frame result. */
function framedEffect<T extends { camera: AccentFrame['camera']; post: PostDynamics }>(
  id: string,
  compute: (f: FrameContext) => T,
  overlays: (frame: T) => OverlayItem[],
  extra: Partial<Effect> = {},
): Effect & { at(f: FrameContext): T } {
  let memo: { timeline: Timeline; time: number; shot: unknown; frame: T } | null = null
  const at = (f: FrameContext): T => {
    if (memo && memo.timeline === f.timeline && memo.time === f.baseTime && memo.shot === f.shot) return memo.frame
    const frame = compute(f)
    memo = { timeline: f.timeline, time: f.baseTime, shot: f.shot, frame }
    return frame
  }
  const pass = accentsPass((f) => at(f).post)
  return {
    id,
    at,
    camera(f, cam) {
      composeCamera(cam, at(f).camera)
    },
    overlay(g, f) {
      const items = overlays(at(f))
      if (items.length > 0) drawOverlays(g, items, f.layout)
    },
    post: { ...pass, active: (f) => !isNeutralPost(at(f).post) },
    ...extra,
    dispose() {
      memo = null
      extra.dispose?.()
    },
  }
}

function transitionsEffect(id: string, params: ParamValues, seed: number): Effect {
  type Plan = { sections: Timeline['audio']['sections']; lyrics: Timeline['lyrics']; list: SectionTransition[] }
  let plan: Plan | null = null
  const kinds = str(params, 'kinds')
  const lines = num(params, 'lines') > 0
  const compute = (f: FrameContext): TransitionFrame => {
    const sections = f.timeline.audio.sections
    const lyrics = f.timeline.lyrics
    if (!plan || plan.sections !== sections || plan.lyrics !== lyrics) {
      plan = { sections, lyrics, list: planLineTransitions(sections, lines ? lyrics?.lines : undefined, seed, kinds) }
    }
    // Cuts sit on the section starts = the director's shot changes; the shot intensity scales them.
    return transitionAt(plan.list, f.baseTime, params, seed, shotGain(f.shot))
  }
  return framedEffect(id, compute, (fr) => (fr.flash ? [fr.flash] : []), {
    dispose() {
      plan = null
    },
  })
}

function burstsEffect(id: string, params: ParamValues, seed: number): Effect {
  const compute = (f: FrameContext): BurstFrame => burstAt(f.timeline.audio, f.baseTime, params, seed, f.shot)
  return framedEffect(id, compute, (fr) => (fr.flash ? [fr.flash] : []))
}

/**
 * Camera tilt the host cannot render goes to the accent pass homography (the frame tilts as a
 * plane); with tilt support the post pass leaves it alone.
 */
function tiltFallback(frame: AccentFrame, hasTilt: boolean): PostDynamics {
  const { tiltX = 0, tiltY = 0 } = frame.camera
  if (hasTilt || (tiltX === 0 && tiltY === 0)) return frame.post
  return { ...frame.post, tiltYaw: frame.post.tiltYaw + tiltY, tiltPitch: frame.post.tiltPitch + tiltX }
}

function accentsEffect(id: string, params: ParamValues, seed: number): Effect {
  const style = str(params, 'style')
  const overlay = {
    fontFamily: WORD_FONTS[str(params, 'font')] ?? WORD_FONTS.display ?? 'sans-serif',
    fontWeight: Number(params.fontWeight) || 800,
  }
  let prepared: { timeline: Timeline; accents: PreparedAccents } | null = null
  let memo: { timeline: Timeline; time: number; frame: AccentFrame } | null = null

  // Accents follow the real (audio) time, not the warped layer time.
  const at = (timeline: Timeline, time: number): AccentFrame => {
    if (memo && memo.timeline === timeline && memo.time === time) return memo.frame
    if (prepared?.timeline !== timeline) {
      prepared = {
        timeline,
        accents: prepareAccents(timeline, {
          style: style === 'none' ? undefined : (style as EffectStyleId),
          seed,
        }),
      }
    }
    const frame = evaluateAccents(prepared.accents, time)
    memo = { timeline, time, frame }
    return frame
  }

  const post = (f: FrameContext) => tiltFallback(at(f.timeline, f.baseTime), hostHasTilt(f))
  const pass = accentsPass(post)
  return {
    id,
    remapTime(time, info) {
      const lag = at(info.timeline, info.baseTime).timeLag
      return lag > 0 ? Math.max(0, time - lag) : time
    },
    camera(f, cam) {
      composeCamera(cam, at(f.timeline, f.baseTime).camera, hostHasTilt(f))
    },
    overlay(g, f) {
      const items = at(f.timeline, f.baseTime).overlays
      if (items.length > 0) drawOverlays(g, items.map((item) => atWord(item, f)), f.layout, overlay)
    },
    post: { ...pass, active: (f) => !isNeutralPost(post(f)) },
    dispose() {
      prepared = null
      memo = null
    },
  }
}

/** Particles start from their word when it is drawn; the origin params are the fallback. */
function atWord(item: OverlayItem, f: FrameContext): OverlayItem {
  if (item.kind !== 'particles' || !item.wordId) return item
  const box = f.words.get(item.wordId)
  if (!box) return item
  return { ...item, originX: box.x / f.layout.width, originY: box.y / f.layout.height }
}

/** Scene effects of a style preset, in application order. Ids are stable (`fx-<type>`). */
export function styleEffects(styleId: EffectStyleId): EffectSpec[] {
  const style = EFFECT_STYLES[styleId]
  return style.effects.map((e) => ({ id: `fx-${e.type}`, type: e.type, params: { ...e.params } }))
}
