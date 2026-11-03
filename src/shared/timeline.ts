/**
 * Timeline — the central contract between modules.
 *
 * Producers: audio (`audio`), lyrics + ml (`lyrics`), ui (`accents`).
 * Consumers: render (everything), export (via render), ui.
 *
 * Owned by the main session: propose changes there, do not edit from a topic session.
 * Bump TIMELINE_SCHEMA_VERSION on any breaking change.
 *
 * Not literally JSON: feature arrays are typed arrays so the timeline can be passed to workers
 * (structured clone / transfer) and stored in IndexedDB as-is.
 * All times are seconds from the start of the track.
 */

export const TIMELINE_SCHEMA_VERSION = 1

export interface Timeline {
  version: typeof TIMELINE_SCHEMA_VERSION
  audio: AudioAnalysis
  /** null until the user adds lyrics. */
  lyrics: Lyrics | null
  accents: Accent[]
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface AudioAnalysis {
  durationSec: number
  /** Sample rate of the decoded source. */
  sampleRate: number
  channelCount: number
  /** Per-frame features, sampled at `features.rate`. */
  features: FrameFeatures
  rhythm: Rhythm
  /** Regions where vocals are likely present (used to skip instrumental parts in recognition). */
  vocalActivity: TimeRange[]
  /** Energy sections of the track (intro, build, drop…), ascending, covering the track. Optional (v1.1). */
  sections?: AudioSection[]
}

export type SectionKind = 'quiet' | 'build' | 'drop' | 'normal'

/** Musical role of a section (v1.2): drives the "story" of the video. Guessed from energy + repetition. */
export type SectionRole =
  'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'drop' | 'bridge' | 'breakdown' | 'outro'

export interface AudioSection extends TimeRange {
  kind: SectionKind
  /** Mean energy of the section relative to the track, 0..1. */
  energy: number
  /** Musical role (v1.2, optional). Missing = derive from `kind`. */
  role?: SectionRole
  /** Sections that sound alike share a group number (chorus repeats…). Optional (v1.2). */
  repeatGroup?: number
}

/**
 * Features sampled on a fixed grid of `rate` frames per second, independent of the output fps.
 * Value for time t: index = floor(t * rate), clamped to [0, frameCount - 1].
 * Use `featureIndexAt` from this module.
 */
export interface FrameFeatures {
  rate: number
  frameCount: number

  /** Log-frequency spectrum, row-major: frameCount × spectrum.binCount, values 0..1 (normalized dB). */
  spectrum: {
    binCount: number
    minHz: number
    maxHz: number
    data: Float32Array
  }

  /** Loudness, one value per frame. rms/peak are linear 0..1, lufs is short-term LUFS (negative). */
  rms: Float32Array
  peak: Float32Array
  lufsShortTerm: Float32Array

  /** Band energies 0..1 per frame. low ≈ kick/bass, mid ≈ vocals, high ≈ hats/air. */
  bands: {
    low: Float32Array
    mid: Float32Array
    high: Float32Array
  }

  /** Stereo image per frame: correlation -1..1, width 0..1. */
  stereo: {
    correlation: Float32Array
    width: Float32Array
  }

  /**
   * Raw waveform snapshot per frame for oscilloscope / goniometer, row-major frameCount × pointsPerFrame,
   * values -1..1. Each row covers `windowSec` of audio ending at the frame time. Optional (v1.1).
   */
  scope?: {
    pointsPerFrame: number
    windowSec: number
    left: Float32Array
    right: Float32Array
  }
}

export interface Rhythm {
  bpm: number | null
  /** Beat times, ascending. */
  beats: Float32Array
  /** Downbeat (bar start) times, ascending, subset of beats. */
  downbeats: Float32Array
  /** Full-band onset times, ascending. */
  onsets: Float32Array
  /** Onsets in the vocal band only, used to snap word starts. */
  vocalOnsets: Float32Array
  /** Strength of each beat in `beats` (same length), 0..1 — for picking which beats hit hardest. Optional (v1.1). */
  beatStrength?: Float32Array
}

export interface TimeRange {
  start: number
  end: number
}

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------

export type LyricsLanguage = 'ru' | 'en' | 'mixed'

export interface Lyrics {
  language: LyricsLanguage
  lines: LyricLine[]
}

export interface LyricLine {
  id: string
  /** Optional section label, e.g. "Куплет 1", "Припев". */
  section?: string
  /** True for the first line of a stanza (after a blank line in the source text). */
  stanzaStart?: boolean
  words: LyricWord[]
}

/** Where a word's timing came from — lets the editor show what needs checking. */
export type TimingSource =
  | 'whisper'
  | 'aligned'
  | 'interpolated'
  | 'snapped'
  | 'tap'
  | 'manual'
  /** From an imported LRC / Enhanced LRC file. */
  | 'imported'

export interface LyricWord {
  id: string
  /** Text as displayed (original casing and punctuation). */
  text: string
  /** null = not timed yet. */
  start: number | null
  end: number | null
  /** 0..1, null when unknown (e.g. manual timing). */
  confidence: number | null
  timingSource: TimingSource | null
}

// ---------------------------------------------------------------------------
// Accents (effects bound to words)
// ---------------------------------------------------------------------------

/** Built-in accent effects. The effects session implements them; new ids go through the main session. */
export type AccentEffectId =
  | 'zoom-punch'
  | 'shake'
  | 'glitch'
  | 'flash'
  | 'palette-shift'
  | 'particle-burst'
  | 'fullscreen-word'
  | 'slow-motion'
  | 'invert'
  // Modes (v1.2): look changes for the whole frame, usually held over a range of words (`endWordId`).
  | 'mono'
  | 'mirror'
  | 'strobe'
  | 'rgb-split'
  | 'vhs'
  | 'camera-orbit'

/**
 * An effect bound to a word. One word may carry several accents (unique `id`, any mix of effects).
 * With `endWordId` the accent is a toggle: on at `wordId`'s start (minus pre-roll), off at the end of
 * `endWordId` (which must not come earlier); `durationSec` then only shapes the release.
 */
export interface Accent {
  id: string
  wordId: string
  /** Range end (v1.2): the accent holds until this word ends. Missing = a one-shot of `durationSec`. */
  endWordId?: string
  effect: AccentEffectId
  /** 'auto' = suggested by the app, 'user' = placed or confirmed by the user. Missing = 'user'. */
  source?: 'auto' | 'user'
  /** Effect starts this many seconds before the word start (anticipation). */
  preRollSec: number
  /** Effect length in seconds from the word start. */
  durationSec: number
  /** 0..1 */
  intensity: number
  /** Effect-specific parameters, defined by the render session. */
  params: Record<string, number | string | boolean>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index into per-frame feature arrays for time `timeSec`. */
export function featureIndexAt(features: FrameFeatures, timeSec: number): number {
  // Small epsilon: times like 245/60 land a hair below the grid point in float math.
  const index = Math.floor(timeSec * features.rate + 1e-6)
  return Math.min(Math.max(index, 0), Math.max(features.frameCount - 1, 0))
}

/** Role of a section: the analysed `role`, or a guess from `kind` and position when it is missing. */
export function sectionRole(sections: readonly AudioSection[], index: number): SectionRole {
  const section = sections[index]
  if (!section) return 'verse'
  if (section.role) return section.role
  const last = index === sections.length - 1
  switch (section.kind) {
    case 'quiet':
      return index === 0 ? 'intro' : last ? 'outro' : 'breakdown'
    case 'build':
      return 'pre-chorus'
    case 'drop':
      return 'drop'
    default:
      return index === 0 ? 'intro' : last ? 'outro' : 'verse'
  }
}
