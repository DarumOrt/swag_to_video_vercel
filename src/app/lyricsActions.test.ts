import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadEstimate, ModelStatuses } from './adapters'

const adapters = vi.hoisted(() => ({
  cached: { light: true, max: false },
  clearing: false,
}))

function estimate(cached: boolean, total: number): DownloadEstimate {
  return {
    model: 'small',
    device: 'wasm',
    note: null,
    totalBytes: total,
    toDownloadBytes: cached ? 0 : total,
  } as unknown as DownloadEstimate
}

vi.mock('./store', async () => {
  const { create } = await import('zustand')
  return { useAppStore: create(() => ({ timeline: null, track: null })) }
})

vi.mock('./adapters', () => ({
  modelStatuses: vi.fn(async (): Promise<ModelStatuses> => ({
    light: estimate(adapters.cached.light, 480),
    max: estimate(adapters.cached.max, 1500),
  })),
  modelCacheInfo: vi.fn(async () => ({
    bytes: adapters.cached.light ? 480 : 0,
    files: 3,
    storage: null,
  })),
  clearModelCache: vi.fn(async () => {
    adapters.cached.light = false
    adapters.cached.max = false
    return 3
  }),
  transcribe: vi.fn(async () => []),
  withLyrics: vi.fn(),
}))

import {
  askClearModelCache,
  confirmClearModelCache,
  confirmRecognition,
  recognitionNeedsConfirm,
  requestRecognition,
} from './lyricsActions'
import { INITIAL_LYRICS_EDITOR, useLyricsStore } from './lyricsStore'
import { useAppStore } from './store'
import * as adapterMock from './adapters'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setLyrics(origin: 'recognized' | 'text', edited = false) {
  useAppStore.setState({ timeline: { lyrics: { lines: [{}] } } } as never)
  useLyricsStore.setState({ origin, edited })
}

beforeEach(() => {
  adapters.cached = { light: true, max: false }
  useLyricsStore.setState(INITIAL_LYRICS_EDITOR)
  useAppStore.setState({ timeline: null } as never)
  vi.clearAllMocks()
})

describe('recognition window', () => {
  it('opens even when the model is cached and shows per-quality status', async () => {
    await requestRecognition()
    const prompt = useLyricsStore.getState().prompt
    expect(prompt).not.toBeNull()
    expect(prompt?.statuses?.light?.toDownloadBytes).toBe(0)
    expect(prompt?.statuses?.max?.toDownloadBytes).toBe(1500)
    expect(adapterMock.transcribe).not.toHaveBeenCalled()
  })

  it('opens when nothing is cached', async () => {
    adapters.cached = { light: false, max: false }
    await requestRecognition()
    expect(useLyricsStore.getState().prompt?.statuses?.light?.toDownloadBytes).toBe(480)
  })

  it('closes on confirm without lyrics', async () => {
    await requestRecognition()
    confirmRecognition()
    expect(useLyricsStore.getState().prompt).toBeNull()
  })
})

describe('replace confirmation', () => {
  it('needs confirmation for pasted text or edited recognition, not for a clean recognition', () => {
    expect(recognitionNeedsConfirm()).toBe(false)
    setLyrics('recognized')
    expect(recognitionNeedsConfirm()).toBe(false)
    setLyrics('recognized', true)
    expect(recognitionNeedsConfirm()).toBe(true)
    setLyrics('text')
    expect(recognitionNeedsConfirm()).toBe(true)
  })

  it('first confirm asks, second starts', async () => {
    setLyrics('text')
    await requestRecognition()
    confirmRecognition()
    expect(useLyricsStore.getState().prompt?.confirmReplace).toBe(true)
    confirmRecognition()
    expect(useLyricsStore.getState().prompt).toBeNull()
  })
})

describe('clearing the model cache', () => {
  it('asks, clears and refreshes the statuses', async () => {
    await requestRecognition()
    askClearModelCache(true)
    expect(useLyricsStore.getState().prompt?.confirmClear).toBe(true)
    expect(useLyricsStore.getState().prompt?.cacheBytes).toBe(480)
    await confirmClearModelCache()
    await flush()
    expect(adapterMock.clearModelCache).toHaveBeenCalledOnce()
    const prompt = useLyricsStore.getState().prompt
    expect(prompt?.confirmClear).toBe(false)
    expect(prompt?.cacheBytes).toBe(0)
    expect(prompt?.statuses?.light?.toDownloadBytes).toBe(480)
  })

  it('does nothing without the window (e.g. during recognition)', async () => {
    await confirmClearModelCache()
    expect(adapterMock.clearModelCache).not.toHaveBeenCalled()
  })
})
