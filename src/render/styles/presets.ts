/**
 * The four style presets. A preset = a few curated knobs (`params`, for the "Style" tab) and a
 * builder that turns their values into a complete Scene. `effectStyle` names the matching effect
 * style in `@/effects` (EFFECT_STYLES: camera, post, accent defaults).
 *
 * Layouts use safe-area fractions, so every preset works in 9:16, 16:9, 1:1 and 4:5 unchanged.
 * Centered layers use the 'center' space (the safe area made symmetric — in portrait the plain safe
 * area is shifted left by the action column), edge-to-edge visualizers use 'bleed' or 'frame'.
 */

import { FONT_FAMILY, fontStack } from '../fonts'
import type { LayerSpecInput, SceneInput } from '../scene'
import {
  bool,
  choice,
  color,
  defaultParams,
  FONT_OPTIONS,
  GROUP,
  num,
  resolveParams,
  text,
  type LocalizedText,
  type ParamSpec,
  type ParamValues,
} from './params'

export type StylePresetId = 'studio' | 'neon' | 'minimal' | 'grunge'

export interface StylePreset {
  id: StylePresetId
  name: LocalizedText
  description: LocalizedText
  /** Id of the effect style in `@/effects` (EFFECT_STYLES). */
  effectStyle: StylePresetId
  params: ParamSpec[]
  /** Scene for the given knob values (missing / invalid values fall back to defaults). */
  build(values?: ParamValues): SceneInput
}

const fontOf = (key: string) =>
  fontStack(FONT_FAMILY[(key in FONT_FAMILY ? key : 'grotesk') as keyof typeof FONT_FAMILY])
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
const n = (v: unknown, d: number) => (typeof v === 'number' ? v : d)
const b = (v: unknown) => v === true

