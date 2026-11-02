/** Shared helpers for the render dev page and its worker. Dev-only. */

import * as effectsModule from '@/effects'
import type { EffectFactory } from '../effectsHost'
import type { SceneInput } from '../scene'
import { createSampleEffect, SAMPLE_EFFECTS } from './sampleEffects'

export const DEV_DURATION_SEC = 32

export interface DevSceneOptions {
  title: string
  /** Add the sample effects from sampleEffects.ts. */
  demoEffects: boolean
}

export function devScene(o: DevSceneOptions): SceneInput {
  return {
    seed: 7,
    layers: [
      { id: 'bg', type: 'background' },
      { id: 'spectrum', type: 'spectrum-bars' },
      { id: 'title', type: 'text', text: o.title },
      { id: 'lyrics', type: 'lyrics' },
    ],
    effects: o.demoEffects ? SAMPLE_EFFECTS : [],
  }
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
