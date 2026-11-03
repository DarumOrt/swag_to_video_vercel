import {
  Aperture,
  Contrast,
  FlipHorizontal2,
  Hourglass,
  Maximize2,
  Orbit,
  Palette,
  ScanLine,
  Sparkles,
  Sun,
  Tv,
  Vibrate,
  Zap,
  ZoomIn,
  Droplets,
  type LucideIcon,
} from 'lucide-react'
import { isRangeEffect } from '@/lyrics'
import type { AccentEffectId } from '@/shared'

export const EFFECT_ICONS: Record<AccentEffectId, LucideIcon> = {
  'zoom-punch': ZoomIn,
  shake: Vibrate,
  glitch: ScanLine,
  flash: Sun,
  'palette-shift': Palette,
  'particle-burst': Sparkles,
  'fullscreen-word': Maximize2,
  'slow-motion': Hourglass,
  invert: Contrast,
  mono: Droplets,
  mirror: FlipHorizontal2,
  strobe: Zap,
  'rgb-split': Aperture,
  vhs: Tv,
  'camera-orbit': Orbit,
}

/** Colour of the range stripe under words, per effect. */
export const EFFECT_COLORS: Record<AccentEffectId, string> = {
  'zoom-punch': '#f59e0b',
  shake: '#f97316',
  glitch: '#22d3ee',
  flash: '#fde047',
  'palette-shift': '#c084fc',
  'particle-burst': '#f472b6',
  'fullscreen-word': '#60a5fa',
  'slow-motion': '#2dd4bf',
  invert: '#e5e7eb',
  mono: '#9ca3af',
  mirror: '#38bdf8',
  strobe: '#ffffff',
  'rgb-split': '#ef4444',
  vhs: '#a3e635',
  'camera-orbit': '#818cf8',
}

export type EffectGroup = 'hits' | 'modes'

/** "Удары" = one-shots on a word, "Режимы" = looks held over a range of words. */
export const effectGroup = (effect: AccentEffectId): EffectGroup =>
  isRangeEffect(effect) ? 'modes' : 'hits'