/** Hex color with alpha 0..1 → #rrggbbaa. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${hex.slice(0, 7)}${a}`
}

const titleParam = text('title', 'Заголовок', 'Title', '', GROUP.text)

// ---------------------------------------------------------------------------
// Студия — strict meters, grid, monospace labels
// ---------------------------------------------------------------------------

const studio: StylePreset = {
  id: 'studio',
  name: { ru: 'Студия', en: 'Studio' },
  description: {
    ru: 'Строгие измерители: спектр с сеткой, спектрограмма, гониометр, пик/RMS/LUFS, моноширинные подписи',
    en: 'Strict meters: gridded spectrum, spectrogram, goniometer, peak/RMS/LUFS, monospace labels',
  },
  effectStyle: 'studio',
  params: [
    titleParam,
    choice('lyricsFont', 'Шрифт текста', 'Lyrics font', FONT_OPTIONS, 'grotesk', GROUP.text),
    color('accent', 'Акцент', 'Accent', '#7dd3fc', GROUP.visual),
    color('background', 'Фон', 'Background', '#0a0c10', GROUP.background),
    bool('spectrogram', 'Спектрограмма', 'Spectrogram', true, GROUP.meters),
    bool('goniometer', 'Гониометр', 'Goniometer', true, GROUP.meters),
    bool('meters', 'Пик / RMS / LUFS', 'Peak / RMS / LUFS', true, GROUP.meters),
  ],
  build(values) {
    const v = resolveParams(studio.params, values)
    const accent = str(v.accent, '#7dd3fc')
    const mono = fontStack(FONT_FAMILY.mono)
    const grid = 'rgba(148,163,184,0.18)'
    const label = 'rgba(203,213,225,0.7)'
    const layers: LayerSpecInput[] = [
      {
        id: 'bg',
        type: 'background',
        fill: { kind: 'solid', color: str(v.background, '#0a0c10') },
        pulse: null,
        vignette: 0.35,
      },
      {
        id: 'title',
        type: 'text',
        text: str(v.title, ''),
        rect: { x: 0, y: 0, w: 1, h: 0.05 },
        fontFamily: mono,
        fontWeight: 600,
        fontSize: 0.032,
        color: '#e2e8f0',
        align: 'left',
        pulse: null,
      },
      {
        id: 'spectrum',
        type: 'spectrum-curve',
        rect: { x: 0, y: 0.07, w: 1, h: 0.22, space: 'center' },
        style: 'mountain',
        lineColor: accent,
        lineWidth: 0.003,
        fillColors: [withAlpha(accent, 0.05), withAlpha(accent, 0.45)],
        fillOpacity: 0.6,
        grid: true,
        gridColor: grid,
        labels: true,
        labelColor: label,
        fontFamily: mono,
      },
    ]
    if (b(v.spectrogram)) {
      layers.push({
        id: 'spectrogram',
        type: 'spectrogram',
        rect: { x: 0, y: 0.33, w: 1, h: 0.12, space: 'center' },
        grid: true,
        gridColor: grid,
        colormap: [
          { offset: 0, color: '#00000000' },
          { offset: 0.4, color: '#0c4a6e' },
          { offset: 0.75, color: accent },
          { offset: 1, color: '#ffffff' },
        ],
      })
    }
    layers.push({
      id: 'lyrics',
      type: 'lyrics',
      rect: { x: 0, y: 0.47, w: 1, h: 0.14, space: 'center' },
      anchorY: 0.4,
      fontFamily: fontOf(str(v.lyricsFont, 'grotesk')),
      fontWeight: 700,
      fontSize: 0.058,
      fillColor: '#ffffff',
      baseColor: 'rgba(226,232,240,0.35)',
      pulse: null,
    })
    if (b(v.goniometer)) {
      layers.push(
        {
          id: 'goniometer',
          type: 'goniometer',
          rect: { x: 0, y: 0.63, w: 0.46, h: 0.22, space: 'center' },
          color: accent,
          gridColor: grid,
          labelColor: label,
          fontFamily: mono,
        },
        {
          id: 'correlation',
          type: 'correlation',
          rect: { x: 0.04, y: 0.875, w: 0.38, h: 0.012, space: 'center' },
          labelColor: label,
          fontFamily: mono,
        },
      )
    }
    if (b(v.meters)) {
      layers.push({
        id: 'meters',
        type: 'level-meters',
        rect: b(v.goniometer)
          ? { x: 0.54, y: 0.63, w: 0.46, h: 0.25, space: 'center' }
          : { x: 0.1, y: 0.63, w: 0.8, h: 0.25, space: 'center' },
        labelColor: label,
        fontFamily: mono,
        trackColor: 'rgba(148,163,184,0.12)',
      })
    }
    layers.push({
      id: 'waveform',
      type: 'waveform',
      rect: { x: 0, y: 0.93, w: 1, h: 0.06, space: 'bleed' },
      playedColor: accent,
      unplayedColor: 'rgba(148,163,184,0.3)',
      playheadColor: '#f8fafc',
    })
    return { seed: 11, layers }
  },
}

// ---------------------------------------------------------------------------
// Неон — club neon in depth: far floor and drop wave, a vectorscope core behind the lyrics, near
// bars and scope as glowing tubes (wide dim halo + thin bright core; bloom comes from the effects)
// ---------------------------------------------------------------------------

/** Section levels: quiet parts breathe, builds rise, drops go all in. */
const sectionsBy = (quiet: number, build: number, normal = 1) => ({
  quiet,
  build,
  normal,
  drop: 1,
})

