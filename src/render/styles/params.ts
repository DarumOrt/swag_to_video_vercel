/**
 * Parameter descriptions for auto-generated UI. Same shape as `ParamSpec` in `@/effects`
 * (number / boolean / enum / color with RU+EN labels) plus `text`, so the UI can use one form builder.
 */

export interface LocalizedText {
  ru: string
  en: string
}

interface ParamSpecBase {
  key: string
  label: LocalizedText
  hint?: LocalizedText
  /** Optional group heading in the generated form. */
  group?: LocalizedText
}

export type ParamSpec =
  | (ParamSpecBase & {
      type: 'number'
      min: number
      max: number
      step: number
      default: number
      unit?: string
    })
  | (ParamSpecBase & { type: 'boolean'; default: boolean })
  | (ParamSpecBase & {
      type: 'enum'
      options: { value: string; label: LocalizedText }[]
      default: string
    })
  | (ParamSpecBase & { type: 'color'; default: string })
  | (ParamSpecBase & { type: 'text'; default: string; placeholder?: LocalizedText })

export type ParamValue = number | string | boolean
export type ParamValues = Record<string, ParamValue>

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i

export function defaultParams(specs: readonly ParamSpec[]): ParamValues {
  return Object.fromEntries(specs.map((s) => [s.key, s.default]))
}

/** Values for every spec: valid given values (numbers clamped), defaults otherwise. */
export function resolveParams(
  specs: readonly ParamSpec[],
  values: Readonly<ParamValues> = {},
): ParamValues {
  const out: ParamValues = {}
  for (const s of specs) {
    const v = values[s.key]
    switch (s.type) {
      case 'number':
        out[s.key] =
          typeof v === 'number' && Number.isFinite(v)
            ? Math.min(Math.max(v, s.min), s.max)
            : s.default
        break
      case 'boolean':
        out[s.key] = typeof v === 'boolean' ? v : s.default
        break
      case 'enum':
        out[s.key] = typeof v === 'string' && s.options.some((o) => o.value === v) ? v : s.default
        break
      case 'color':
        out[s.key] = typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : s.default
        break
      case 'text':
        out[s.key] = typeof v === 'string' ? v : s.default
        break
    }
  }
  return out
}

// Small builders keep the tables below readable.
export const num = (
  key: string,
  ru: string,
  en: string,
  min: number,
  max: number,
  step: number,
  def: number,
  group?: LocalizedText,
): ParamSpec => ({ key, label: { ru, en }, type: 'number', min, max, step, default: def, group })
export const bool = (
  key: string,
  ru: string,
  en: string,
  def: boolean,
  group?: LocalizedText,
): ParamSpec => ({
  key,
  label: { ru, en },
  type: 'boolean',
  default: def,
  group,
})
export const color = (
  key: string,
  ru: string,
  en: string,
  def: string,
  group?: LocalizedText,
): ParamSpec => ({
  key,
  label: { ru, en },
  type: 'color',
  default: def,
  group,
})
export const choice = (
  key: string,
  ru: string,
  en: string,
  options: [string, string, string][],
  def: string,
  group?: LocalizedText,
): ParamSpec => ({
  key,
  label: { ru, en },
  type: 'enum',
  options: options.map(([value, r, e]) => ({ value, label: { ru: r, en: e } })),
  default: def,
  group,
})
export const text = (
  key: string,
  ru: string,
  en: string,
  def: string,
  group?: LocalizedText,
): ParamSpec => ({
  key,
  label: { ru, en },
  type: 'text',
  default: def,
  group,
})

export const GROUP = {
  text: { ru: 'Текст', en: 'Text' },
  background: { ru: 'Фон', en: 'Background' },
  visual: { ru: 'Визуализатор', en: 'Visualizer' },
  meters: { ru: 'Измерители', en: 'Meters' },
  motion: { ru: 'Движение', en: 'Motion' },
} as const

/** Embedded font choices (values map to FONT_FAMILY keys). */
export const FONT_OPTIONS: [string, string, string][] = [
  ['grotesk', 'Inter (гротеск)', 'Inter (grotesque)'],
  ['display', 'Unbounded (дисплейный)', 'Unbounded (display)'],
  ['condensed', 'Oswald (узкий)', 'Oswald (condensed)'],
  ['mono', 'JetBrains Mono (моно)', 'JetBrains Mono (mono)'],
]

/** Text reveal modes of the lyrics layer (values = TextReveal). */
export const REVEAL_OPTIONS: [string, string, string][] = [
  ['karaoke', 'Караоке (подсветка)', 'Karaoke (highlight)'],
  ['word', 'По словам', 'Word by word'],
  ['word-solo', 'Одно слово', 'Single word'],
  ['line', 'Строкой', 'Whole line'],
  ['typewriter', 'Печатная машинка', 'Typewriter'],
  ['pop', 'Выскакивают', 'Pop'],
]

/** Kinetic layer reveal modes (one word alone = the `focus` layout). */
export const KINETIC_REVEAL_OPTIONS: [string, string, string][] = [
  ['word', 'По словам', 'Word by word'],
  ['line', 'Строкой', 'Whole line'],
  ['typewriter', 'Печатная машинка', 'Typewriter'],
  ['pop', 'Выскакивают', 'Pop'],
]

/** Enter / exit animations (values = TextAnim). */
export const ANIM_OPTIONS: [string, string, string][] = [
  ['fade', 'Проявление', 'Fade'],
  ['slide-up', 'Снизу вверх', 'Slide up'],
  ['scale', 'Масштаб', 'Scale'],
  ['blur', 'Из размытия', 'Blur'],
  ['none', 'Без анимации', 'None'],
]

/** When a line leaves (values = LineExit). */
export const EXIT_OPTIONS: [string, string, string][] = [
  ['line-end', 'После последнего слова', 'After its last word'],
  ['next-line', 'Со следующей строкой', 'With the next line'],
]
