import { Play, RefreshCw, Trash2, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { flattenWords, type AccentStyle } from '@/lyrics'
import type { Accent, LyricWord } from '@/shared'
import { Button, Segmented, cn, type SegmentedOption } from '@/ui'
import { previewAccent, regenerateAccents, removeAccent } from '../../accentActions'
import { effectInfo } from '../../adapters'
import { formatTime } from '../../format'
import { t } from '../../i18n'
import { useAppStore } from '../../store'
import { AccentEditor } from './AccentEditor'
import { EFFECT_ICONS, effectGroup, type EffectGroup } from './effectIcons'

const STYLE_OPTIONS: SegmentedOption<AccentStyle>[] = [
  { value: 'minimal', label: t.accents.styles.minimal },
  { value: 'balanced', label: t.accents.styles.balanced },
  { value: 'aggressive', label: t.accents.styles.aggressive },
]

export function AccentsPanel() {
  const timeline = useAppStore((state) => state.timeline)
  const locked = useAppStore((state) => state.export.status === 'running')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [style, setStyle] = useState<AccentStyle>('balanced')
  const lyrics = timeline?.lyrics ?? null
  const accents = useMemo(() => timeline?.accents ?? [], [timeline])
  const words = useMemo(
    () => new Map(lyrics ? flattenWords(lyrics).map((ref) => [ref.word.id, ref.word]) : []),
    [lyrics],
  )
  const hasTimedWords = [...words.values()].some((word) => word.start !== null)
  const autoCount = accents.filter((accent) => accent.source === 'auto').length

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-col gap-2">
        <Segmented
          label={t.accents.style}
          value={style}
          options={STYLE_OPTIONS}
          onChange={setStyle}
          disabled={!hasTimedWords || locked}
        />
        <Button
          variant={accents.length ? 'secondary' : 'primary'}
          disabled={!hasTimedWords || locked}
          onClick={() => regenerateAccents(style)}
        >
          {accents.length ? <RefreshCw aria-hidden /> : <WandSparkles aria-hidden />}
          {accents.length ? t.accents.regenerate : t.accents.suggest}
        </Button>
        <p className="text-xs text-subtle">
          {!lyrics
            ? t.accents.needLyrics
            : !hasTimedWords
              ? t.accents.needTimings
              : accents.length
                ? t.accents.summary(accents.length, autoCount)
                : t.accents.hint}
        </p>
      </div>

      {(['hits', 'modes'] as EffectGroup[]).map((group) => {
        const items = accents.filter((accent) => effectGroup(accent.effect) === group)
        if (!items.length) return null
        return (
          <section key={group} className="flex flex-col gap-1">
            <h3 className="px-0.5 text-2xs font-semibold tracking-[0.08em] text-subtle uppercase">
              {t.accents.groups[group]} · {items.length}
            </h3>
            <ul className="-mx-2 flex flex-col gap-0.5" aria-label={t.accents.groups[group]}>
              {items.map((accent) => (
                <AccentRow
                  key={accent.id}
                  accent={accent}
                  word={words.get(accent.wordId) ?? null}
                  selected={accent.id === selectedId}
                  disabled={locked}
                  onSelect={() => {
                    setSelectedId(accent.id === selectedId ? null : accent.id)
                    previewAccent(accent)
                  }}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function AccentRow({
  accent,
  word,
  selected,
  disabled,
  onSelect,
}: {
  accent: Accent
  word: LyricWord | null
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const Icon = EFFECT_ICONS[accent.effect]
  const info = effectInfo(accent.effect)
  const endWord = useAppStore((state) => {
    const lyrics = accent.endWordId ? state.timeline?.lyrics : null
    return lyrics
      ? (flattenWords(lyrics).find((ref) => ref.word.id === accent.endWordId)?.word.text ?? null)
      : null
  })
  return (
    <li className={cn('rounded-md transition-colors duration-150', selected && 'bg-raised')}>
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={selected}
          title={t.accents.preview}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {word?.text ?? t.accents.missingWord}
              {endWord && ` → ${endWord}`}
            </span>
            <span className="tabular block font-mono text-2xs text-subtle">
              {word?.start != null ? formatTime(word.start, true) : '—'} · {info.name}
              {accent.source === 'auto' && ` · ${t.accents.auto}`}
            </span>
          </span>
          <Play className="size-3.5 shrink-0 text-subtle" aria-hidden />
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 hover:text-danger"
          aria-label={t.accents.remove}
          title={t.accents.remove}
          disabled={disabled}
          onClick={() => removeAccent(accent.id)}
        >
          <Trash2 />
        </Button>
      </div>
      {selected && (
        <div className="px-2 pt-1 pb-3">
          <AccentEditor accent={accent} disabled={disabled} />
        </div>
      )}
    </li>
  )
}
