import { Ban } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { flattenWords, normalizeWord } from '@/lyrics'
import type { AccentEffectId, LyricWord } from '@/shared'
import { Slider, cn } from '@/ui'
import { previewAccent, setWordAccent } from '../../accentActions'
import { ACCENT_EFFECTS, effectInfo } from '../../adapters'
import { t } from '../../i18n'
import { useAppStore } from '../../store'
import { EFFECT_ICONS } from './effectIcons'

/** Accent of one word: effect, intensity, "apply to all such words". Applies immediately. */
export function WordAccentPicker({ word }: { word: LyricWord }) {
  const id = useId()
  const timeline = useAppStore((state) => state.timeline)
  const accent = timeline?.accents.find((a) => a.wordId === word.id) ?? null
  const [sameWords, setSameWords] = useState(false)
  const sameCount = useMemo(() => {
    const key = normalizeWord(word.text)
    const lyrics = timeline?.lyrics
    return lyrics && key
      ? flattenWords(lyrics).filter((ref) => normalizeWord(ref.word.text) === key).length
      : 1
  }, [timeline?.lyrics, word.text])

  function apply(effect: AccentEffectId | null, intensity?: number) {
    setWordAccent(word.id, effect, intensity, sameWords)
    if (!effect || word.start === null) return
    const placed = useAppStore.getState().timeline?.accents.find((a) => a.wordId === word.id)
    if (placed && intensity === undefined) previewAccent(placed)
  }

  return (
    <fieldset className="flex flex-col gap-2.5 border-t border-line pt-3">
      <legend className="sr-only">{t.accents.title}</legend>
      <span className="text-xs text-muted" aria-hidden>
        {t.accents.title}
      </span>
      <div role="radiogroup" aria-label={t.accents.effect} className="grid grid-cols-5 gap-1">
        <EffectButton
          label={t.accents.none}
          checked={!accent}
          onClick={() => apply(null)}
          icon={<Ban className="size-4" aria-hidden />}
        />
        {ACCENT_EFFECTS.map((effect) => {
          const Icon = EFFECT_ICONS[effect.id]
          return (
            <EffectButton
              key={effect.id}
              label={effect.name}
              checked={accent?.effect === effect.id}
              onClick={() => apply(effect.id)}
              icon={<Icon className="size-4" aria-hidden />}
            />
          )
        })}
      </div>
      {accent && (
        <>
          <p className="-mt-1 text-2xs text-subtle">{effectInfo(accent.effect).name}</p>
          <Slider
            label={t.accents.intensity}
            value={accent.intensity}
            onChange={(intensity) => apply(accent.effect, intensity)}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      )}
      {sameCount > 1 && (
        <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted">
          <input
            id={id}
            type="checkbox"
            checked={sameWords}
            onChange={(event) => setSameWords(event.currentTarget.checked)}
            className="size-3.5 accent-[var(--color-accent)]"
          />
          {t.accents.sameWords(sameCount)}
        </label>
      )}
    </fieldset>
  )
}

function EffectButton({
  label,
  checked,
  onClick,
  icon,
}: {
  label: string
  checked: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center justify-center rounded-sm text-muted transition-colors duration-100',
        'hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent',
        checked && 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--color-accent)]',
      )}
    >
      {icon}
    </button>
  )
}
