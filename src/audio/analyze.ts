import type { AudioAnalysis, FrameFeatures } from '@/shared'
import { FFT, hannWindow } from './fft'
import { kWeightedSegmentEnergy, shortTermLoudness } from './loudness'
import { slidingMedian } from './median'
import { computeScope } from './scope'
import { beatStrengths, detectSections } from './sections'
import {
  estimateTempo,
  frameTimeFor,
  pickDownbeats,
  pickOnsets,
  trackBeats,
  VOCAL_ONSET_PICKING,
} from './rhythm'
import type { DecodedAudio } from './types'
import { clamp01, percentile, smoothAttackRelease } from './util'
import {
  detectVocalActivity,
  fluxEnvelope,
  frameEnergy,
  gateByHarmonicRatio,
  harmonicPart,
  timesWithin,
  VOCAL_BAND_HZ,
  type VocalSpectrogram,
} from './vocal'

/*
 * Frame i describes the audio around its center time (i + 0.5) / rate: spectrum, RMS and stereo
 * windows are centered there (zero latency, so visuals hit on time). Peak covers exactly the
 * frame's own samples, short-term LUFS the trailing 3 s like a meter.
 */

export const FEATURE_RATE = 60
export const SPECTRUM_BINS = 96
export const SPECTRUM_MIN_HZ = 30
export const SPECTRUM_MAX_HZ = 16000
/**
 * Spectrum display slope: +4.5 dB per octave around 1 kHz, so a typical mix (falling ~4–5 dB per
 * octave) reads roughly flat instead of a wall of bass and an empty top.
 */
export const SPECTRUM_TILT_DB_PER_OCTAVE = 4.5
/**
 * Spectrum values map [ref - SPECTRUM_RANGE_DB, ref] to 0..1, where ref is the track's 99.5th
 * percentile of tilted bin levels: loud and quiet masters get the same visual range.
 */
export const SPECTRUM_RANGE_DB = 40
/** The reference never goes below this (tilted dB, full-scale sine at 1 kHz = 0), so quiet stays quiet. */
const SPECTRUM_REF_MIN_DB = -45

export const BAND_EDGES_HZ = { low: [20, 200], mid: [200, 4000], high: [4000, 16000] } as const
/**
 * Bands are normalized per track between percentiles of their level: BAND_LOW_PERCENTILE → 0
 * and BAND_HIGH_PERCENTILE → 1, so `low` pumps on the kick instead of sitting at the ceiling.
 */
const BAND_LOW_PERCENTILE = 0.25
const BAND_HIGH_PERCENTILE = 0.99
/** Minimum dB span between the two percentiles, so flat signals do not get blown up. */
const BAND_MIN_RANGE_DB = 12
/** The top is never taken below this, so near-silent tracks stay near 0. */
const BAND_REF_MIN_DB = -60
/** Share of the local (rise above the running median) part in the band value. */
const BAND_LOCAL_WEIGHT = 0.5
const BAND_LOCAL_RADIUS_SEC = 0.5
/** A rise of this many dB above the running median reads as 1. */
const BAND_LOCAL_RANGE_DB = 8
/** Level used for digital silence in dB math. */
const SILENCE_DB = -200

/** Window for RMS and stereo measurements. */
const LEVEL_WINDOW_SEC = 0.05

/** Per-frame smoothing coefficients (at 60 fps): fast attack, slower release. */
const SPECTRUM_ATTACK = 0.8
const SPECTRUM_RELEASE = 0.3
const BAND_ATTACK = 1
const BAND_RELEASE = 0.3

/** Log compression for spectral flux: log(1 + FLUX_GAMMA * amplitude). */
const FLUX_GAMMA = 1000
/** Target width of a pooled vocal-band bin for HPSS. */
const VOCAL_BIN_HZ = 45

export interface AnalyzePcmOptions {
  rate?: number
  /** Called with 0..1 during the frame loop and once more with 1 at the end. */
  onProgress?: (fraction: number) => void
}

