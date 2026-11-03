/** Shared helpers for the render dev page and its worker. Dev-only. */

import * as effectsModule from '@/effects'
import type { EffectFactory, EffectSpec } from '../effectsHost'
import type { SceneInput } from '../scene'
import { buildPresetScene, getStylePreset } from '../styles/presets'
import { createFakeTimeline } from './fakeTimeline'
import { createSampleEffect, SAMPLE_EFFECTS } from './sampleEffects'

export const DEV_DURATION_SEC = 32

export interface DevSceneOptions {
  /** Style preset id, or 'default' for the basic scene. */
  preset: string
  title: string
  /** Add the sample effects from sampleEffects.ts. */
  demoEffects: boolean
  /** Add the preset's effect style from `@/effects` (camera, bloom, flashes...), as in the app. */
  styleEffects?: boolean
  /** Scene seed override (another "edit" of the same preset); missing = the preset's own. */
  seed?: number
  /** Story sections in the fake timeline (roles intro … outro, repeat groups). */
  story?: boolean
  /** Text reveal / animation / scale overrides ('' = the preset's own). */
  textMode?: string
  textAnim?: string
  textScale?: number
}

/** Fake timeline of the dev page (and its worker) for the given options. */
export function devTimeline(o: Pick<DevSceneOptions, 'story'>) {
  return createFakeTimeline({ durationSec: DEV_DURATION_SEC, story: o.story === true })
}

export function devScene(o: DevSceneOptions): SceneInput {
  const effects = o.demoEffects ? [...SAMPLE_EFFECTS] : []
  if (o.preset !== 'default') {
    const styleFx = (effectsModule as { styleEffects?: (id: string) => EffectSpec[] }).styleEffects
    if (o.styleEffects && styleFx) effects.push(...styleFx(getStylePreset(o.preset).effectStyle))
    const scene = buildPresetScene(o.preset, { title: o.title, ...textValues(o) })
    return { ...scene, effects, seed: o.seed ?? scene.seed }
  }
  return {
    seed: o.seed ?? 7,
    layers: [
      { id: 'bg', type: 'background' },
      { id: 'spectrum', type: 'spectrum-bars' },
      { id: 'title', type: 'text', text: o.title },
      {
        id: 'lyrics',
        type: 'lyrics',
        ...(o.textMode ? { reveal: o.textMode as 'word' } : {}),
        ...(o.textAnim ? { anim: o.textAnim as 'fade' } : {}),
        scale: o.textScale ?? 1,
      },
    ],
    effects,
  }
}

/** Preset values for the text overrides (a mode the preset does not offer falls back to its default). */
function textValues(o: DevSceneOptions): Record<string, string | number> {
  const v: Record<string, string | number> = {}
  if (o.textMode) v.textMode = o.textMode
  if (o.textAnim) v.textAnim = o.textAnim
  if (o.textScale !== undefined) v.textScale = o.textScale
  return v
}

/** Sample effects first, then the real `@/effects` factory (when it exists). */
export const devEffectFactory: EffectFactory = (spec, env) => {
  const real = (effectsModule as { createEffect?: EffectFactory }).createEffect
  return createSampleEffect(spec, env) ?? real?.(spec, env) ?? null
}

/** FNV-1a over RGBA bytes — enough to compare two renders of the same frame. */
export function hashPixels(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] ?? 0
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
