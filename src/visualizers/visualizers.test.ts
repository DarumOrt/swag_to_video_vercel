import { describe, expect, it } from 'vitest'
import { buildColorLut, dbToMeter, linToDb, parseHexColor } from './common'
import { heldMax, windowMean } from './meters'
import { overview } from './waveform'

describe('colors', () => {
  it('parses short and long hex, with alpha', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255, 255])
    expect(parseHexColor('#10203040')).toEqual([16, 32, 48, 64])
    expect(parseHexColor('red')).toEqual([255, 255, 255, 255])
  })

  it('builds a 256-entry LUT through the stops', () => {
    const lut = buildColorLut([
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ff0000' },
    ])
    expect(lut.length).toBe(1024)
    expect(lut[0]).toBe(0)
    expect(lut[255 * 4]).toBe(255)
    expect(lut[128 * 4]).toBeGreaterThan(120)
  })
})

describe('levels', () => {
  it('converts amplitude to dB and meter position', () => {
    expect(linToDb(1)).toBe(0)
    expect(linToDb(0.5)).toBeCloseTo(-6.02, 1)
    expect(linToDb(0)).toBe(-96)
    expect(dbToMeter(-30, -60)).toBe(0.5)
    expect(dbToMeter(-90, -60)).toBe(0)
  })

  it('holds the peak over a window of past frames only', () => {
    const s = Float32Array.from([0, 0.9, 0, 0, 0, 0])
    expect(heldMax(s, 3, 10, 0.2)).toBeCloseTo(0.9)
    expect(heldMax(s, 5, 10, 0.2)).toBe(0)
    expect(heldMax(s, 0, 10, 1)).toBe(0)
  })

  it('averages over a window', () => {
    expect(windowMean(Float32Array.from([1, 1, -1, -1]), 3, 10, 0.1)).toBe(-1)
    expect(windowMean(Float32Array.from([1, 1, -1, -1]), 3, 10, 1)).toBe(0)
  })
})

describe('waveform overview', () => {
  it('takes the max per column', () => {
    const v = overview(Float32Array.from([0.1, 0.5, 0.2, 0.9]), 0, 4, 2)
    expect(Array.from(v).map((x) => +x.toFixed(2))).toEqual([0.5, 0.9])
  })

  it('handles windows partly outside the track', () => {
    const v = overview(Float32Array.from([0.3, 0.6]), -2, 2, 2)
    expect(Array.from(v).map((x) => +x.toFixed(2))).toEqual([0, 0.6])
  })
})
