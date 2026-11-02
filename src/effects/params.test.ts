import { describe, expect, it } from 'vitest'
import { ACCENT_EFFECT_ORDER, ACCENT_EFFECTS } from './accents'
import { defaultParams, resolveParams, type ParamSpec } from './params'
import { EFFECT_TYPES } from './host'

const specs: ParamSpec[] = [
  { key: 'n', type: 'number', label: { ru: 'n', en: 'n' }, min: 0, max: 1, step: 0.1, default: 0.5 },
  { key: 'b', type: 'boolean', label: { ru: 'b', en: 'b' }, default: true },
  {
    key: 'e',
    type: 'enum',
    label: { ru: 'e', en: 'e' },
    options: [
      { value: 'a', label: { ru: 'a', en: 'a' } },
      { value: 'z', label: { ru: 'z', en: 'z' } },
    ],
    default: 'a',
  },
  { key: 'c', type: 'color', label: { ru: 'c', en: 'c' }, default: '#ffffff' },
]

describe('resolveParams', () => {
  it('fills defaults and drops unknown keys', () => {
    expect(resolveParams(specs, { extra: 1 })).toEqual({ n: 0.5, b: true, e: 'a', c: '#ffffff' })
  })

  it('clamps numbers and rejects wrong types', () => {
    expect(resolveParams(specs, { n: 7, b: 'yes', e: 'q', c: 'red' })).toEqual({ ...defaultParams(specs), n: 1 })
    expect(resolveParams(specs, { n: NaN }).n).toBe(0.5)
    expect(resolveParams(specs, { e: 'z', c: '#FF0000' })).toMatchObject({ e: 'z', c: '#ff0000' })
  })
})

describe('published param specs', () => {
  const all: [string, ParamSpec[]][] = [
    ...ACCENT_EFFECT_ORDER.map((id) => [id, ACCENT_EFFECTS[id].params] as [string, ParamSpec[]]),
    ...Object.values(EFFECT_TYPES).map((t) => [t.type, t.params] as [string, ParamSpec[]]),
  ]

  it.each(all)('%s: unique keys, defaults inside ranges, labels in RU and EN', (_, list) => {
    const keys = new Set<string>()
    for (const s of list) {
      expect(keys.has(s.key)).toBe(false)
      keys.add(s.key)
      expect(s.label.ru && s.label.en).toBeTruthy()
      if (s.type === 'number') {
        expect(s.min).toBeLessThanOrEqual(s.default)
        expect(s.default).toBeLessThanOrEqual(s.max)
        expect(s.step).toBeGreaterThan(0)
      }
      if (s.type === 'enum') expect(s.options.some((o) => o.value === s.default)).toBe(true)
    }
  })

  it('every accent effect is listed once in the UI order', () => {
    expect(new Set(ACCENT_EFFECT_ORDER).size).toBe(Object.keys(ACCENT_EFFECTS).length)
  })
})
