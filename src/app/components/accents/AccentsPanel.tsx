import { Play, RefreshCw, Trash2, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { flattenWords } from '@/lyrics'
import type { Accent, AccentEffectId, LyricWord } from '@/shared'
import { Button, Select, Slider, cn } from '@/ui'
import { previewAccent, regenerateAccents, removeAccent, updateAccent } from '../../accentActions'
import { ACCENT_EFFECTS, effectInfo } from '../../adapters'
import { formatTime } from '../../format'
import { t } from '../../i18n'
import { useAppStore } from '../../store'
import { ParamControls } from '../ParamControls'
import { EFFECT_ICONS } from './effectIcons'

const EFFECT_OPTIONS = ACCENT_EFFECTS.map((effect) => ({ value: effect.id, label: effect.name }))

export function AccentsPanel() {
  const timeline = useAppStore((state) => state.timeline)
  const locked = useAppStore((state) => state.export.status === 'running')
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
        <Button
          variant={accents.length ? 'secondary' : 'primary'}
          disabled={!hasTimedWords || locked}
          onClick={regenerateAccents}
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

      {accents.length > 0 && (
        <ul className="-mx-2 flex flex-col gap-0.5" aria-label={t.accents.list}>
          {accents.map((accent) => (
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
      )}
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
        <div className="flex flex-col gap-3 px-2 pt-1 pb-3">
          <Select
            label={t.accents.effect}
            value={accent.effect}
            options={EFFECT_OPTIONS}
            disabled={disabled}
            onChange={(effect: AccentEffectId) => updateAccent(accent.id, { effect })}
          />
          <Slider
            label={t.accents.intensity}
            value={accent.intensity}
            disabled={disabled}
            onChange={(intensity) => updateAccent(accent.id, { intensity })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label={t.accents.duration}
            value={accent.durationSec}
            min={0.1}
            max={2}
            step={0.05}
            disabled={disabled}
            onChange={(durationSec) => updateAccent(accent.id, { durationSec })}
            format={(v) => `${v.toFixed(2)} с`}
          />
          {info.params.length > 0 && (
            <ParamControls
              schema={info.params}
              values={accent.params}
              disabled={disabled}
              onChange={(key, value) =>
                updateAccent(accent.id, { params: { ...accent.params, [key]: value } })
              }
            />
          )}
        </div>
      )}
    </li>
  )
}
