/**
 * Accent effects bound to words (`AccentEffectId`). Each effect is a pure function of
 * (time, accent window, envelope, word, params, seed) that adds to the frame being built:
 * camera, overlays, post uniforms or a time offset. No state between frames.
 */

import type { AccentEffectId, LyricWord } from '@/shared'
import type { AccentWindow, EnvelopeShape } from './envelope'
import { clamp01, ease, hash32, noise1, rand, type CurveId } from './math'
import { bool, num, str, type LocalizedText, type ParamSpec, type ParamValues } from './params'
import { PARTICLE_STRIDE, type CameraTransform, type OverlayItem, type PostDynamics } from './types'

/** Mutable frame under construction; accents and rhythm add to it in order. */
export interface FrameBuilder {
  camera: CameraTransform
  overlays: OverlayItem[]
  post: PostDynamics
  /** Seconds the scene layers lag behind real time (slow-motion). */
  timeLag: number
}

export interface AccentContext {
  time: number
  window: AccentWindow
  /** Envelope 0..1 (elastic release may overshoot), without intensity. */
  envelope: number
  /** Accent intensity 0..1. */
  intensity: number
  /** envelope × intensity — the usual "how much" value. */
  level: number
  /** Linear 0..1 across the whole window. */
  progress: number
  /** Seconds since the word start (negative during pre-roll). */
  sinceHit: number
  word: LyricWord
  params: ParamValues
  /** Stable per accent (hash of scene seed and accent id). */
  seed: number
}

export interface AccentEffectDef {
  id: AccentEffectId
  label: LocalizedText
  description: LocalizedText
  /** Defaults for a newly placed accent. */
  defaults: { preRollSec: number; durationSec: number; intensity: number }
  /** Includes the shared `attack` / `release` curve params. */
  params: ParamSpec[]
  apply(ctx: AccentContext, out: FrameBuilder): void
}

// ---------------------------------------------------------------------------
// Shared params
// ---------------------------------------------------------------------------

const CURVE_OPTIONS: { value: CurveId; label: LocalizedText }[] = [
  { value: 'linear', label: { ru: 'Линейно', en: 'Linear' } },
  { value: 'ease', label: { ru: 'Плавно', en: 'Ease' } },
  { value: 'sharp', label: { ru: 'Резко', en: 'Sharp' } },
  { value: 'soft', label: { ru: 'Мягко', en: 'Soft' } },
  { value: 'elastic', label: { ru: 'Пружина', en: 'Elastic' } },
]

function envelopeParams(attack: CurveId, release: CurveId): ParamSpec[] {
  return [
    {
      key: 'attack',
      type: 'enum',
      label: { ru: 'Атака', en: 'Attack' },
      hint: { ru: 'Кривая нарастания до удара', en: 'Curve leading into the hit' },
      options: CURVE_OPTIONS,
      default: attack,
    },
    {
      key: 'release',
      type: 'enum',
      label: { ru: 'Спад', en: 'Release' },
      hint: { ru: 'Кривая затухания после удара', en: 'Curve after the hit' },
      options: CURVE_OPTIONS,
      default: release,
    },
  ]
}

export function envelopeShapeOf(params: ParamValues): EnvelopeShape {
  return { attack: str(params, 'attack') as CurveId, release: str(params, 'release') as CurveId }
}

const n = (
  key: string,
  ru: string,
  en: string,
  min: number,
  max: number,
  step: number,
  def: number,
  unit?: string,
): ParamSpec => ({ key, type: 'number', label: { ru, en }, min, max, step, default: def, unit })

const DEG = Math.PI / 180

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

const zoomPunch: AccentEffectDef = {
  id: 'zoom-punch',
  label: { ru: 'Zoom-удар', en: 'Zoom punch' },
  description: { ru: 'Резкий наезд камеры на слове', en: 'A quick camera push-in on the word' },
  defaults: { preRollSec: 0.04, durationSec: 0.35, intensity: 0.8 },
  params: [
    n('zoom', 'Сила наезда', 'Zoom amount', 0, 0.6, 0.01, 0.16),
    n('rotate', 'Поворот', 'Rotation', -15, 15, 0.5, 0, '°'),
    ...envelopeParams('sharp', 'soft'),
  ],
  apply(c, out) {
    out.camera.zoom *= 1 + num(c.params, 'zoom') * c.level
    out.camera.rotation += num(c.params, 'rotate') * DEG * c.level
  },
}

