import { flattenWords, normalizeWord } from '@/lyrics'
import type { Accent, AccentEffectId, Timeline } from '@/shared'
import { effectInfo, patchTimeline, suggestAccents } from './adapters'
import { playback } from './playback'
import { useAppStore } from './store'

function commitAccents(update: (accents: Accent[], timeline: Timeline) => Accent[]) {
  const { timeline, setTimeline } = useAppStore.getState()
  if (!timeline) return
  setTimeline(patchTimeline(timeline, { accents: update(timeline.accents, timeline) }))
}

function newAccent(wordId: string, effect: AccentEffectId, intensity?: number): Accent {
  const info = effectInfo(effect)
  return {
    id: `user-${wordId}`,
    wordId,
    effect,
    source: 'user',
    preRollSec: info.preRollSec,
    durationSec: info.durationSec,
    intensity: intensity ?? info.intensity,
    params: {},
  }
}

/** Replaces auto accents with fresh suggestions; user accents and their words stay untouched. */
export function regenerateAccents() {
  commitAccents((accents, timeline) => {
    if (!timeline.lyrics) return accents
    const user = accents.filter((accent) => accent.source !== 'auto')
    const taken = new Set(user.map((accent) => accent.wordId))
    const suggested = suggestAccents(timeline.lyrics, timeline.audio).filter(
      (accent) => !taken.has(accent.wordId),
    )
    return sortByWordOrder([...user, ...suggested], timeline)
  })
}

/**
 * Sets the accent of a word (one per word). With `sameWords`, also of every word with the same
 * normalized text. `effect: null` removes the accent(s).
 */
export function setWordAccent(
  wordId: string,
  effect: AccentEffectId | null,
  intensity?: number,
  sameWords = false,
) {
  commitAccents((accents, timeline) => {
    const words = timeline.lyrics ? flattenWords(timeline.lyrics).map((ref) => ref.word) : []
    const key = normalizeWord(words.find((word) => word.id === wordId)?.text ?? '')
    const targets = new Set(
      sameWords && key
        ? words.filter((word) => normalizeWord(word.text) === key).map((word) => word.id)
        : [wordId],
    )
    const kept = accents.filter((accent) => !targets.has(accent.wordId))
    if (!effect) return kept
    const added = [...targets].map((id) => {
      const old = accents.find((accent) => accent.wordId === id)
      // Keep the user's timing and params when only the effect or intensity changes.
      return old && old.effect === effect
        ? { ...old, intensity: intensity ?? old.intensity, source: 'user' as const }
        : newAccent(id, effect, intensity)
    })
    return sortByWordOrder([...kept, ...added], timeline)
  })
}

/** Edits one accent; any edit makes it a user accent (regeneration will keep it). */
export function updateAccent(id: string, patch: Partial<Omit<Accent, 'id' | 'wordId'>>) {
  commitAccents((accents) =>
    accents.map((accent) => {
      if (accent.id !== id) return accent
      const next = { ...accent, ...patch, source: 'user' as const }
      if (patch.effect && patch.effect !== accent.effect) {
        const info = effectInfo(patch.effect)
        return { ...next, preRollSec: info.preRollSec, durationSec: info.durationSec, params: {} }
      }
      return next
    }),
  )
}

export function removeAccent(id: string) {
  commitAccents((accents) => accents.filter((accent) => accent.id !== id))
}

let stopPreview: (() => void) | null = null

/** Plays the accent from 0.5 s before its word to the end of the effect, then pauses. */
export function previewAccent(accent: Accent) {
  const lyrics = useAppStore.getState().timeline?.lyrics
  const word = lyrics && flattenWords(lyrics).find((ref) => ref.word.id === accent.wordId)?.word
  if (word?.start == null) return
  stopPreview?.()
  const from = Math.max(0, word.start - accent.preRollSec - 0.5)
  const until = Math.max(word.end ?? word.start, word.start + accent.durationSec) + 0.4
  playback.seek(from)
  void playback.play()
  const unsubscribe = playback.subscribe((time) => {
    if (time >= until) playback.pause()
    // Done, or the user jumped elsewhere: stop watching.
    if (time >= until || time < from - 0.1) stop()
  })
  function stop() {
    unsubscribe()
    if (stopPreview === stop) stopPreview = null
  }
  stopPreview = stop
}

function sortByWordOrder(accents: Accent[], timeline: Timeline): Accent[] {
  const order = new Map(
    (timeline.lyrics ? flattenWords(timeline.lyrics) : []).map((ref, i) => [ref.word.id, i]),
  )
  return accents.toSorted((a, b) => (order.get(a.wordId) ?? 0) - (order.get(b.wordId) ?? 0))
}
