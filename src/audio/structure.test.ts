import { describe, expect, it } from 'vitest'
import type { AudioSection } from '@/shared'
import { analyzePcm } from './analyze'
import { assignRoles, clusterParts } from './structure'
import { clicks, clickTimes, lcg, pcmOf, silence } from './test/synth'

const SR = 22050
const BPM = 128
const BEAT = 60 / BPM
const BAR = 4 * BEAT
const BLOCK_BARS = 8

interface Block {
  /** Chord frequencies, Hz. */
  chord: number[]
  /** Harmonics per note: 1 = sine, more = brighter. */
  harmonics: number
  pad: number
  kick: number
  hats: number
}

const A: Block = { chord: [220, 277, 330], harmonics: 2, pad: 0.12, kick: 0.7, hats: 0.3 }
const B: Block = { chord: [294, 349, 440], harmonics: 6, pad: 0.08, kick: 0.35, hats: 0 }
const C: Block = { chord: [196, 247, 392], harmonics: 1, pad: 0.1, kick: 0.15, hats: 0 }

function addKick(track: Float32Array, time: number, gain: number) {
  const start = Math.round(time * SR)
  for (let k = 0; k < 0.15 * SR && start + k < track.length; k++) {
    const s = k / SR
    track[start + k] =
      track[start + k]! +
      gain * Math.sin(2 * Math.PI * (45 + 70 * Math.exp(-s * 30)) * s) * Math.exp(-s * 14)
  }
}

function songOf(blocks: Block[]) {
  const seconds = blocks.length * BLOCK_BARS * BAR
  const track = silence(SR, seconds)
  const random = lcg(3)
  void random
  blocks.forEach((block, index) => {
    const from = index * BLOCK_BARS * BAR
    const to = from + BLOCK_BARS * BAR
    for (let i = Math.round(from * SR); i < Math.min(track.length, Math.round(to * SR)); i++) {
      let v = 0
      for (const hz of block.chord) {
        for (let h = 1; h <= block.harmonics; h++) {
          v += (block.pad / h) * Math.sin((2 * Math.PI * hz * h * i) / SR)
        }
      }
      track[i] = v
    }
    for (let t = from; t < to - 0.01; t += BEAT) addKick(track, t, block.kick)
    if (block.hats > 0) {
      const hats = clicks(SR, seconds, clickTimes(2 * BPM, to, from))
      for (let i = 0; i < track.length; i++) track[i] = track[i]! + block.hats * hats[i]!
    }
  })
  return { track, seconds }
}

function analyse(blocks: Block[]) {
  const { track } = songOf(blocks)
  return analyzePcm(pcmOf(SR, track, track)).sections!
}

/** Which block (0-based) of the song a section mostly lies in. */
function blockOf(section: AudioSection) {
  return Math.floor((0.5 * (section.start + section.end)) / (BLOCK_BARS * BAR))
}

describe('structure', () => {
  it('groups repeats and names roles in A B A B C A', () => {
    const sections = analyse([A, B, A, B, C, A])
    // Every block is covered by sections of one group: same letter → same group.
    const groupOf = new Map<number, Set<number>>()
    for (const s of sections) {
      const b = blockOf(s)
      if (!groupOf.has(b)) groupOf.set(b, new Set())
      groupOf.get(b)!.add(s.repeatGroup!)
    }
    const g = (b: number) => [...groupOf.get(b)!].sort().join(',')
    expect(g(0)).toBe(g(2))
    expect(g(0)).toBe(g(5))
    expect(g(1)).toBe(g(3))
    expect(g(0)).not.toBe(g(1))
    expect(g(4)).not.toBe(g(0))
    expect(g(4)).not.toBe(g(1))

    const roleAt = (b: number) => sections.find((s) => blockOf(s) === b)!.role
    expect(roleAt(0)).toBe('chorus')
    expect(roleAt(2)).toBe('chorus')
    expect(roleAt(5)).toBe('chorus')
    expect(roleAt(1)).toBe('verse')
    expect(roleAt(3)).toBe('verse')
    expect(roleAt(4)).toBe('bridge')
  })

  it('is deterministic', () => {
    const blocks = [A, B, A, B, C, A]
    expect(analyse(blocks)).toEqual(analyse(blocks))
  })

  it('does not split a steady loop and calls it a verse', () => {
    const sections = analyse([A, A, A])
    expect(sections.length).toBe(1)
    expect(sections[0]!.role).toBe('verse')
    expect(sections[0]!.repeatGroup).toBe(0)
  })
})

describe('roles', () => {
  const info = (
    over: Partial<Parameters<typeof assignRoles>[0][number]> & { group: number },
    at: number,
  ) => ({
    kind: 'normal' as const,
    start: at * 16,
    end: at * 16 + 16,
    bars: 8,
    energy: 0.5,
    slope: 0,
    vocal: 0.9,
    ...over,
  })

  it('finds intro, drop, pre-chorus, breakdown and outro in an EDM layout', () => {
    const roles = assignRoles(
      [
        info({ group: 0, kind: 'quiet', energy: 0.15, vocal: 0.1 }, 0),
        info({ group: 1, kind: 'build', energy: 0.4, slope: 0.2, vocal: 0.1, bars: 4 }, 1),
        info({ group: 2, kind: 'drop', energy: 0.9, vocal: 0.1 }, 2),
        info({ group: 3, kind: 'quiet', energy: 0.2, vocal: 0.1 }, 3),
        info({ group: 1, kind: 'build', energy: 0.4, slope: 0.2, vocal: 0.1, bars: 4 }, 4),
        info({ group: 2, kind: 'drop', energy: 0.9, vocal: 0.1 }, 5),
        info({ group: 0, kind: 'quiet', energy: 0.15, vocal: 0.1 }, 6),
      ],
      112,
    )
    expect(roles).toEqual([
      'intro',
      'pre-chorus',
      'drop',
      'breakdown',
      'pre-chorus',
      'drop',
      'outro',
    ])
  })

  it('treats a loud vocal repeat as the chorus, not a drop', () => {
    const roles = assignRoles(
      [
        info({ group: 0, energy: 0.4 }, 0),
        info({ group: 1, energy: 0.8, kind: 'drop' }, 1),
        info({ group: 0, energy: 0.4 }, 2),
        info({ group: 1, energy: 0.8, kind: 'drop' }, 3),
      ],
      64,
    )
    expect(roles).toEqual(['verse', 'chorus', 'verse', 'chorus'])
  })

  it('clusters equal parts and keeps different ones apart', () => {
    const a = Float32Array.from([1, 0, 0])
    const b = Float32Array.from([0, 1, 0])
    const vectors = [a, a, b, b, a, a, b, b]
    const parts = [
      { kind: 'normal' as const, first: 0, last: 1 },
      { kind: 'normal' as const, first: 2, last: 3 },
      { kind: 'normal' as const, first: 4, last: 5 },
      { kind: 'normal' as const, first: 6, last: 7 },
    ]
    expect(clusterParts(vectors, parts)).toEqual([0, 1, 0, 1])
  })
})