const shake: AccentEffectDef = {
  id: 'shake',
  label: { ru: 'Тряска', en: 'Shake' },
  description: { ru: 'Дрожание камеры', en: 'Camera shake' },
  defaults: { preRollSec: 0, durationSec: 0.45, intensity: 0.7 },
  params: [
    n('amplitude', 'Амплитуда', 'Amplitude', 0, 0.12, 0.002, 0.035),
    n('frequency', 'Частота', 'Frequency', 2, 40, 1, 16, 'Hz'),
    n('rotation', 'Поворот', 'Rotation', 0, 8, 0.1, 1.5, '°'),
    ...envelopeParams('sharp', 'ease'),
  ],
  apply(c, out) {
    const f = c.time * num(c.params, 'frequency')
    const a = num(c.params, 'amplitude') * c.level
    out.camera.x += a * noise1(c.seed, f)
    out.camera.y += a * noise1(c.seed ^ 0x5bd1e995, f)
    out.camera.rotation += num(c.params, 'rotation') * DEG * c.level * noise1(c.seed ^ 0x27d4eb2f, f)
  },
}

const glitch: AccentEffectDef = {
  id: 'glitch',
  label: { ru: 'Глитч', en: 'Glitch' },
  description: {
    ru: 'RGB-расслоение и сдвиг полос кадра',
    en: 'RGB split and displaced frame slices',
  },
  defaults: { preRollSec: 0, durationSec: 0.4, intensity: 0.8 },
  params: [
    n('rgbSplit', 'RGB-сдвиг', 'RGB split', 0, 0.06, 0.001, 0.018),
    n('slices', 'Сдвиг полос', 'Slice shift', 0, 1, 0.01, 0.6),
    n('sliceCount', 'Число полос', 'Slice count', 2, 24, 1, 10),
    n('rate', 'Скорость', 'Rate', 2, 30, 1, 14, 'Hz'),
    ...envelopeParams('linear', 'linear'),
  ],
  apply(c, out) {
    const step = Math.floor(c.time * num(c.params, 'rate'))
    // Blocky flicker: some steps are weaker, like a broken signal.
    const gate = rand(c.seed, step) < 0.7 ? 1 : 0.25
    const level = c.level * gate
    const dir = rand(c.seed ^ 0x68e31da4, step) < 0.5 ? -1 : 1
    out.post.rgbSplit += dir * num(c.params, 'rgbSplit') * level
    out.post.glitch = Math.max(out.post.glitch, num(c.params, 'slices') * level)
    out.post.glitchSeed = hash32(c.seed, step)
    out.post.glitchSlices = num(c.params, 'sliceCount')
    out.camera.x += 0.01 * level * (rand(c.seed ^ 0x1b873593, step) * 2 - 1)
  },
}

const flash: AccentEffectDef = {
  id: 'flash',
  label: { ru: 'Вспышка', en: 'Flash' },
  description: { ru: 'Засветка кадра цветом', en: 'Frame flashes with a color' },
  defaults: { preRollSec: 0, durationSec: 0.3, intensity: 0.8 },
  params: [
    { key: 'color', type: 'color', label: { ru: 'Цвет', en: 'Color' }, default: '#ffffff' },
    n('opacity', 'Яркость', 'Opacity', 0, 1, 0.01, 0.85),
    {
      key: 'blend',
      type: 'enum',
      label: { ru: 'Смешивание', en: 'Blend' },
      options: [
        { value: 'screen', label: { ru: 'Экран', en: 'Screen' } },
        { value: 'add', label: { ru: 'Сложение', en: 'Add' } },
        { value: 'normal', label: { ru: 'Обычное', en: 'Normal' } },
      ],
      default: 'screen',
    },
    ...envelopeParams('sharp', 'soft'),
  ],
  apply(c, out) {
    const alpha = num(c.params, 'opacity') * clamp01(c.level)
    if (alpha <= 0.001) return
    out.overlays.push({
      kind: 'flash',
      color: str(c.params, 'color'),
      alpha,
      blend: str(c.params, 'blend') as 'normal' | 'screen' | 'add',
    })
  },
}

