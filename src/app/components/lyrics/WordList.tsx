import { Merge } from 'lucide-react'
import { memo, useEffect, useMemo, useRef } from 'react'
import { flattenWords, isUncertain, nextTapUnit } from '@/lyrics'
import type { Accent, AccentEffectId, LyricWord, Lyrics } from '@/shared'
import { cn } from '@/ui'
import { formatTime } from '../../format'
import { t } from '../../i18n'
import { mergeLineWithNext, pickRangeEnd, selectWord } from '../../lyricsActions'
import { indexTimedWords, wordAt } from '../../lyricsEdit'
import { useLyricsStore } from '../../lyricsStore'
import { playback } from '../../playback'
import { useAppStore } from '../../store'
import { EFFECT_COLORS, EFFECT_ICONS } from '../accents/effectIcons'

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
  const marks = useMemo(() => wordMarks(lyrics, accents ?? []), [lyrics, accents])
  const picking = useLyricsStore((state) => state.rangePick)
  const pickStart = useMemo(() => {
    const accent = picking && accents?.find((a) => a.id === picking.accentId)
    return accent ? (marks.order.get(accent.wordId) ?? null) : null
  }, [picking, accents, marks])

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
                'group/line flex flex-wrap gap-0.5 rounded-md px-1 py-1 transition-colors duration-150',
                lineIsTarget && 'bg-accent-soft shadow-[inset_2px_0_0_var(--color-accent)]',
              )}
            >
              {i < lyrics.lines.length - 1 && (
                <button
                  type="button"
                  title={t.lyrics.lines.mergeNext}
                  aria-label={t.lyrics.lines.mergeNext}
                  onClick={() => mergeLineWithNext(line.id)}
                  className="order-last ml-auto flex size-6 items-center justify-center self-center rounded-sm text-subtle opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/line:opacity-100"
                >
                  <Merge className="size-3.5" aria-hidden />
                </button>
              )}
              {line.words.map((word) => (
                <WordChip
                  key={word.id}
                  word={word}
                  selected={word.id === selectedId}
                  tapTarget={tapTarget === word.id}
                  marks={marks.byWord.get(word.id) ?? NO_MARKS}
                  pick={
                    pickStart === null
                      ? null
                      : (marks.order.get(word.id) ?? 0) >= pickStart
                        ? 'ok'
                        : 'invalid'
                  }
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const WordChip = memo(WordChipView, sameChip)

function WordChipView({
  word,
  selected,
  tapTarget,
  marks,
  pick,
}: {
  word: LyricWord
  selected: boolean
  tapTarget: boolean
  marks: WordMarks
  /** While an accent range end is being chosen: whether this word may be the end. */
  pick: 'ok' | 'invalid' | null
}) {
  const effect = marks.start[0] ?? null
  const EffectIcon = effect ? EFFECT_ICONS[effect] : null
  const uncertain = isUncertain(word)
  const timed = word.start !== null
  const time = timed ? formatTime(word.start!, true) : t.lyrics.noTime

  function onClick() {
    if (pick) {
      pickRangeEnd(word.id)
      return
    }
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
        t.lyrics.wordLabel(word.text, time) +
        (marks.start.length ? `, ${t.accents.count(marks.start.length).toLowerCase()}` : '')
      }
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-start rounded-sm px-1.5 py-0.5 text-left',
        'transition-[background-color,color,box-shadow] duration-100 ease-out',
        'hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent',
        'data-active:bg-accent data-active:text-accent-fg',
        !timed && 'text-subtle',
        uncertain && 'bg-warn-soft',
        selected && 'shadow-[inset_0_0_0_1px_var(--color-accent)]',
        tapTarget && 'bg-accent-soft shadow-[inset_0_0_0_1px_var(--color-accent)]',
        pick === 'ok' && 'ring-1 ring-accent/40',
        pick === 'invalid' && 'cursor-not-allowed opacity-40 ring-1 ring-danger/60',
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
        {marks.start.length > 1 && (
          <span className="tabular rounded-full bg-accent px-1 font-mono text-[9px] leading-3 text-accent-fg">
            {marks.start.length}
          </span>
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
      {marks.cover.length > 0 && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col">
          {marks.cover.map((cover, i) => (
            <span key={i} className="h-[3px]" style={{ backgroundColor: EFFECT_COLORS[cover] }} />
          ))}
        </span>
      )}
    </button>
  )
}

function sameChip(
  a: Parameters<typeof WordChipView>[0],
  b: Parameters<typeof WordChipView>[0],
): boolean {
  return (
    a.word === b.word &&
    a.selected === b.selected &&
    a.tapTarget === b.tapTarget &&
    a.pick === b.pick &&
    a.marks.sig === b.marks.sig
  )
}

interface WordMarks {
  /** Effects of accents that start on the word. */
  start: AccentEffectId[]
  /** Effects of range accents that cover the word (including its first and last word). */
  cover: AccentEffectId[]
  /** Content signature, so memoized chips skip re-rendering when their marks did not change. */
  sig: string
}

const NO_MARKS: WordMarks = { start: [], cover: [], sig: '' }

function wordMarks(lyrics: Lyrics, accents: readonly Accent[]) {
  const order = new Map(flattenWords(lyrics).map((ref, i) => [ref.word.id, i]))
  const ids = [...order.keys()]
  const byWord = new Map<string, WordMarks>()
  const get = (id: string) => {
    let marks = byWord.get(id)
    if (!marks) byWord.set(id, (marks = { start: [], cover: [], sig: '' }))
    return marks
  }
  for (const accent of accents) {
    get(accent.wordId).start.push(accent.effect)
    const from = order.get(accent.wordId)
    const to = accent.endWordId ? order.get(accent.endWordId) : undefined
    if (from === undefined || to === undefined || to < from) continue
    for (let i = from; i <= to; i++) get(ids[i]!).cover.push(accent.effect)
  }
  for (const marks of byWord.values()) marks.sig = marks.start.join() + '|' + marks.cover.join()
  return { order, byWord }
}