const neon: StylePreset = {
  id: 'neon',
  name: { ru: 'Неон', en: 'Neon' },
  description: {
    ru: 'Клубный неон: светящиеся трубки-линии, вектороскоп за текстом, неоновый пол, удары на битах и взрыв на дропе',
    en: 'Club neon: glowing tube lines, a vectorscope behind the lyrics, a neon floor, beat hits and a burst on the drop',
  },
  effectStyle: 'neon',
  params: [
    titleParam,
    color('primary', 'Основной цвет', 'Primary color', '#22d3ee', GROUP.visual),
    color('secondary', 'Второй цвет', 'Secondary color', '#ff2bd6', GROUP.visual),
    color('tertiary', 'Цвет глубины', 'Depth color', '#7c3aed', GROUP.visual),
    color('background', 'Фон', 'Background', '#07000f', GROUP.background),
    choice(
      'visual',
      'Визуализатор',
      'Visualizer',
      [
        ['bars', 'Полосы', 'Bars'],
        ['mountain', 'Горы', 'Mountains'],
        ['both', 'Полосы и линия', 'Bars and line'],
      ],
      'both',
      GROUP.visual,
    ),
    num('barCount', 'Число полос', 'Bar count', 16, 96, 1, 48, GROUP.visual),
    bool('oscilloscope', 'Осциллограф', 'Oscilloscope', true, GROUP.visual),
    bool('core', 'Вектороскоп за текстом', 'Vectorscope behind lyrics', true, GROUP.visual),
    bool('floor', 'Неоновый пол', 'Neon floor', true, GROUP.background),
    num('reaction', 'Реакция на бас', 'Bass reaction', 0, 0.3, 0.01, 0.12, GROUP.motion),
    num('motion', 'Движение на битах', 'Beat motion', 0, 1, 0.05, 0.7, GROUP.motion),
  ],
  build(values) {
    const v = resolveParams(neon.params, values)
    const p = str(v.primary, '#22d3ee')
    const q = str(v.secondary, '#ff2bd6')
    const t = str(v.tertiary, '#7c3aed')
    const reaction = n(v.reaction, 0.12)
    const motion = n(v.motion, 0.7)
    const visual = str(v.visual, 'both')
    const display = fontStack(FONT_FAMILY.display)
    /** Tube = wide dim halo under a thin bright core (same geometry, different width / alpha). */
    const haloOpacity = 0.16

    const layers: LayerSpecInput[] = [
      {
        id: 'bg',
        type: 'background',
        fill: {
          kind: 'radial',
          cx: 0.5,
          cy: 0.62,
          radius: 0.85,
          stops: [
            { offset: 0, color: withAlpha(t, 0.3) },
            { offset: 0.4, color: str(v.background, '#07000f') },
            { offset: 1, color: '#000000' },
          ],
        },
        pulse: { band: 'low', amount: reaction * 0.4 },
        pulseColor: t,
        vignette: 0.55,
      },
    ]

    // Far plane: a neon floor scrolling up from the bottom edge, barely following the camera.
    if (b(v.floor)) {
      layers.push({
        id: 'floor',
        type: 'spectrogram',
        rect: { x: 0, y: 0.72, w: 1, h: 0.28, space: 'frame' },
        direction: 'up',
        historySec: 3,
        gamma: 1.6,
        colormap: [
          { offset: 0, color: '#00000000' },
          { offset: 0.35, color: withAlpha(t, 0.6) },
          { offset: 0.7, color: q },
          { offset: 1, color: '#ffffff' },
        ],
        opacity: 0.4,
        blend: 'lighter',
        motion: { sections: sectionsBy(0.35, 0.7), depth: 0.4 },
      })
    }

    // Drop wave: a huge mirrored mountain across the whole frame, only on drops (near plane).
    layers.push({
      id: 'drop-wave',
      type: 'spectrum-curve',
      rect: { x: 0, y: 0.3, w: 1, h: 0.5, space: 'frame' },
      style: 'mountain',
      mirror: true,
      points: 64,
      lineColor: withAlpha(q, 0.6),
      lineWidth: 0.003,
      fillColors: [withAlpha(t, 0), withAlpha(t, 0.45)],
      fillOpacity: 0.4,
      releaseSec: 0.3,
      pulse: { band: 'low', amount: reaction * 1.5 },
      blend: 'lighter',
      opacity: 0.5,
      motion: {
        sections: { quiet: 0, build: 0.15, normal: 0.25, drop: 1 },
        sectionFadeSec: 0.4,
        beatScale: 0.06 * motion,
        depth: 1.4,
      },
    })

    // Vectorscope core behind the lyrics: a glowing figure that jumps on beats.
    if (b(v.core)) {
      const core = {
        type: 'goniometer' as const,
        rect: { x: 0.1, y: 0.16, w: 0.8, h: 0.44, space: 'center' as const },
        style: 'lines' as const,
        gain: 1.6,
        grid: false,
        labels: false,
        blend: 'lighter' as const,
      }
      const coreMotion = {
        sections: sectionsBy(0.3, 0.6, 0.75),
        beatScale: 0.12 * motion,
        beatAlpha: 0.8 * motion,
        beatSections: { quiet: 0.4, build: 0.8, drop: 1.4 },
        depth: 0.7,
      }
      layers.push(
        {
          ...core,
          id: 'core-halo',
          color: t,
          size: 0.012,
          trail: 6,
          opacity: 0.16,
          motion: coreMotion,
        },
        {
          ...core,
          id: 'core',
          color: p,
          size: 0.0025,
          trail: 3,
          opacity: 0.3,
          motion: coreMotion,
        },
      )
    }

    // Scope as a horizontal tube right under the title: edge to edge, two channels.
    if (b(v.oscilloscope)) {
      const scope = {
        type: 'oscilloscope' as const,
        rect: { x: 0, y: 0.09, w: 1, h: 0.1, space: 'bleed' as const },
        channel: 'stereo' as const,
        color: p,
        color2: q,
        gain: 2,
        blend: 'lighter' as const,
      }
      const scopeMotion = { sections: sectionsBy(0.5, 0.8), beatAlpha: 0.5 * motion, depth: 1.1 }
      layers.push(
        { ...scope, id: 'scope-halo', lineWidth: 0.014, opacity: 0.25, motion: scopeMotion },
        { ...scope, id: 'scope', lineWidth: 0.0035, motion: scopeMotion },
      )
    }

    layers.push(
      {
        id: 'title',
        type: 'text',
        text: str(v.title, ''),
        rect: { x: 0, y: 0, w: 1, h: 0.08, space: 'center' },
        fontFamily: display,
        fontWeight: 800,
        fontSize: 0.055,
        color: '#ffffff',
        uppercase: true,
        pulse: { band: 'low', amount: reaction * 0.3 },
      },
      {
        id: 'lyrics',
        type: 'lyrics',
        rect: { x: 0, y: 0.25, w: 1, h: 0.26, space: 'center' },
        fontFamily: display,
        fontWeight: 800,
        fontSize: 0.066,
        fillColor: '#ffffff',
        baseColor: withAlpha(p, 0.5),
        uppercase: true,
        pulse: { band: 'low', amount: reaction * 0.25 },
        motion: { beatScale: 0.025 * motion, beatSections: { quiet: 0, drop: 1.5 } },
      },
    )

    // Near plane: bars and the spectrum line along the bottom, edge to edge.
    const barsRect = { x: 0, y: 0.6, w: 1, h: 0.4, space: 'bleed' as const }
    const nearMotion = {
      sections: sectionsBy(0.45, 0.75),
      beatScale: 0.05 * motion,
      beatSections: { quiet: 0.3, build: 0.7, drop: 1.4 },
      origin: [0.5, 0.86] as [number, number],
      depth: 1.25,
    }
    if (visual !== 'mountain') {
      const barSpec = {
        type: 'spectrum-bars' as const,
        rect: barsRect,
        anchor: 'center' as const,
        barCount: Math.round(n(v.barCount, 48)),
        reflection: 0,
        pulse: { band: 'low' as const, amount: reaction },
        blend: 'lighter' as const,
        motion: nearMotion,
      }
      layers.push(
        {
          ...barSpec,
          id: 'bars-halo',
          gap: 0,
          radius: 0.5,
          colors: [withAlpha(t, 0.4), withAlpha(q, 0.7)],
          opacity: haloOpacity,
        },
        { ...barSpec, id: 'bars', gap: 0.55, colors: [t, q, p] },
      )
    }
    if (visual !== 'bars') {
      const mountain = visual === 'mountain'
      const curve = {
        type: 'spectrum-curve' as const,
        rect: barsRect,
        style: mountain ? ('mountain' as const) : ('line' as const),
        mirror: true,
        fillColors: [withAlpha(q, 0.1), withAlpha(p, 0.6)],
        fillOpacity: 0.7,
        pulse: { band: 'low' as const, amount: reaction },
        blend: 'lighter' as const,
        motion: nearMotion,
      }
      layers.push(
        {
          ...curve,
          id: 'curve-halo',
          style: 'line',
          lineColor: mountain ? p : q,
          lineWidth: 0.016,
          opacity: haloOpacity,
        },
        { ...curve, id: 'curve', lineColor: mountain ? p : '#ffd6f6', lineWidth: 0.0035 },
      )
    }
    return { seed: 23, layers }
  },
}