const paletteShift: AccentEffectDef = {
  id: 'palette-shift',
  label: { ru: 'Смена палитры', en: 'Palette shift' },
  description: { ru: 'Сдвиг оттенков всего кадра', en: 'Hue shift of the whole frame' },
  defaults: { preRollSec: 0.05, durationSec: 0.8, intensity: 0.9 },
  params: [
    n('hue', 'Сдвиг оттенка', 'Hue shift', -180, 180, 1, 120, '°'),
    n('saturation', 'Насыщенность', 'Saturation', -1, 1, 0.01, 0.25),
    ...envelopeParams('ease', 'ease'),
  ],
  apply(c, out) {
    out.post.hueShift += num(c.params, 'hue') * DEG * c.level
    out.post.saturation += num(c.params, 'saturation') * c.level
  },
}

const particleBurst: AccentEffectDef = {
  id: 'particle-burst',
  label: { ru: 'Взрыв частиц', en: 'Particle burst' },
  description: { ru: 'Частицы разлетаются от удара', en: 'Particles burst out on the hit' },
  defaults: { preRollSec: 0, durationSec: 1.2, intensity: 0.9 },
  params: [
    n('count', 'Количество', 'Count', 8, 400, 1, 140),
    n('speed', 'Скорость', 'Speed', 0.1, 3, 0.05, 1.1),
    n('size', 'Размер', 'Size', 0.002, 0.04, 0.001, 0.009),
    n('gravity', 'Гравитация', 'Gravity', -1, 3, 0.05, 0.7),
    n('spread', 'Разброс', 'Spread', 20, 360, 5, 360, '°'),
    n('direction', 'Направление', 'Direction', -180, 180, 5, -90, '°'),
    n('originX', 'Центр X', 'Origin X', 0, 1, 0.01, 0.5),
    n('originY', 'Центр Y', 'Origin Y', 0, 1, 0.01, 0.66),
    {
      key: 'shape',
      type: 'enum',
      label: { ru: 'Форма', en: 'Shape' },
      options: [
        { value: 'dot', label: { ru: 'Точки', en: 'Dots' } },
        { value: 'spark', label: { ru: 'Искры', en: 'Sparks' } },
        { value: 'square', label: { ru: 'Квадраты', en: 'Squares' } },
      ],
      default: 'spark',
    },
    { key: 'color', type: 'color', label: { ru: 'Цвет', en: 'Color' }, default: '#ffffff' },
    { key: 'color2', type: 'color', label: { ru: 'Цвет 2', en: 'Color 2' }, default: '#ffd166' },
    { key: 'glow', type: 'boolean', label: { ru: 'Свечение', en: 'Glow' }, default: true },
    ...envelopeParams('sharp', 'linear'),
  ],
  apply(c, out) {
    const overlay = burstParticles(c)
    if (overlay) out.overlays.push(overlay)
  },
}

