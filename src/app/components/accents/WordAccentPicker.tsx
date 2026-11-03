import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { flattenWords, normalizeWord } from '@/lyrics'
import type { Accent, AccentEffectId, LyricWord } from '@/shared'
import { Button, cn } from '@/ui'
import {
  addWordAccent,
  applyAccentToSameWords,
  previewAccent,
  removeAccent,
} from '../../accentActions'
import { ACCENT_EFFECTS, effectInfo } from '../../adapters'
import { t } from '../../i18n'
import { useAppStore } from '../../store'
import { AccentEditor } from './AccentEditor'
import { EFFECT_ICONS, effectGroup } from './effectIcons'

const GROUPS = (['hits', 'modes'] as const).map((group) => ({
  group,
  effects: ACCENT_EFFECTS.filter((effect) => effectGroup(effect.id) === group),
}))

/**
 * Accents of one word: any number of them, each with its own effect, strength and range.
 * Applies immediately.
 */
export function WordAccentPicker({ word }: { word: LyricWord }) {
  const allAccents = useAppStore((state) => state.timeline?.accents)
  const locked = useAppStore((state) => state.export.status === 'running')
  const accents = useMemo(
    () => (allAccents ?? []).filter((a) => a.wordId === word.id),
    [allAccents, word.id],
  )
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  function add(effect: AccentEffectId) {
    const id = addWordAccent(word.id, effect)
    setAdding(false)
    setOpenId(id)
    const placed = useAppStore.getState().timeline?.accents.find((a) => a.id === id)
    if (placed && word.start !== null) previewAccent(placed)
  }

  return (
    <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
      <legend className="sr-only">{t.accents.titles}</legend>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted" aria-hidden>
          {t.accents.titles}
          {accents.length > 0 && ` · ${accents.length}`}
        </span>
        <Button
          type="button"
          size="sm"
          variant={adding ? 'secondary' : 'ghost'}
          disabled={locked}
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          <Plus aria-hidden />
          {t.accents.add}
        </Button>
      </div>
      {adding && (
        <div className="flex flex-col gap-2 rounded-md bg-surface p-2">
          {GROUPS.map(({ group, effects }) => (
            <div key={group} className="flex flex-col gap-1">
              <span className="text-2xs font-semibold tracking-[0.08em] text-subtle uppercase">
                {t.accents.groups[group]}
              </span>
              <div className="grid grid-cols-5 gap-1">
                {effects.map((effect) => {
                  const Icon = EFFECT_ICONS[effect.id]
                  return (
                    <button
                      key={effect.id}
                      type="button"
                      title={effect.name}
                      aria-label={effect.name}
                      onClick={() => add(effect.id)}
                      className="flex h-8 items-center justify-center rounded-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <Icon className="size-4" aria-hidden />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {accents.map((accent) => (
          <WordAccentItem
            key={accent.id}
            accent={accent}
            word={word}
            open={openId === accent.id}
            disabled={locked}
            onToggle={() => setOpenId(openId === accent.id ? null : accent.id)}
          />
        ))}
      </ul>
    </fieldset>
  )
}

function WordAccentItem({
  accent,
  word,
  open,
  disabled,
  onToggle,
}: {
  accent: Accent
  word: LyricWord
  open: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const lyrics = useAppStore((state) => state.timeline?.lyrics)
  const sameCount = useMemo(() => {
    const key = normalizeWord(word.text)
    return lyrics && key
      ? flattenWords(lyrics).filter((ref) => normalizeWord(ref.word.text) === key).length
      : 1
  }, [lyrics, word.text])
  const Icon = EFFECT_ICONS[accent.effect]
  return (
    <li className={cn('rounded-md bg-surface', open && 'ring-1 ring-line-strong')}>
      <div className="flex items-center pr-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Icon className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{effectInfo(accent.effect).name}</span>
          {accent.endWordId && (
            <ArrowRight className="size-3 shrink-0 text-subtle" aria-label="диапазон" />
          )}
        </button>
        <Button
          type="button"
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
      {open && (
        <div className="flex flex-col gap-3 px-2 pt-1 pb-3">
          <AccentEditor accent={accent} disabled={disabled} />
          {sameCount > 1 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={disabled}
              onClick={() => applyAccentToSameWords(accent.id)}
            >
              {t.accents.sameWords(sameCount)}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
