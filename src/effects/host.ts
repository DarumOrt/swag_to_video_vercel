/**
 * Adapters from the pure effect logic to the render engine's effects host (`createEffect`).
 * Scene effect types:
 *
 *   accents              — every accent of timeline.accents (camera, overlay, time warp, post pass)
 *   beat-camera          — camera pulse / kick / sway on beats, boosted in drops
 *   beat-flash           — overlay flash on strong beats
 *   bloom, chromatic-aberration, color-grade, vignette, scanlines, grain — WebGL2 post passes
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
import { resolveParams, str, type LocalizedText, type ParamSpec, type ParamValues } from './params'
import { accentsPass, createPostPass } from './post/passes'
import { POST_EFFECTS, type PostEffectType } from './post/settings'
import { EFFECT_STYLE_ORDER, EFFECT_STYLES, type EffectStyleId } from './presets'
import { applyBeatCamera, BEAT_CAMERA_PARAMS, BEAT_FLASH_PARAMS, beatFlash } from './rhythm'
import { isNeutralPost, type AccentFrame, type OverlayItem } from './types'

export type EffectType = 'accents' | 'beat-camera' | 'beat-flash' | PostEffectType

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
        camera: (f, cam) => applyBeatCamera(f.timeline.audio, f.baseTime, params, seed, cam),
      }
    case 'beat-flash':
      return {
        id: spec.id,
        overlay(g, f) {
          const flash = beatFlash(f.timeline.audio, f.baseTime, params)
          if (flash) drawOverlays(g, [flash], f.layout)
        },
      }
    default:
      return { id: spec.id, post: createPostPass(spec.type, params) }
  }
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

  const pass = accentsPass((f) => at(f.timeline, f.baseTime).post)
  return {
    id,
    remapTime(time, info) {
      const lag = at(info.timeline, info.baseTime).timeLag
      return lag > 0 ? Math.max(0, time - lag) : time
    },
    camera(f, cam) {
      const c = at(f.timeline, f.baseTime).camera
      cam.zoom *= c.zoom
      cam.rotation += c.rotation
      cam.x += c.x
      cam.y += c.y
    },
    overlay(g, f) {
      const items = at(f.timeline, f.baseTime).overlays
      if (items.length > 0) drawOverlays(g, items.map((item) => atWord(item, f)), f.layout, overlay)
    },
    post: { ...pass, active: (f) => !isNeutralPost(at(f.timeline, f.baseTime).post) },
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