const fullscreenWord: AccentEffectDef = {
  id: 'fullscreen-word',
  label: { ru: 'Слово на весь экран', en: 'Full-screen word' },
  description: { ru: 'Слово крупно на весь кадр', en: 'The word fills the frame' },
  defaults: { preRollSec: 0.03, durationSec: 0.7, intensity: 1 },
  params: [
    { key: 'color', type: 'color', label: { ru: 'Цвет', en: 'Color' }, default: '#ffffff' },
    n('fill', 'Ширина', 'Width', 0.4, 1, 0.01, 0.88),
    n('dim', 'Затемнение фона', 'Background dim', 0, 1, 0.01, 0.65),
    { key: 'uppercase', type: 'boolean', label: { ru: 'Заглавные', en: 'Uppercase' }, default: true },
    { key: 'outline', type: 'boolean', label: { ru: 'Контур', en: 'Outline' }, default: false },
    {
      key: 'motion',
      type: 'enum',
      label: { ru: 'Движение', en: 'Motion' },
      options: [
        { value: 'punch', label: { ru: 'Удар', en: 'Punch' } },
        { value: 'slide', label: { ru: 'Выезд', en: 'Slide' } },
        { value: 'none', label: { ru: 'Нет', en: 'None' } },
      ],
      default: 'punch',
    },
    ...envelopeParams('sharp', 'sharp'),
  ],
  apply(c, out) {
    const alpha = clamp01(c.envelope) * (0.35 + 0.65 * c.intensity)
    if (alpha <= 0.001) return
    const t = clamp01(c.sinceHit / 0.25)
    const motion = str(c.params, 'motion')
    const settle = ease('sharp', t)
    const raw = c.word.text.trim().replace(/[.,!?;:…»"')\]]+$/u, '').replace(/^[«"'([]+/u, '')
    out.overlays.push({
      kind: 'word',
      text: bool(c.params, 'uppercase') ? raw.toLocaleUpperCase() : raw,
      color: str(c.params, 'color'),
      fill: num(c.params, 'fill'),
      scale: motion === 'punch' ? 1 + 0.3 * (1 - settle) * c.intensity : 1,
      alpha,
      dim: num(c.params, 'dim') * alpha,
      outline: bool(c.params, 'outline'),
      offsetY: motion === 'slide' ? 0.06 * (1 - settle) : 0,
    })
  },
}

const slowMotion: AccentEffectDef = {
  id: 'slow-motion',
  label: { ru: 'Замедление', en: 'Slow motion' },
  description: {
    ru: 'Визуал замедляется на слове и догоняет звук к концу окна',
    en: 'Visuals slow down on the word and catch up by the end of the window',
  },
  defaults: { preRollSec: 0, durationSec: 1.2, intensity: 0.8 },
  params: [n('amount', 'Замедление', 'Slowdown', 0, 0.9, 0.01, 0.6), ...envelopeParams('linear', 'linear')],
  apply(c, out) {
    out.timeLag += slowMotionLag(c.window, c.time, num(c.params, 'amount') * clamp01(c.intensity))
  },
}

const invert: AccentEffectDef = {
  id: 'invert',
  label: { ru: 'Инверсия', en: 'Invert' },
  description: { ru: 'Негатив кадра', en: 'Inverts the frame colors' },
  defaults: { preRollSec: 0, durationSec: 0.25, intensity: 1 },
  params: [
    {
      key: 'mode',
      type: 'enum',
      label: { ru: 'Режим', en: 'Mode' },
      options: [
        { value: 'cut', label: { ru: 'Склейка', en: 'Cut' } },
        { value: 'fade', label: { ru: 'Плавно', en: 'Fade' } },
        { value: 'strobe', label: { ru: 'Стробоскоп', en: 'Strobe' } },
      ],
      default: 'cut',
    },
    n('strobeRate', 'Частота строба', 'Strobe rate', 2, 20, 1, 8, 'Hz'),
    ...envelopeParams('linear', 'linear'),
  ],
  apply(c, out) {
    const mode = str(c.params, 'mode')
    let v: number
    if (mode === 'fade') v = clamp01(c.envelope)
    else if (mode === 'strobe') {
      const on = Math.floor(Math.max(c.sinceHit, 0) * num(c.params, 'strobeRate')) % 2 === 0
      v = c.envelope > 0.05 && on ? 1 : 0
    } else v = c.envelope >= 0.5 ? 1 : 0
    out.post.invert = Math.max(out.post.invert, v * clamp01(c.intensity))
  },
}

export const ACCENT_EFFECTS: Readonly<Record<AccentEffectId, AccentEffectDef>> = {
  'zoom-punch': zoomPunch,
  shake,
  glitch,
  flash,
  'palette-shift': paletteShift,
  'particle-burst': particleBurst,
  'fullscreen-word': fullscreenWord,
  'slow-motion': slowMotion,
  invert,
}

/** UI order: priority effects first. */
export const ACCENT_EFFECT_ORDER: readonly AccentEffectId[] = [
  'zoom-punch',
  'shake',
  'fullscreen-word',
  'glitch',
  'flash',
  'particle-burst',
  'palette-shift',
  'invert',
  'slow-motion',
]

export function getAccentEffect(id: AccentEffectId): AccentEffectDef | undefined {
  return ACCENT_EFFECTS[id]
}

// ---------------------------------------------------------------------------
// Closed-form helpers (no per-frame state)
// ---------------------------------------------------------------------------

/**
 * Slow-motion as a time lag: layers run slower in the first half of the window and faster in the
 * second, back in sync at the end. Rate = 1 - amount·sin(2πu), so with amount < 1 time never runs
 * backwards. lag(u) = D·amount·(1 - cos 2πu) / 2π.
 */
export function slowMotionLag(w: AccentWindow, t: number, amount: number): number {
  if (t <= w.start || t >= w.end || amount <= 0) return 0
  const span = w.end - w.start
  const u = (t - w.start) / span
  return (span * Math.min(amount, 0.95) * (1 - Math.cos(2 * Math.PI * u))) / (2 * Math.PI)
}

const DRAG = 2.6

/** Particle positions at time t, computed directly from the seed (any frame can be drawn alone). */
export function burstParticles(c: AccentContext): OverlayItem | null {
  const age0 = c.time - c.window.peak
  if (age0 < 0) return null
  const p = c.params
  const count = Math.round(num(p, 'count') * (0.4 + 0.6 * clamp01(c.intensity)))
  const lifeMax = c.window.end - c.window.peak
  const speed = num(p, 'speed')
  const size = num(p, 'size')
  const gravity = num(p, 'gravity')
  const spread = num(p, 'spread') * DEG
  const dir = num(p, 'direction') * DEG
  const data = new Float32Array(count * PARTICLE_STRIDE)
  let live = 0
  for (let i = 0; i < count; i++) {
    const r0 = rand(c.seed, i * 7)
    const r1 = rand(c.seed, i * 7 + 1)
    const r2 = rand(c.seed, i * 7 + 2)
    const r3 = rand(c.seed, i * 7 + 3)
    const r4 = rand(c.seed, i * 7 + 4)
    const life = lifeMax * (0.45 + 0.55 * r2)
    const age = age0 - 0.05 * r4 // small stagger
    if (age < 0 || age >= life) continue
    const angle = dir + (r0 - 0.5) * spread
    const v = speed * (0.25 + 0.75 * Math.sqrt(r1))
    const travel = (1 - Math.exp(-DRAG * age)) / DRAG
    const vx = Math.cos(angle) * v
    const vy = Math.sin(angle) * v
    const x = vx * travel
    const y = vy * travel + 0.5 * gravity * age * age
    // Velocity direction for sparks.
    const decay = Math.exp(-DRAG * age)
    const heading = Math.atan2(vy * decay + gravity * age, vx * decay)
    const fade = 1 - age / life
    const o = live * PARTICLE_STRIDE
    data[o] = x
    data[o + 1] = y
    data[o + 2] = size * (0.5 + r3) * (0.6 + 0.4 * fade)
    data[o + 3] = fade * fade * (0.5 + 0.5 * clamp01(c.intensity))
    data[o + 4] = heading
    data[o + 5] = r3
    live++
  }
  if (live === 0) return null
  return {
    kind: 'particles',
    shape: str(p, 'shape') as 'dot' | 'spark' | 'square',
    originX: num(p, 'originX'),
    originY: num(p, 'originY'),
    wordId: c.word.id,
    data,
    count: live,
    color: str(p, 'color'),
    color2: str(p, 'color2'),
    glow: bool(p, 'glow'),
  }
}