/** Intermediate per-frame signals, for the dev page and tuning. */
export interface AnalysisInternals {
  fftSize: number
  /** Full-band onset envelope. */
  flux: Float32Array
  /** Vocal onset envelope (harmonic, center-panned, vocal band). */
  vocalFlux: Float32Array
  /** Harmonic center-panned vocal-band energy (linear). */
  vocalEnergy: Float64Array
  /** Center-panned vocal-band spectrogram and its harmonic part. */
  vocalSpec: VocalSpectrogram
  harmonic: Float32Array
  /** Mid-channel power in the vocal band (same range as the `mid` band), linear. */
  midPower: Float64Array
  /** Mid-channel power in the low band, linear. */
  lowPower: Float64Array
}

/** FFT size: smallest power of two covering ~40 ms (2048 at 44.1/48 kHz). */
export function fftSizeFor(sampleRate: number): number {
  let size = 256
  while (size < sampleRate * 0.04) size *= 2
  return size
}

/** FFT bin range [from, to) covering [loHz, hiHz), clamped to the spectrum. */
export function binRange(loHz: number, hiHz: number, sampleRate: number, fftSize: number) {
  const half = fftSize / 2
  const from = Math.min(half, Math.max(1, Math.ceil((loHz * fftSize) / sampleRate)))
  const to = Math.min(half + 1, Math.max(from, Math.ceil((hiHz * fftSize) / sampleRate)))
  return { from, to }
}

/**
 * Log-frequency bin j aggregates FFT bins in [edge j, edge j+1) by max amplitude; bins narrower
 * than the FFT resolution interpolate at their center frequency instead.
 */
interface LogBin {
  from: number
  to: number
  /** Interpolation fallback when from === to. */
  index: number
  frac: number
  /** Display slope at the bin center, dB. */
  tiltDb: number
}

function logBins(
  binCount: number,
  minHz: number,
  maxHz: number,
  sampleRate: number,
  fftSize: number,
): LogBin[] {
  const hzPerBin = sampleRate / fftSize
  const ratio = maxHz / minHz
  const bins: LogBin[] = []
  for (let j = 0; j < binCount; j++) {
    const lo = minHz * Math.pow(ratio, j / binCount)
    const hi = minHz * Math.pow(ratio, (j + 1) / binCount)
    const center = minHz * Math.pow(ratio, (j + 0.5) / binCount)
    const from = Math.ceil(lo / hzPerBin)
    const to = Math.ceil(hi / hzPerBin)
    const position = center / hzPerBin
    const index = Math.floor(position)
    bins.push({
      from,
      to: Math.min(to, fftSize / 2 + 1),
      index,
      frac: position - index,
      tiltDb: SPECTRUM_TILT_DB_PER_OCTAVE * Math.log2(center / 1000),
    })
  }
  return bins
}

/** Pure, deterministic analysis of decoded PCM. Runs in the worker; also usable directly. */
export function analyzePcm(pcm: DecodedAudio, options: AnalyzePcmOptions = {}): AudioAnalysis {
  return analyzePcmDetailed(pcm, options).analysis
}

