import type { AudioSection, SectionKind, SectionRole, TimeRange } from '@/shared'

/*
 * Song structure on the bar grid: repeats (self-similarity of chroma + timbre per bar), extra
 * boundaries where the sound changes at constant energy (checkerboard novelty), repeat groups
 * and musical roles. Works on the display spectrum, no extra FFT.
 */

/** Pitch classes and spectrum bands per bar-feature vector. */
const CHROMA_BINS = 12
const TIMBRE_BANDS = 24
/** Share of the energy dimension against chroma and timbre (each weighs 1). */
const ENERGY_WEIGHT = 0.6
/** Chroma uses the range where pitch is readable at 1.1 semitones per spectrum bin. */
const CHROMA_MIN_HZ = 80
const CHROMA_MAX_HZ = 4000
/** Frames are read at this rate inside a bar (plenty for a mean). */
const FRAME_STRIDE_SEC = 0.1

/** Dimensions that vary less than this over the whole track are noise, not structure. */
const MIN_DIMENSION_STD = 0.03

/** Checkerboard kernel half-size in bars, and the novelty needed for a new boundary. */
const NOVELTY_HALF_BARS = 4
const NOVELTY_MIN = 0.5
/** A boundary found by novelty leaves at least this many bars on each side. */
const NOVELTY_MIN_PART_BARS = 4

/** Sections at least this similar (0..1) form a repeat group. */
const GROUP_SIMILARITY = 0.55
/** Sections whose lengths differ more than this ratio are not repeats of each other. */
const GROUP_MAX_LENGTH_RATIO = 2.5

export interface BarSpectrum {
  data: Float32Array
  binCount: number
  minHz: number
  maxHz: number
  frameCount: number
  rate: number
}

export interface StructureInput {
  /** Bar edges in seconds (barCount + 1 values). */
  boundaries: number[]
  /** Energy per bar, 0..1 (as in the sections). */
  energy: Float32Array
  /** Runs of bars from the energy analysis. */
  runs: { kind: SectionKind; first: number; last: number }[]
  spectrum: BarSpectrum
  vocalActivity: TimeRange[]
  durationSec: number
}

// ---------------------------------------------------------------------------
// Bar features and self-similarity
// ---------------------------------------------------------------------------

/** Z-scored feature vector per bar: chroma + timbre + energy, weighted so each part counts alike. */
export function barFeatureVectors(
  spectrum: BarSpectrum,
  boundaries: number[],
  energy: Float32Array,
): Float32Array[] {
  const { data, binCount, minHz, maxHz, frameCount, rate } = spectrum
  const barCount = boundaries.length - 1
  const ratio = maxHz / minHz

  // Spectrum bin → two neighboring pitch classes.
  const chromaIndex = new Int16Array(binCount).fill(-1)
  const chromaFrac = new Float32Array(binCount)
  for (let j = 0; j < binCount; j++) {
    const hz = minHz * Math.pow(ratio, (j + 0.5) / binCount)
    if (hz < CHROMA_MIN_HZ || hz > CHROMA_MAX_HZ) continue
    const position = (12 * Math.log2(hz / 27.5)) % 12
    chromaIndex[j] = Math.floor(position)
    chromaFrac[j] = position - Math.floor(position)
  }
  const bandSize = binCount / TIMBRE_BANDS
  const dims = CHROMA_BINS + TIMBRE_BANDS + 1
  const vectors: Float32Array[] = []
  const stride = Math.max(1, Math.round(FRAME_STRIDE_SEC * rate))

  for (let b = 0; b < barCount; b++) {
    const v = new Float32Array(dims)
    const from = Math.min(frameCount - 1, Math.floor(boundaries[b]! * rate))
    const to = Math.max(from + 1, Math.min(frameCount, Math.floor(boundaries[b + 1]! * rate)))
    let used = 0
    for (let i = from; i < to; i += stride) {
      const row = i * binCount
      for (let j = 0; j < binCount; j++) {
        const value = data[row + j]!
        const c = chromaIndex[j]!
        if (c >= 0) {
          v[c] = v[c]! + value * (1 - chromaFrac[j]!)
          const next = (c + 1) % CHROMA_BINS
          v[next] = v[next]! + value * chromaFrac[j]!
        }
        const band = CHROMA_BINS + Math.min(TIMBRE_BANDS - 1, Math.floor(j / bandSize))
        v[band] = v[band]! + value
      }
      used++
    }
    if (used > 0) for (let d = 0; d < CHROMA_BINS + TIMBRE_BANDS; d++) v[d] = v[d]! / used
    // Chroma as a distribution: loudness does not dominate it.
    let sum = 0
    for (let d = 0; d < CHROMA_BINS; d++) sum += v[d]!
    if (sum > 0) for (let d = 0; d < CHROMA_BINS; d++) v[d] = (v[d]! * CHROMA_BINS) / sum
    v[dims - 1] = energy[b] ?? 0
    vectors.push(v)
  }

  // Z-score each dimension over the track, then weight the three parts.
  for (let d = 0; d < dims; d++) {
    let mean = 0
    for (const v of vectors) mean += v[d]!
    mean /= Math.max(1, barCount)
    let variance = 0
    for (const v of vectors) variance += (v[d]! - mean) ** 2
    const std = Math.sqrt(variance / Math.max(1, barCount))
    const weight =
      d < CHROMA_BINS
        ? 1 / Math.sqrt(CHROMA_BINS)
        : d < CHROMA_BINS + TIMBRE_BANDS
          ? 1 / Math.sqrt(TIMBRE_BANDS)
          : ENERGY_WEIGHT
    // A dimension that never changes carries no information.
    const scale = std > MIN_DIMENSION_STD ? weight / std : 0
    for (const v of vectors) v[d] = (v[d]! - mean) * scale
  }
  return vectors
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let d = 0; d < a.length; d++) {
    dot += a[d]! * b[d]!
    na += a[d]! * a[d]!
    nb += b[d]! * b[d]!
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0
}

