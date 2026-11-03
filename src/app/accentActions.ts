import {
  addAccent,
  applyToAllOccurrences,
  flattenWords,
  isValidAccentRange,
  nextAccentId,
  regenerateAuto,
  removeAccent as removeAccentById,
  setAccentRange,
  suggestAccents,
  updateAccent as updateAccentById,
  type AccentOverrides,
  type AccentPatch,
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

/** Adds an accent to a word (a word may carry several). Returns the new accent id. */
export function addWordAccent(
  wordId: string,
  effect: AccentEffectId,
  overrides?: AccentOverrides,
): string | null {
  const timeline = useAppStore.getState().timeline
  if (!timeline) return null
  const id = nextAccentId(timeline.accents, wordId)
  commitAccents((accents) => addAccent(accents, wordId, effect, overrides))
  return id
}

/** Edits one accent by id; any edit makes it a user accent (regeneration will keep it). */
export function updateAccent(id: string, change: AccentPatch) {
  commitAccents((accents) => updateAccentById(accents, id, change))
}

export function removeAccent(id: string) {
  commitAccents((accents) => removeAccentById(accents, id))
}

/** Gives every word with the same text an accent of this accent's effect (copies its settings). */
export function applyAccentToSameWords(id: string) {
  commitAccents((accents, { lyrics }) => {
    const source = accents.find((accent) => accent.id === id)
    return source && lyrics
      ? applyToAllOccurrences(lyrics, accents, source.wordId, source.effect)
      : accents
  })
}

/**
 * Sets (or with `null` clears) the last word of a range accent. Returns false and changes nothing
 * when the end is not valid (earlier than the accent's word).
 */
export function setAccentEnd(id: string, endWordId: string | null): boolean {
  const lyrics = useAppStore.getState().timeline?.lyrics
  const accent = useAppStore.getState().timeline?.accents.find((a) => a.id === id)
  if (!lyrics || !accent) return false
  if (endWordId !== null && !isValidAccentRange(lyrics, accent.wordId, endWordId)) return false
  commitAccents((accents) => setAccentRange(lyrics, accents, id, endWordId))
  return true
}

let stopPreview: (() => void) | null = null

/** Plays the accent from 0.5 s before its word to the end of the effect (or range), then pauses. */
export function previewAccent(accent: Accent) {
  const lyrics = useAppStore.getState().timeline?.lyrics
  const words = lyrics ? flattenWords(lyrics) : []
  const word = words.find((ref) => ref.word.id === accent.wordId)?.word
  if (word?.start == null) return
  const endWord = accent.endWordId
    ? words.find((ref) => ref.word.id === accent.endWordId)?.word
    : undefined
  stopPreview?.()
  const from = Math.max(0, word.start - accent.preRollSec - 0.5)
  const effectEnd = Math.max(word.end ?? word.start, word.start + accent.durationSec)
  const until = Math.max(effectEnd, endWord?.end ?? 0) + 0.4
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