export function analyzePcmDetailed(
  pcm: DecodedAudio,
  options: AnalyzePcmOptions = {},
): { analysis: AudioAnalysis; internals: AnalysisInternals } {
  const rate = options.rate ?? FEATURE_RATE
  const onProgress = options.onProgress
  const { sampleRate } = pcm
  const left = pcm.channels[0] ?? new Float32Array(0)
  const right = pcm.channels[1] ?? left
  const length = left.length
  const durationSec = length / sampleRate
  const frameCount = Math.ceil((length * rate) / sampleRate)
  const hop = sampleRate / rate

  const fftSize = fftSizeFor(sampleRate)
  const half = fftSize / 2
  const mask = fftSize - 1
  const fft = new FFT(fftSize)
  const window = hannWindow(fftSize)
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const midPowerBins = new Float64Array(half + 1)
  const sidePowerBins = new Float64Array(half + 1)
  const amplitude = new Float64Array(half + 1)
  const logAmplitude = new Float64Array(half + 1)
  const prevLogAmplitude = new Float64Array(half + 1)
  // |X| of a full-scale sine under a Hann window is N/4.
  const amplitudeScale = 4 / fftSize
  // Sum of one-sided |X|^2 of a full-scale sine is 3N^2/32.
  const powerScale = 32 / (3 * fftSize * fftSize)

  const maxHz = Math.min(SPECTRUM_MAX_HZ, sampleRate / 2)
  const bins = logBins(SPECTRUM_BINS, SPECTRUM_MIN_HZ, maxHz, sampleRate, fftSize)
  const lowRange = binRange(BAND_EDGES_HZ.low[0], BAND_EDGES_HZ.low[1], sampleRate, fftSize)
  const midRange = binRange(BAND_EDGES_HZ.mid[0], BAND_EDGES_HZ.mid[1], sampleRate, fftSize)
  const highRange = binRange(BAND_EDGES_HZ.high[0], BAND_EDGES_HZ.high[1], sampleRate, fftSize)
  const fluxRange = binRange(SPECTRUM_MIN_HZ, maxHz, sampleRate, fftSize)

  const vocalRange = binRange(VOCAL_BAND_HZ[0], VOCAL_BAND_HZ[1], sampleRate, fftSize)
  const vocalPool = Math.max(1, Math.round(VOCAL_BIN_HZ / (sampleRate / fftSize)))
  const vocalBins = Math.floor((vocalRange.to - vocalRange.from) / vocalPool)
  const vocalPower = new Float32Array(frameCount * vocalBins)

  const spectrum = new Float32Array(frameCount * SPECTRUM_BINS)
  const rms = new Float32Array(frameCount)
  const peak = new Float32Array(frameCount)
  const correlation = new Float32Array(frameCount)
  const width = new Float32Array(frameCount)
  const lowPower = new Float64Array(frameCount)
  const midPower = new Float64Array(frameCount)
  const highPower = new Float64Array(frameCount)
  const flux = new Float32Array(frameCount)

  const levelHalf = Math.max(1, Math.round((LEVEL_WINDOW_SEC * sampleRate) / 2))
  const progressStep = Math.max(1, Math.floor(frameCount / 50))

  for (let i = 0; i < frameCount; i++) {
    const center = Math.round((i + 0.5) * hop)

    // One complex FFT of L + iR gives both channel spectra.
    const start = center - half
    for (let k = 0; k < fftSize; k++) {
      const s = start + k
      if (s >= 0 && s < length) {
        re[k] = left[s]! * window[k]!
        im[k] = right[s]! * window[k]!
      } else {
        re[k] = 0
        im[k] = 0
      }
    }
    fft.transform(re, im)
    for (let k = 0; k <= half; k++) {
      const ar = re[k]!
      const ai = im[k]!
      const br = re[(fftSize - k) & mask]!
      const bi = im[(fftSize - k) & mask]!
      // L = (Z[k] + conj Z[N-k]) / 2, R = (Z[k] - conj Z[N-k]) / 2i.
      const lr = 0.5 * (ar + br)
      const li = 0.5 * (ai - bi)
      const rr = 0.5 * (ai + bi)
      const ri = -0.5 * (ar - br)
      const mr = 0.5 * (lr + rr)
      const mi = 0.5 * (li + ri)
      const sr = 0.5 * (lr - rr)
      const si = 0.5 * (li - ri)
      const p = mr * mr + mi * mi
      midPowerBins[k] = p
      sidePowerBins[k] = sr * sr + si * si
      const a = Math.sqrt(p) * amplitudeScale
      amplitude[k] = a
      logAmplitude[k] = Math.log(1 + FLUX_GAMMA * a)
    }

    // Tilted dB for now; normalized after the loop.
    const row = i * SPECTRUM_BINS
    for (let j = 0; j < SPECTRUM_BINS; j++) {
      const bin = bins[j]!
      let a = 0
      if (bin.to > bin.from) {
        for (let k = bin.from; k < bin.to; k++) a = Math.max(a, amplitude[k]!)
      } else {
        const a0 = amplitude[bin.index] ?? 0
        const a1 = amplitude[bin.index + 1] ?? 0
        a = a0 + (a1 - a0) * bin.frac
      }
      spectrum[row + j] = a > 0 ? 20 * Math.log10(a) + bin.tiltDb : -Infinity
    }

    let low = 0
    for (let k = lowRange.from; k < lowRange.to; k++) low += midPowerBins[k]!
    let mid = 0
    for (let k = midRange.from; k < midRange.to; k++) mid += midPowerBins[k]!
    let high = 0
    for (let k = highRange.from; k < highRange.to; k++) high += midPowerBins[k]!
    lowPower[i] = low * powerScale
    midPower[i] = mid * powerScale
    highPower[i] = high * powerScale

    let f = 0
    for (let k = fluxRange.from; k < fluxRange.to; k++) {
      const d = logAmplitude[k]! - prevLogAmplitude[k]!
      if (d > 0) f += d
    }
    flux[i] = f
    prevLogAmplitude.set(logAmplitude)

    // Center-panned vocal-band power: mid minus side.
    const vocalRow = i * vocalBins
    for (let j = 0; j < vocalBins; j++) {
      let c = 0
      const from = vocalRange.from + j * vocalPool
      for (let k = from; k < from + vocalPool; k++) {
        c += Math.max(0, midPowerBins[k]! - sidePowerBins[k]!)
      }
      vocalPower[vocalRow + j] = c * powerScale
    }

    // Levels and stereo image over a short centered window.
    let sumL = 0
    let sumR = 0
    let sumLR = 0
    const from = Math.max(0, center - levelHalf)
    const to = Math.min(length, center + levelHalf)
    for (let s = from; s < to; s++) {
      const l = left[s]!
      const r = right[s]!
      sumL += l * l
      sumR += r * r
      sumLR += l * r
    }
    const energy = sumL + sumR
    rms[i] = Math.sqrt(energy / (4 * levelHalf))
    if (energy / (4 * levelHalf) > 1e-12) {
      correlation[i] = Math.max(-1, Math.min(1, sumLR / Math.sqrt(sumL * sumR || 1)))
      width[i] = clamp01(0.5 - sumLR / energy)
    }

    let p = 0
    const segmentEnd = Math.min(length, Math.floor((i + 1) * hop))
    for (let s = Math.floor(i * hop); s < segmentEnd; s++) {
      p = Math.max(p, Math.abs(left[s]!), Math.abs(right[s]!))
    }
    peak[i] = Math.min(1, p)

    if (onProgress && i % progressStep === 0) onProgress((0.85 * i) / frameCount)
  }

  normalizeSpectrum(spectrum)
  smoothAttackRelease(spectrum, SPECTRUM_ATTACK, SPECTRUM_RELEASE, SPECTRUM_BINS)

  const loudnessChannels = pcm.channels.length >= 2 ? [left, right] : [left]
  const lufsShortTerm = shortTermLoudness(
    kWeightedSegmentEnergy(loudnessChannels, sampleRate, rate, frameCount),
    sampleRate,
    rate,
  )

  const vocalSpec: VocalSpectrogram = {
    power: vocalPower,
    frameCount,
    binCount: vocalBins,
    binHz: (vocalPool * sampleRate) / fftSize,
  }
  const harmonic = harmonicPart(vocalSpec, rate)
  const vocalFlux = fluxEnvelope(harmonic, frameCount, vocalBins)
  const vocalEnergy = frameEnergy(harmonic, frameCount, vocalBins)
  onProgress?.(0.92)

  const frameTime = frameTimeFor(rate, fftSize, sampleRate, durationSec)
  const timeToFrame = (time: number) =>
    Math.min(frameCount - 1, Math.max(0, Math.floor(time * rate)))

  const vocalActivity = detectVocalActivity(
    gateByHarmonicRatio(vocalEnergy, midPower, rate),
    rate,
    durationSec,
  )
  const onsets = pickOnsets(flux, rate, frameTime)
  const vocalOnsets = timesWithin(
    pickOnsets(vocalFlux, rate, frameTime, VOCAL_ONSET_PICKING),
    vocalActivity,
  )
  const tempo = estimateTempo(flux, rate)
  const beats = tempo ? trackBeats(flux, tempo.period, frameTime) : new Float32Array(0)
  const downbeats = pickDownbeats(beats, lowPower, timeToFrame)
  const bpm = tempo && beats.length > 0 ? Math.round(tempo.bpm * 100) / 100 : null
  const beatStrength = beatStrengths(beats, lowPower, flux, rate)
  const sections = detectSections({
    durationSec,
    rate,
    rms,
    lowPower,
    bpm,
    downbeats,
    spectrum: {
      data: spectrum,
      binCount: SPECTRUM_BINS,
      minHz: SPECTRUM_MIN_HZ,
      maxHz,
      frameCount,
      rate,
    },
    vocalActivity,
  })
  const scope = computeScope(left, right, sampleRate, rate, frameCount)

  const features: FrameFeatures = {
    rate,
    frameCount,
    spectrum: { binCount: SPECTRUM_BINS, minHz: SPECTRUM_MIN_HZ, maxHz, data: spectrum },
    rms,
    peak,
    lufsShortTerm,
    bands: {
      low: normalizeBand(lowPower, rate),
      mid: normalizeBand(midPower, rate),
      high: normalizeBand(highPower, rate),
    },
    stereo: { correlation, width },
    scope,
  }

  const analysis: AudioAnalysis = {
    durationSec,
    sampleRate,
    channelCount: pcm.channels.length,
    features,
    rhythm: {
      bpm,
      beats,
      downbeats,
      onsets,
      vocalOnsets,
      beatStrength,
    },
    vocalActivity,
    sections,
  }
  onProgress?.(1)
  return {
    analysis,
    internals: { fftSize, flux, vocalFlux, vocalEnergy, vocalSpec, harmonic, midPower, lowPower },
  }
}