/** Bar × bar cosine similarity, row-major. */
export function selfSimilarity(vectors: Float32Array[]): Float32Array {
  const n = vectors.length
  const out = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    out[i * n + i] = 1
    for (let j = i + 1; j < n; j++) {
      const s = cosine(vectors[i]!, vectors[j]!)
      out[i * n + j] = s
      out[j * n + i] = s
    }
  }
  return out
}

/** Checkerboard-kernel novelty at the edge before bar `i` (0 at the track edges). */
export function noveltyCurve(sim: Float32Array, n: number, half = NOVELTY_HALF_BARS): Float32Array {
  const out = new Float32Array(n)
  for (let i = 1; i < n; i++) {
    const L = Math.min(half, i, n - i)
    if (L < 2) continue
    let within = 0
    let across = 0
    for (let a = 1; a <= L; a++) {
      for (let b = 1; b <= L; b++) {
        within += sim[(i - a) * n + (i - b)]! + sim[(i + a - 1) * n + (i + b - 1)]!
        across += 2 * sim[(i - a) * n + (i + b - 1)]!
      }
    }
    out[i] = (within - across) / (2 * L * L)
  }
  return out
}

/** Extra boundaries (bar indices) inside runs, where the sound changes without an energy step. */
function noveltyBoundaries(novelty: Float32Array, edges: Set<number>): number[] {
  const found: number[] = []
  const n = novelty.length
  const sorted = [...edges].sort((a, b) => a - b)
  const candidates: number[] = []
  for (let i = 1; i < n; i++) {
    const v = novelty[i]!
    if (v < NOVELTY_MIN) continue
    let peak = true
    for (let k = Math.max(1, i - 2); k <= Math.min(n - 1, i + 2); k++) {
      if (novelty[k]! > v || (novelty[k]! === v && k < i)) peak = false
    }
    if (peak) candidates.push(i)
  }
  // Strongest first, keeping every part long enough.
  candidates.sort((a, b) => novelty[b]! - novelty[a]!)
  const taken = [...sorted]
  for (const c of candidates) {
    if (taken.every((e) => Math.abs(e - c) >= NOVELTY_MIN_PART_BARS)) {
      taken.push(c)
      found.push(c)
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

interface Part {
  kind: SectionKind
  first: number
  last: number
}

function meanVector(vectors: Float32Array[], part: Part): Float32Array {
  const out = new Float32Array(vectors[0]!.length)
  for (let b = part.first; b <= part.last; b++) {
    for (let d = 0; d < out.length; d++) out[d] = out[d]! + vectors[b]![d]!
  }
  const bars = part.last - part.first + 1
  for (let d = 0; d < out.length; d++) out[d] = out[d]! / bars
  return out
}

/** Similarity of two parts, 0..1: how alike their average sound and their bar-by-bar course are. */
function partSimilarity(vectors: Float32Array[], a: Part, b: Part, means: Float32Array[]): number {
  const lenA = a.last - a.first + 1
  const lenB = b.last - b.first + 1
  if (Math.max(lenA, lenB) / Math.min(lenA, lenB) > GROUP_MAX_LENGTH_RATIO) return 0
  const overall = cosine(means[0]!, means[1]!)
  const bars = Math.min(lenA, lenB)
  let aligned = 0
  for (let k = 0; k < bars; k++) aligned += cosine(vectors[a.first + k]!, vectors[b.first + k]!)
  aligned /= bars
  return 0.5 * overall + 0.5 * aligned
}

/** Average-linkage clustering of parts; group numbers in order of first appearance. */
export function clusterParts(vectors: Float32Array[], parts: Part[]): number[] {
  const count = parts.length
  const means = parts.map((p) => meanVector(vectors, p))
  const sim: number[][] = Array.from({ length: count }, () => new Array<number>(count).fill(0))
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const s = partSimilarity(vectors, parts[i]!, parts[j]!, [means[i]!, means[j]!])
      sim[i]![j] = s
      sim[j]![i] = s
    }
  }
  let clusters: number[][] = parts.map((_, i) => [i])
  for (;;) {
    let best = -1
    let bestA = 0
    let bestB = 0
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        let total = 0
        let pairs = 0
        let blocked = false
        for (const i of clusters[a]!) {
          for (const j of clusters[b]!) {
            if (sim[i]![j]! <= 0) blocked = true
            total += sim[i]![j]!
            pairs++
          }
        }
        const mean = total / pairs
        if (!blocked && mean >= GROUP_SIMILARITY && mean > best) {
          best = mean
          bestA = a
          bestB = b
        }
      }
    }
    if (best < 0) break
    clusters[bestA] = [...clusters[bestA]!, ...clusters[bestB]!]
    clusters = clusters.filter((_, k) => k !== bestB)
  }
  const group = new Array<number>(count).fill(0)
  const byFirst = clusters
    .map((members) => members.slice().sort((x, y) => x - y))
    .sort((x, y) => x[0]! - y[0]!)
  byFirst.forEach((members, g) => members.forEach((i) => (group[i] = g)))
  return group
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const QUIET_SECTION_ENERGY = 0.75
/** Energy above the chorus by this much, with little vocal, is a drop. */
const DROP_OVER_CHORUS = 0.1
/** A section is vocal-rich with at least this share of vocal activity (relative to the track too). */
const VOCAL_RICH_RATIO = 0.6
const VOCAL_RICH_RELATIVE = 0.9
const PRE_CHORUS_MAX_BARS = 8
const PRE_CHORUS_RISE = 0.06
const BREAKDOWN_ENERGY = 0.65