// ---------------------------------------------------------------------------
// Минимал — big kinetic typography, visualizer as a quiet background
// ---------------------------------------------------------------------------

const minimal: StylePreset = {
  id: 'minimal',
  name: { ru: 'Минимал', en: 'Minimal' },
  description: {
    ru: 'Крупная кинетическая типографика: слова появляются по одному, вес и размер — от громкости',
    en: 'Big kinetic typography: words pop in one by one, weight and size follow loudness',
  },
  effectStyle: 'minimal',
  params: [
    titleParam,
    choice(
      'layout',
      'Раскладка',
      'Layout',
      [
        ['flow', 'Строкой', 'Flow'],
        ['stack', 'Столбиком', 'Stack'],
        ['focus', 'Одно слово', 'Focus word'],
      ],
      'flow',
      GROUP.text,
    ),
    choice('font', 'Шрифт', 'Font', FONT_OPTIONS, 'grotesk', GROUP.text),
    color('textColor', 'Цвет текста', 'Text color', '#111111', GROUP.text),
    num('contrast', 'Контраст веса', 'Weight contrast', 0, 1, 0.05, 0.75, GROUP.text),
    color('background', 'Фон', 'Background', '#f2efe9', GROUP.background),
    num(
      'visualOpacity',
      'Визуализатор фоном',
      'Background visualizer',
      0,
      0.6,
      0.02,
      0.14,
      GROUP.visual,
    ),
  ],
  build(values) {
    const v = resolveParams(minimal.params, values)
    const ink = str(v.textColor, '#111111')
    const contrast = n(v.contrast, 0.75)
    const layout = str(v.layout, 'flow') as 'flow' | 'stack' | 'focus'
    const fontKey = str(v.font, 'grotesk')
    // Variable weight range of the chosen font (Oswald stops at 700, mono at 800).
    const maxW = fontKey === 'condensed' ? 700 : fontKey === 'mono' ? 800 : 900
    const layers: LayerSpecInput[] = [
      {
        id: 'bg',
        type: 'background',
        fill: { kind: 'solid', color: str(v.background, '#f2efe9') },
        pulse: null,
        vignette: 0,
      },
      {
        id: 'visual',
        type: 'spectrum-curve',
        rect: { x: 0, y: 0.55, w: 1, h: 0.45, space: 'frame' },
        style: 'mountain',
        lineColor: ink,
        lineWidth: 0.002,
        fillColors: [withAlpha(ink, 0), withAlpha(ink, 1)],
        fillOpacity: 1,
        opacity: n(v.visualOpacity, 0.14),
        releaseSec: 0.35,
      },
      {
        id: 'title',
        type: 'text',
        text: str(v.title, ''),
        rect: { x: 0, y: 0, w: 1, h: 0.06 },
        fontFamily: fontStack(FONT_FAMILY.grotesk),
        fontWeight: 500,
        fontSize: 0.03,
        color: withAlpha(ink, 0.6),
        align: 'left',
        uppercase: false,
        pulse: null,
      },
      {
        id: 'kinetic',
        type: 'kinetic',
        rect: { x: 0, y: 0.1, w: 1, h: 0.6, space: 'center' },
        mode: layout,
        fontFamily: fontOf(fontKey),
        fontSize: layout === 'focus' ? 0.2 : layout === 'stack' ? 0.13 : 0.11,
        weightMax: maxW,
        weightMin: Math.round((maxW - (maxW - 100) * contrast) / 100) * 100,
        color: ink,
        activeColor: ink,
        align: layout === 'flow' ? 'left' : 'center',
        sizeReact: 0.15 * contrast,
        appearScale: 1.12,
      },
      {
        id: 'waveform',
        type: 'waveform',
        rect: { x: 0, y: 0.95, w: 1, h: 0.03, space: 'bleed' },
        barWidth: 0.004,
        playedColor: ink,
        unplayedColor: withAlpha(ink, 0.2),
        playheadWidth: 0,
      },
    ]
    return { seed: 31, layers }
  },
}

