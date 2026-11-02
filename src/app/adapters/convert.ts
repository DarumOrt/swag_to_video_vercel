/** `ParamSpec` (`@/render`, `@/effects`: RU+EN labels) → `ParamSchema` for the generic form. */
import type { ParamSpec } from '@/render'
import type { ParamSchema } from './params'

export function toSchema(spec: ParamSpec): ParamSchema {
  const base = {
    key: spec.key,
    label: spec.label.ru,
    ...(spec.group ? { group: spec.group.ru } : {}),
  }
  switch (spec.type) {
    case 'number':
      return {
        ...base,
        kind: 'range',
        min: spec.min,
        max: spec.max,
        step: spec.step,
        default: spec.default,
      }
    case 'boolean':
      return { ...base, kind: 'toggle', default: spec.default }
    case 'enum':
      return {
        ...base,
        kind: 'select',
        options: spec.options.map((o) => ({ value: o.value, label: o.label.ru })),
        default: spec.default,
      }
    case 'color':
      return { ...base, kind: 'color', default: spec.default }
    case 'text':
      return {
        ...base,
        kind: 'text',
        default: spec.default,
        ...(spec.placeholder ? { placeholder: spec.placeholder.ru } : {}),
      }
  }
}