/** Tilted dB (in place) → 0..1 relative to the track's reference level. */
function normalizeSpectrum(spectrum: Float32Array): void {
  // A strided sample is plenty for a percentile and keeps the sort cheap.
  const stride = Math.max(1, Math.floor(spectrum.length / 200_000))
  const sample: number[] = []
  for (let i = 0; i < spectrum.length; i += stride) sample.push(spectrum[i]!)
  const p = percentile(sample, 0.995)
  if (!Number.isFinite(p)) {
    spectrum.fill(0)
    return
  }
  const ref = Math.max(p, SPECTRUM_REF_MIN_DB)
  const bottom = ref - SPECTRUM_RANGE_DB
  for (let i = 0; i < spectrum.length; i++) {
    spectrum[i] = clamp01((spectrum[i]! - bottom) / SPECTRUM_RANGE_DB)
  }
}

/**
 * Mix of two views of the band level: global (percentiles of the whole track, keeps drops vs.
 * breakdowns) and local (rise above the running median, so a kick pumps even over a sustained
 * 808 that fills the same band).
 */
function normalizeBand(power: Float64Array, rate: number): Float32Array {
  const n = power.length
  const out = new Float32Array(n)
  const db = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = power[i]!
    db[i] = p > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(p)) : SILENCE_DB
  }
  const hi = percentile(db, BAND_HIGH_PERCENTILE)
  if (!(hi > SILENCE_DB)) return out
  const lo = percentile(db, BAND_LOW_PERCENTILE)
  const top = Math.max(hi, BAND_REF_MIN_DB)
  const range = Math.max(top - lo, BAND_MIN_RANGE_DB)

  const baseline = new Float32Array(n)
  slidingMedian(db, baseline, n, 0, 1, Math.max(1, Math.round(BAND_LOCAL_RADIUS_SEC * rate)))

  for (let i = 0; i < n; i++) {
    const global = clamp01((db[i]! - (top - range)) / range)
    const local = clamp01((db[i]! - baseline[i]!) / BAND_LOCAL_RANGE_DB)
    // Gate the local part by the global level so noise in quiet passages does not pump.
    out[i] = (1 - BAND_LOCAL_WEIGHT) * global + BAND_LOCAL_WEIGHT * local * Math.min(1, 2 * global)
  }
  smoothAttackRelease(out, BAND_ATTACK, BAND_RELEASE)
  return out
}

/** Every ArrayBuffer inside an analysis, for postMessage transfer lists. */
export function analysisTransferables(analysis: AudioAnalysis): ArrayBuffer[] {
  const { features, rhythm } = analysis
  return [
    features.spectrum.data,
    features.rms,
    features.peak,
    features.lufsShortTerm,
    features.bands.low,
    features.bands.mid,
    features.bands.high,
    features.stereo.correlation,
    features.stereo.width,
    rhythm.beats,
    rhythm.downbeats,
    rhythm.onsets,
    rhythm.vocalOnsets,
    rhythm.beatStrength,
    features.scope?.left,
    features.scope?.right,
  ]
    .filter((array) => array !== undefined)
    .map((array) => array.buffer as ArrayBuffer)
}
