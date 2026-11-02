import {
  Contrast,
  Hourglass,
  Maximize2,
  Palette,
  ScanLine,
  Sparkles,
  Sun,
  Vibrate,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react'
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
}
