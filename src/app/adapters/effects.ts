/** Accent effects from `@/effects` in the shape the UI uses. */
import { ACCENT_EFFECT_ORDER, ACCENT_EFFECTS as EFFECT_DEFS } from '@/effects'
import type { AccentEffectId } from '@/shared'
import { toSchema } from './convert'
import type { ParamSchema } from './params'

export interface AccentEffectInfo {
  id: AccentEffectId
  name: string
  description: string
  /** Effect-specific params (`Accent.params`). */
  params: readonly ParamSchema[]
}

export const ACCENT_EFFECTS: readonly AccentEffectInfo[] = ACCENT_EFFECT_ORDER.map((id) => {
  const def = EFFECT_DEFS[id]
  return {
    id,
    name: def.label.ru,
    description: def.description.ru,
    params: def.params.map(toSchema),
  }
})

export function effectInfo(id: AccentEffectId): AccentEffectInfo {
  return ACCENT_EFFECTS.find((effect) => effect.id === id) ?? ACCENT_EFFECTS[0]!
}
