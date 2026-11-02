import {
  applyToAllOccurrences,
  flattenWords,
  normalizeWord,
  regenerateAuto,
  removeAccent as removeWordAccent,
  setAccent,
  suggestAccents,
  type AccentOverrides,
  type AccentStyle,
} from '@/lyrics'
import type { Accent, AccentEffectId, Timeline } from '@/shared'
import { patchTimeline } from './adapters'
import { playback } from './playback'
import { useAppStore } from './store'

function commitAccents(update: (accents: Accent[], timeline: Timeline) => Accent[]) {
  const { timeline, setTimeline } = useAppStore.getState()
  if (!timeline) return
  const accents = update(timeline.accents, timeline)
  setTimeline(patchTimeline(timeline, { accents: sortByWordOrder(accents, timeline) }))
}

/** Replaces auto accents with fresh suggestions; user accents and their words stay untouched. */
export function regenerateAccents(style: AccentStyle = 'balanced') {
  commitAccents((accents, { lyrics, audio }) => {
    if (!lyrics) return accents
    const suggestions = suggestAccents(lyrics, audio.rhythm, audio.sections ?? [], { style })
    return regenerateAuto(accents, suggestions)
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
  commitAccents((accents, { lyrics }) => {
    if (!effect) {
      if (!sameWords || !lyrics) return removeWordAccent(accents, wordId)
      const words = flattenWords(lyrics).map((ref) => ref.word)
      const key = normalizeWord(words.find((word) => word.id === wordId)?.text ?? '')
      const same = new Set(words.filter((w) => normalizeWord(w.text) === key).map((w) => w.id))
      return accents.filter((accent) => !same.has(accent.wordId))
    }
    const own = setAccent(accents, wordId, effect, intensity === undefined ? {} : { intensity })
    // The other occurrences copy the settings of this word's (just updated) accent.
    return sameWords && lyrics ? applyToAllOccurrences(lyrics, own, wordId, effect) : own
  })
}

/** Edits one accent; any edit makes it a user accent (regeneration will keep it). */
export function updateAccent(
  wordId: string,
  change: AccentOverrides & { effect?: AccentEffectId },
) {
  commitAccents((accents) => {
    const current = accents.find((accent) => accent.wordId === wordId)
    if (!current) return accents
    const { effect = current.effect, ...overrides } = change
    return setAccent(accents, wordId, effect, overrides)
  })
}

export function removeAccent(wordId: string) {
  commitAccents((accents) => removeWordAccent(accents, wordId))
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