function coverage(ranges: TimeRange[], start: number, end: number): number {
  let covered = 0
  for (const r of ranges) covered += Math.max(0, Math.min(r.end, end) - Math.max(r.start, start))
  return end > start ? covered / (end - start) : 0
}

interface RoleInfo {
  kind: SectionKind
  start: number
  end: number
  bars: number
  energy: number
  /** Last half of the section minus its first half, energy 0..1. */
  slope: number
  vocal: number
  group: number
}

export function assignRoles(infos: RoleInfo[], durationSec: number): SectionRole[] {
  const n = infos.length
  const roles: (SectionRole | null)[] = new Array<SectionRole | null>(n).fill(null)
  const totalBars = infos.reduce((s, i) => s + i.bars, 0)
  const meanEnergy = infos.reduce((s, i) => s + i.energy * i.bars, 0) / totalBars
  const trackVocal = infos.reduce((s, i) => s + i.vocal * i.bars, 0) / totalBars
  const groupSize = new Map<number, number>()
  for (const i of infos) groupSize.set(i.group, (groupSize.get(i.group) ?? 0) + 1)
  const repeated = (i: number) => (groupSize.get(infos[i]!.group) ?? 0) >= 2
  const vocalRich = (i: number) =>
    infos[i]!.vocal >= VOCAL_RICH_RATIO && infos[i]!.vocal >= VOCAL_RICH_RELATIVE * trackVocal

  // Edges: a quiet or low-energy start is an intro, a quiet unique end is an outro.
  if (n > 1) {
    const first = infos[0]!
    if (
      first.kind === 'quiet' ||
      (!repeated(0) &&
        (first.energy < QUIET_SECTION_ENERGY * meanEnergy ||
          first.vocal < 0.5 * Math.max(trackVocal, 0.01)))
    ) {
      roles[0] = 'intro'
    }
    const last = infos[n - 1]!
    if (
      last.kind === 'quiet' ||
      (!repeated(n - 1) && last.energy < QUIET_SECTION_ENERGY * meanEnergy) ||
      (roles[0] === 'intro' && last.group === infos[0]!.group)
    ) {
      roles[n - 1] = 'outro'
    }
  }

  // The loudest repeated group is the chorus (or, without vocals, the drop).
  let chorusGroup = -1
  let chorusEnergy = 0
  let bestScore = 0
  const groups = [...groupSize.keys()]
  for (const g of groups) {
    const members = infos.map((_, i) => i).filter((i) => infos[i]!.group === g && !roles[i])
    if (members.length < 2) continue
    const energy = members.reduce((s, i) => s + infos[i]!.energy, 0) / members.length
    const score = energy * (1 + 0.15 * Math.log2(members.length))
    if (energy >= meanEnergy && score > bestScore) {
      bestScore = score
      chorusGroup = g
      chorusEnergy = energy
    }
  }
  if (chorusGroup < 0) {
    // No repeats: the loudest section, if it clearly stands out, is the chorus/drop.
    let top = -1
    for (let i = 0; i < n; i++)
      if (!roles[i] && (top < 0 || infos[i]!.energy > infos[top]!.energy)) top = i
    if (top >= 0 && infos[top]!.energy >= meanEnergy + 0.1) {
      chorusGroup = infos[top]!.group
      chorusEnergy = infos[top]!.energy
    }
  }

  for (let i = 0; i < n; i++) {
    if (roles[i]) continue
    const info = infos[i]!
    const inChorus = info.group === chorusGroup
    const loud = inChorus || info.energy >= meanEnergy
    if (info.kind === 'drop' && loud && !vocalRich(i)) roles[i] = 'drop'
    else if (inChorus) roles[i] = 'chorus'
    else if (
      chorusGroup >= 0 &&
      info.energy >= chorusEnergy + DROP_OVER_CHORUS &&
      info.vocal < Math.max(0.5, trackVocal * 0.75)
    ) {
      roles[i] = 'drop'
    } else if (info.kind === 'drop' && loud) roles[i] = 'chorus'
  }

  const isPeak = (i: number) => roles[i] === 'chorus' || roles[i] === 'drop'
  for (let i = 0; i < n; i++) {
    if (roles[i]) continue
    const info = infos[i]!
    const prev = i > 0 ? i - 1 : -1
    const next = i + 1 < n ? i + 1 : -1
    if (
      info.kind === 'quiet' ||
      (info.energy < BREAKDOWN_ENERGY * meanEnergy && prev >= 0 && isPeak(prev))
    ) {
      roles[i] = 'breakdown'
    } else if (
      next >= 0 &&
      isPeak(next) &&
      info.bars <= PRE_CHORUS_MAX_BARS + 4 &&
      (info.kind === 'build' ||
        (info.bars <= PRE_CHORUS_MAX_BARS && info.slope >= PRE_CHORUS_RISE)) &&
      info.energy < infos[next]!.energy
    ) {
      roles[i] = 'pre-chorus'
    } else if (
      !repeated(i) &&
      info.start >= 0.5 * durationSec &&
      chorusGroup >= 0 &&
      infos.slice(0, i).some((_, k) => isPeak(k))
    ) {
      roles[i] = 'bridge'
    } else {
      roles[i] = 'verse'
    }
  }
  return roles as SectionRole[]
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Sections from energy runs, refined by novelty and labeled with repeat groups and roles. */
export function buildStructure(input: StructureInput): AudioSection[] {
  const { boundaries, energy, runs, spectrum, vocalActivity, durationSec } = input
  const barCount = boundaries.length - 1
  const vectors = barFeatureVectors(spectrum, boundaries, energy)

  // Split runs at novelty peaks that the energy analysis did not see.
  let parts: Part[] = runs.map((r) => ({ ...r }))
  if (barCount >= 2 * NOVELTY_MIN_PART_BARS) {
    const novelty = noveltyCurve(selfSimilarity(vectors), barCount)
    const edges = new Set([...parts.map((p) => p.first), barCount])
    const extra = noveltyBoundaries(novelty, edges)
    if (extra.length > 0) {
      const split: Part[] = []
      for (const part of parts) {
        const cuts = extra.filter((c) => c > part.first && c <= part.last).sort((a, b) => a - b)
        let first = part.first
        for (const c of cuts) {
          split.push({ kind: part.kind, first, last: c - 1 })
          first = c
        }
        split.push({ kind: part.kind, first, last: part.last })
      }
      parts = split
    }
  }

  const mean = (from: number, to: number) => {
    let sum = 0
    for (let b = from; b < to; b++) sum += energy[b]!
    return sum / Math.max(1, to - from)
  }
  const groups = clusterParts(vectors, parts)
  const infos: RoleInfo[] = parts.map((p, k) => {
    const bars = p.last - p.first + 1
    const mid = p.first + Math.floor(bars / 2)
    const start = boundaries[p.first]!
    const end = boundaries[p.last + 1]!
    return {
      kind: p.kind,
      start,
      end,
      bars,
      energy: mean(p.first, p.last + 1),
      slope: bars >= 2 ? mean(mid, p.last + 1) - mean(p.first, mid) : 0,
      vocal: coverage(vocalActivity, start, end),
      group: groups[k]!,
    }
  })
  const roles = assignRoles(infos, durationSec)
  return infos.map((info, k) => ({
    start: info.start,
    end: info.end,
    kind: info.kind,
    energy: Math.round(info.energy * 1000) / 1000,
    role: roles[k]!,
    repeatGroup: info.group,
  }))
}
