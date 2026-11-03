import {
  CorrelationLayer,
  GoniometerLayer,
  LevelMetersLayer,
  OscilloscopeLayer,
  SpectrogramLayer,
  SpectrumBarsLayer,
  SpectrumCurveLayer,
  WaveformLayer,
} from '@/visualizers'
import { BackgroundLayer } from './layers/background'
import { FulltextLayer } from './layers/fulltext'
import { KineticLayer } from './layers/kinetic'
import { LyricsLayer } from './layers/lyrics'
import { NoiseLayer } from './layers/noise'
import { TextLayer } from './layers/text'
import type { LayerSpec } from './scene'
import type { Layer } from './types'

export function createLayer(spec: LayerSpec): Layer {
  switch (spec.type) {
    case 'background':
      return new BackgroundLayer(spec)
    case 'noise':
      return new NoiseLayer(spec)
    case 'spectrum-bars':
      return new SpectrumBarsLayer(spec)
    case 'spectrum-curve':
      return new SpectrumCurveLayer(spec)
    case 'spectrogram':
      return new SpectrogramLayer(spec)
    case 'oscilloscope':
      return new OscilloscopeLayer(spec)
    case 'goniometer':
      return new GoniometerLayer(spec)
    case 'level-meters':
      return new LevelMetersLayer(spec)
    case 'correlation':
      return new CorrelationLayer(spec)
    case 'waveform':
      return new WaveformLayer(spec)
    case 'text':
      return new TextLayer(spec)
    case 'lyrics':
      return new LyricsLayer(spec)
    case 'kinetic':
      return new KineticLayer(spec)
    case 'fulltext':
      return new FulltextLayer(spec)
  }
}