// ---------------------------------------------------------------------------
// Гранж — noise, torn text, aggression on beats
// ---------------------------------------------------------------------------

const grunge: StylePreset = {
  id: 'grunge',
  name: { ru: 'Гранж', en: 'Grunge' },
  description: {
    ru: 'Шум и царапины, рваный текст, агрессивные удары на битах',
    en: 'Noise and scratches, torn text, aggressive hits on beats',
  },
  effectStyle: 'grunge',
  params: [
    titleParam,
    choice('font', 'Шрифт', 'Font', FONT_OPTIONS, 'condensed', GROUP.text),
    color('accent', 'Акцент', 'Accent', '#ef4444', GROUP.visual),
    color('background', 'Фон', 'Background', '#0c0a09', GROUP.background),
    num('aggression', 'Агрессия', 'Aggression', 0, 1, 0.05, 0.7, GROUP.motion),
    num('noise', 'Шум', 'Noise', 0, 0.6, 0.02, 0.28, GROUP.background),
  ],
  build(values) {
    const v = resolveParams(grunge.params, values)
    const accent = str(v.accent, '#ef4444')
    const agg = n(v.aggression, 0.7)
    const font = fontOf(str(v.font, 'condensed'))
    const layers: LayerSpecInput[] = [
      {
        id: 'bg',
        type: 'background',
        fill: {
          kind: 'radial',
          cx: 0.5,
          cy: 0.4,
          radius: 0.8,
          stops: [
            { offset: 0, color: '#292524' },
            { offset: 1, color: str(v.background, '#0c0a09') },
          ],
        },
        pulse: { band: 'low', amount: 0.12 * agg },
        pulseColor: accent,
        vignette: 0.7,
      },
      {
        id: 'bars',
        type: 'spectrum-bars',
        rect: { x: 0, y: 0.68, w: 1, h: 0.32, space: 'frame' },
        barCount: 28,
        gap: 0.12,
        radius: 0,
        colors: ['#57534e', '#a8a29e', accent],
        reflection: 0,
        gamma: 1.6,
        releaseSec: 0.08,
        pulse: { band: 'low', amount: 0.15 * agg },
      },
      {
        id: 'title',
        type: 'text',
        text: str(v.title, ''),
        rect: { x: 0, y: 0, w: 1, h: 0.08 },
        fontFamily: font,
        fontWeight: 700,
        fontSize: 0.05,
        color: accent,
        align: 'left',
        pulse: null,
      },
      {
        id: 'kinetic',
        type: 'kinetic',
        rect: { x: 0, y: 0.1, w: 1, h: 0.55, space: 'center' },
        mode: 'stack',
        fontFamily: font,
        uppercase: true,
        weightMin: 500,
        weightMax: 700,
        fontSize: 0.16,
        lineHeight: 0.95,
        color: '#f5f5f4',
        activeColor: accent,
        futureOpacity: 0,
        appearScale: 1 + 0.25 * agg,
        sizeReact: 0.1,
        appearSec: 0.08,
        beatPunch: 0.15 * agg,
        jitter: 0.012 * agg,
        jitterRotate: 5 * agg,
        tear: agg,
      },
      {
        id: 'noise',
        type: 'noise',
        amount: n(v.noise, 0.28),
        scratches: Math.round(4 * agg),
        refreshHz: 12,
      },
    ]
    return { seed: 47, layers }
  },
}

export const STYLE_PRESETS: readonly StylePreset[] = [studio, neon, minimal, grunge]
export const DEFAULT_STYLE_PRESET: StylePresetId = 'neon'

export function getStylePreset(id: string): StylePreset {
  return STYLE_PRESETS.find((p) => p.id === id) ?? neon
}

export function presetDefaults(preset: StylePreset): ParamValues {
  return defaultParams(preset.params)
}

/** Scene for a preset id with optional knob values (e.g. the track title). */
export function buildPresetScene(id: string, values?: ParamValues): SceneInput {
  const preset = getStylePreset(id)
  return preset.build({ ...presetDefaults(preset), ...values })
}
