/**
 * Public API of the visualizers module.
 * Owned by the "Рендер-движок и визуализация" session — see docs/sessions/render-engine.md.
 */

export { SpectrumBarsLayer, SPECTRUM_BARS_DEFAULTS, type SpectrumBarsSpec } from './spectrumBars'
export {
  SpectrumCurveLayer,
  SPECTRUM_CURVE_DEFAULTS,
  type SpectrumCurveSpec,
} from './spectrumCurve'
export { SpectrogramLayer, SPECTROGRAM_DEFAULTS, type SpectrogramSpec } from './spectrogram'
export {
  GoniometerLayer,
  GONIOMETER_DEFAULTS,
  OscilloscopeLayer,
  OSCILLOSCOPE_DEFAULTS,
  type GoniometerSpec,
  type OscilloscopeSpec,
} from './scope'
export {
  CorrelationLayer,
  CORRELATION_DEFAULTS,
  LevelMetersLayer,
  LEVEL_METERS_DEFAULTS,
  type CorrelationSpec,
  type LevelMetersSpec,
} from './meters'
export { WaveformLayer, WAVEFORM_DEFAULTS, type WaveformSpec } from './waveform'
export { MONO_STACK, type ColorStopSpec } from './common'
