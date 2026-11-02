/** Shared by the effects dev page and its worker. Dev-only. */

import { createDefaultScene, createFakeTimeline, type SceneInput } from '@/render'
import type { AccentEffectId, Timeline } from '@/shared'
import { ACCENT_EFFECTS, ACCENT_EFFECT_ORDER } from '../accents'
import { styleEffects } from '../host'
import type { ParamValues } from '../params'
import type { EffectStyleId } from '../presets'

export const DEV_DURATION_SEC = 40

/** Everything a frame depends on — posted to the worker as-is. */
export interface DevState {
  style: EffectStyleId
  /** 'cycle' = every priority effect in turn, otherwise one effect on all accents. */
  accentMode: 'cycle' | AccentEffectId
  accentParams: ParamValues
  quality: 'low' | 'medium' | 'high'
  /** Effect types switched off by the user. */
  disabled: string[]
  noRhythmExtras: boolean
}

/** Fake timeline with an accent on every third word. */
export function devTimeline(s: DevState): Timeline {
  const tl = createFakeTimeline({ durationSec: DEV_DURATION_SEC })
  if (s.noRhythmExtras) {
    delete tl.audio.rhythm.beatStrength
    delete tl.audio.sections
  }
  const words = (tl.lyrics?.lines ?? []).flatMap((l) => l.words)
  tl.accents = words
    .filter((_, i) => i % 3 === 1)
    .map((w, i) => {
      const effect = s.accentMode === 'cycle' ? ACCENT_EFFECT_ORDER[i % ACCENT_EFFECT_ORDER.length]! : s.accentMode
      const d = ACCENT_EFFECTS[effect].defaults
      return {
        id: `acc-${w.id}`,
        wordId: w.id,
        effect,
        source: 'user' as const,
        preRollSec: d.preRollSec,
        durationSec: d.durationSec,
        intensity: d.intensity,
        params: s.accentMode === 'cycle' ? {} : { ...s.accentParams },
      }
    })
  return tl
}

export function devScene(s: DevState): SceneInput {
  const effects = styleEffects(s.style)
    .filter((e) => !s.disabled.includes(e.type))
    .map((e) => (e.type === 'bloom' ? { ...e, params: { ...e.params, quality: s.quality } } : e))
  return { ...createDefaultScene(`Стиль: ${s.style}`), seed: 7, effects }
}

/** FNV-1a over RGBA bytes. */
export function hashPixels(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] ?? 0
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
