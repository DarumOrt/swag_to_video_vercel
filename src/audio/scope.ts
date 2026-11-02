import type { FrameFeatures } from '@/shared'

/*
 * Per-frame waveform snapshots for the oscilloscope and goniometer.
 * Memory: frameCount × SCOPE_POINTS × 2 channels × 4 bytes — at 60 fps and 128 points that is
 * 11 MB for 3 minutes and 18 MB for 5 minutes (256 points would double it, for detail the
 * box-averaged window cannot show anyway).
 */

export const SCOPE_POINTS = 128
/** 32 ms: about two cycles of an 60 Hz bass, so low notes read as waves rather than slopes. */
export const SCOPE_WINDOW_SEC = 0.032

/**
 * Row i covers SCOPE_WINDOW_SEC of audio ending at the frame center (i + 0.5) / rate — the same
 * time reference as every other feature. Each point is the mean of its slice of samples (a box
 * filter, so the decimation does not alias), zero outside the track.
 */
export function computeScope(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  rate: number,
  frameCount: number,
): NonNullable<FrameFeatures['scope']> {
  const points = SCOPE_POINTS
  const outLeft = new Float32Array(frameCount * points)
  const outRight = new Float32Array(frameCount * points)
  const windowSamples = SCOPE_WINDOW_SEC * sampleRate
  const step = windowSamples / points
  const length = left.length

  for (let i = 0; i < frameCount; i++) {
    const end = ((i + 0.5) * sampleRate) / rate
    const start = end - windowSamples
    const row = i * points
    for (let p = 0; p < points; p++) {
      const from = Math.floor(start + p * step)
      const to = Math.max(from + 1, Math.floor(start + (p + 1) * step))
      let sumL = 0
      let sumR = 0
      for (let s = Math.max(0, from); s < Math.min(length, to); s++) {
        sumL += left[s]!
        sumR += right[s]!
      }
      outLeft[row + p] = sumL / (to - from)
      outRight[row + p] = sumR / (to - from)
    }
  }
  return { pointsPerFrame: points, windowSec: SCOPE_WINDOW_SEC, left: outLeft, right: outRight }
}
