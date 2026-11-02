/**
 * STUB style presets with the shape the UI expects from `@/render` (preset list + param schema +
 * scene builder). Builds a `SceneInput` out of the render module's existing layers.
 */
import { FONT_FAMILY, fontStack, normalizeScene, type Scene, type SceneInput } from '@/render'
import { defaultValues, resolveValues, type ParamSchema, type ParamValues } from './params'

export interface StylePreset {
  id: string
  name: string
  description: string
  params: readonly ParamSchema[]
  build: (values: ParamValues) => SceneInput
}

const FONT_OPTIONS = [
  { value: 'grotesk', label: 'Inter' },
  { value: 'display', label: 'Unbounded' },
  { value: 'condensed', label: 'Oswald' },
] as const

interface Palette {
  bgTop: string
  bgBottom: string
  bars: [string, string]
  text: string
  font: (typeof FONT_OPTIONS)[number]['value']
  bars0: number
  vignette: number
  uppercase: boolean
}

function schemaFor(p: Palette): ParamSchema[] {
  return [
    {
      key: 'title',
      label: 'Заголовок',
      kind: 'text',
      default: '',
      placeholder: 'Без заголовка',
      group: 'Текст',
    },
    {
      key: 'font',
      label: 'Шрифт',
      kind: 'select',
      options: FONT_OPTIONS,
      default: p.font,
      group: 'Текст',
    },
    { key: 'textColor', label: 'Цвет текста', kind: 'color', default: p.text, group: 'Текст' },
    { key: 'uppercase', label: 'Заглавными', kind: 'toggle', default: p.uppercase, group: 'Текст' },
    { key: 'bgTop', label: 'Фон сверху', kind: 'color', default: p.bgTop, group: 'Фон' },
    { key: 'bgBottom', label: 'Фон снизу', kind: 'color', default: p.bgBottom, group: 'Фон' },
    {
      key: 'vignette',
      label: 'Виньетка',
      kind: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      default: p.vignette,
      group: 'Фон',
    },
    { key: 'showBars', label: 'Спектр', kind: 'toggle', default: true, group: 'Визуализатор' },
    {
      key: 'barsLow',
      label: 'Цвет основания',
      kind: 'color',
      default: p.bars[0],
      group: 'Визуализатор',
    },
    {
      key: 'barsHigh',
      label: 'Цвет пиков',
      kind: 'color',
      default: p.bars[1],
      group: 'Визуализатор',
    },
    {
      key: 'reaction',
      label: 'Реакция на бас',
      kind: 'range',
      min: 0,
      max: 0.4,
      step: 0.01,
      default: p.bars0,
      group: 'Визуализатор',
    },
  ]
}

function preset(id: string, name: string, description: string, palette: Palette): StylePreset {
  const params = schemaFor(palette)
  return {
    id,
    name,
    description,
    params,
    build: (input) => {
      const v = resolveValues(params, input)
      const font = fontStack(FONT_FAMILY[v.font as Palette['font']] ?? FONT_FAMILY.grotesk)
      const title = String(v.title).trim()
      return {
        seed: 1,
        layers: [
          {
            id: 'bg',
            type: 'background',
            fill: {
              kind: 'linear',
              angleDeg: 180,
              stops: [
                { offset: 0, color: String(v.bgTop) },
                { offset: 1, color: String(v.bgBottom) },
              ],
            },
            pulseColor: String(v.barsLow),
            vignette: Number(v.vignette),
          },
          {
            id: 'spectrum',
            type: 'spectrum-bars',
            enabled: Boolean(v.showBars),
            colors: [String(v.barsLow), String(v.barsHigh)],
            pulse: { band: 'low', amount: Number(v.reaction) },
          },
          {
            id: 'title',
            type: 'text',
            text: title,
            enabled: title.length > 0,
            fontFamily: font,
            color: String(v.textColor),
            uppercase: Boolean(v.uppercase),
          },
          {
            id: 'lyrics',
            type: 'lyrics',
            fontFamily: font,
            fillColor: String(v.textColor),
            uppercase: Boolean(v.uppercase),
          },
        ],
      }
    },
  }
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  preset('studio', 'Студия', 'Спокойный графит, как у измерителей в DAW', {
    bgTop: '#15161c',
    bgBottom: '#0b0c10',
    bars: ['#2dd4a7', '#e6fff7'],
    text: '#f2f3f7',
    font: 'grotesk',
    bars0: 0.08,
    vignette: 0.35,
    uppercase: false,
  }),
  preset('neon', 'Неон', 'Глубокий фиолетовый и яркие пики', {
    bgTop: '#0b0820',
    bgBottom: '#1a0b2e',
    bars: ['#4f46e5', '#f0abfc'],
    text: '#ffffff',
    font: 'display',
    bars0: 0.16,
    vignette: 0.5,
    uppercase: true,
  }),
  preset('minimal', 'Минимал', 'Светлый фон, один цвет, много воздуха', {
    bgTop: '#f4f2ee',
    bgBottom: '#e9e6df',
    bars: ['#1c1c1c', '#1c1c1c'],
    text: '#141414',
    font: 'grotesk',
    bars0: 0.04,
    vignette: 0,
    uppercase: false,
  }),
  preset('grunge', 'Гранж', 'Грязный тёплый тон, узкий шрифт, сильная реакция', {
    bgTop: '#2a1f17',
    bgBottom: '#0e0a07',
    bars: ['#b45309', '#fde68a'],
    text: '#fef3c7',
    font: 'condensed',
    bars0: 0.25,
    vignette: 0.7,
    uppercase: true,
  }),
]

export const DEFAULT_PRESET_ID = 'studio'

export function findPreset(id: string): StylePreset {
  return STYLE_PRESETS.find((p) => p.id === id) ?? STYLE_PRESETS[0]!
}

export function presetDefaults(id: string): ParamValues {
  return defaultValues(findPreset(id).params)
}

/** Scene for a preset and its values — one object shared by preview and export. */
export function buildScene(presetId: string, values: ParamValues): Scene {
  return normalizeScene(findPreset(presetId).build(values))
}
