import { memo, useEffect, useMemo, useRef } from 'react'
import { isUncertain, nextTapUnit } from '@/lyrics'
import type { AccentEffectId, LyricWord, Lyrics } from '@/shared'
import { cn } from '@/ui'
import { formatTime } from '../../format'
import { t } from '../../i18n'
import { selectWord } from '../../lyricsActions'
import { indexTimedWords, wordAt } from '../../lyricsEdit'
import { useLyricsStore } from '../../lyricsStore'
import { playback } from '../../playback'
import { useAppStore } from '../../store'
import { EFFECT_ICONS } from '../accents/effectIcons'

/**
 * Lines and words of the lyrics. The word under the playhead is marked imperatively
 * (data-active), so playback does not re-render the list.
 */
export function WordList({ lyrics }: { lyrics: Lyrics }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedId = useLyricsStore((state) => state.selectedWordId)
  const tapTarget = useLyricsStore((state) => (state.tap ? nextTapUnit(state.tap) : null))
  const index = useMemo(() => indexTimedWords(lyrics), [lyrics])
  const accents = useAppStore((state) => state.timeline?.accents)
  const effectByWord = useMemo(
    () => new Map((accents ?? []).map((accent) => [accent.wordId, accent.effect])),
    [accents],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let activeId: string | null = null
    let activeEl: HTMLElement | null = null
    return playback.subscribe((time) => {
      const id = wordAt(index, time)
      if (id === activeId) return
      activeEl?.removeAttribute('data-active')
      activeId = id
      activeEl = id ? container.querySelector(`[data-word-id="${CSS.escape(id)}"]`) : null
      if (!activeEl) return
      activeEl.setAttribute('data-active', '')
      if (playback.playing) activeEl.scrollIntoView({ block: 'nearest' })
    })
  }, [index])

  // Keep the next tap target in view while tapping.
  useEffect(() => {
    if (!tapTarget) return
    containerRef.current
      ?.querySelector(`[data-tap-id="${CSS.escape(tapTarget)}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [tapTarget])

  return (
    <div ref={containerRef} className="flex flex-col gap-0.5 px-2 py-3">
      {lyrics.lines.map((line, i) => {
        const header = line.section !== undefined && line.section !== lyrics.lines[i - 1]?.section
        const lineIsTarget = tapTarget === line.id
        return (
          <div key={line.id}>
            {header && (
              <p className="mt-3 mb-1 px-2 text-2xs font-semibold tracking-[0.08em] text-subtle uppercase first:mt-0">
                {line.section}
              </p>
            )}
            <div
              data-tap-id={line.id}
              className={cn(
                'flex flex-wrap gap-0.5 rounded-md px-1 py-1 transition-colors duration-150',
                lineIsTarget && 'bg-accent-soft shadow-[inset_2px_0_0_var(--color-accent)]',
              )}
            >
              {line.words.map((word) => (
                <WordChip
                  key={word.id}
                  word={word}
                  selected={word.id === selectedId}
                  tapTarget={tapTarget === word.id}
                  effect={effectByWord.get(word.id) ?? null}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const WordChip = memo(function WordChip({
  word,
  selected,
  tapTarget,
  effect,
}: {
  word: LyricWord
  selected: boolean
  tapTarget: boolean
  effect: AccentEffectId | null
}) {
  const EffectIcon = effect ? EFFECT_ICONS[effect] : null
  const uncertain = isUncertain(word)
  const timed = word.start !== null
  const time = timed ? formatTime(word.start!, true) : t.lyrics.noTime

  function onClick() {
    if (playback.playing && timed) playback.seek(word.start!)
    else selectWord(selected ? null : word.id)
  }

  return (
    <button
      type="button"
      data-word-id={word.id}
      data-tap-id={word.id}
      aria-pressed={selected}
      aria-label={
        t.lyrics.wordLabel(word.text, time) + (effect ? `, ${t.accents.title.toLowerCase()}` : '')
      }
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start rounded-sm px-1.5 py-0.5 text-left',
        'transition-[background-color,color,box-shadow] duration-100 ease-out',
        'hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent',
        'data-active:bg-accent data-active:text-accent-fg',
        !timed && 'text-subtle',
        uncertain && 'bg-warn-soft',
        selected && 'shadow-[inset_0_0_0_1px_var(--color-accent)]',
        tapTarget && 'bg-accent-soft shadow-[inset_0_0_0_1px_var(--color-accent)]',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1 text-[14px] leading-5',
          uncertain && 'underline decoration-warn decoration-dotted underline-offset-4',
        )}
      >
        {word.text}
        {EffectIcon && (
          <EffectIcon
            aria-hidden
            className="size-3 shrink-0 text-accent group-data-active:text-accent-fg"
          />
        )}
      </span>
      <span
        className={cn(
          'tabular font-mono text-[10px] leading-3 text-subtle group-data-active:text-accent-fg/70',
          word.timingSource === 'manual' && 'text-accent',
        )}
      >
        {timed ? time : '—'}
      </span>
    </button>
  )
})
