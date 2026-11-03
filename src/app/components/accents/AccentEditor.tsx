import { ArrowRight, X } from 'lucide-react'
import { useMemo } from 'react'
import { flattenWords } from '@/lyrics'
import type { Accent, AccentEffectId } from '@/shared'
import { Button, Select, Slider } from '@/ui'
import { updateAccent } from '../../accentActions'
import { ACCENT_EFFECTS, effectInfo } from '../../adapters'
import { t } from '../../i18n'
import { cancelRangePick, startRangePick } from '../../lyricsActions'
import { useLyricsStore } from '../../lyricsStore'
import { useAppStore } from '../../store'
import { ParamControls } from '../ParamControls'
import { effectGroup } from './effectIcons'

const EFFECT_OPTIONS = ACCENT_EFFECTS.map((effect) => ({
  value: effect.id,
  label: `${t.accents.groups[effectGroup(effect.id)]} · ${effect.name}`,
}))

/** Settings of one accent: effect, strength, length, effect params, range "from word to word". */
export function AccentEditor({ accent, disabled }: { accent: Accent; disabled: boolean }) {
  const info = effectInfo(accent.effect)
  return (
    <div className="flex flex-col gap-3">
      <Select
        label={t.accents.effect}
        value={accent.effect}
        options={EFFECT_OPTIONS}
        disabled={disabled}
        onChange={(effect: AccentEffectId) => updateAccent(accent.id, { effect })}
      />
      <RangeControl accent={accent} disabled={disabled} />
      <Slider
        label={t.accents.intensity}
        value={accent.intensity}
        disabled={disabled}
        onChange={(intensity) => updateAccent(accent.id, { intensity })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label={accent.endWordId ? t.accents.release : t.accents.duration}
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
  )
}

function RangeControl({ accent, disabled }: { accent: Accent; disabled: boolean }) {
  const lyrics = useAppStore((state) => state.timeline?.lyrics ?? null)
  const picking = useLyricsStore((state) => state.rangePick?.accentId === accent.id)
  const words = useMemo(
    () => new Map(lyrics ? flattenWords(lyrics).map((ref) => [ref.word.id, ref.word.text]) : []),
    [lyrics],
  )
  const from = words.get(accent.wordId) ?? '…'
  const to = accent.endWordId ? (words.get(accent.endWordId) ?? '…') : null

  if (picking) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md bg-accent-soft px-3 py-2">
        <p role="status" className="text-xs text-accent">
          {t.accents.rangePick}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={cancelRangePick}
        >
          {t.accents.rangeCancel}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {to ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <span className="truncate">{from}</span>
            <ArrowRight className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{to}</span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => startRangePick(accent.id)}
          >
            {t.accents.rangeTo}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t.accents.rangeClear}
            title={t.accents.rangeClear}
            disabled={disabled}
            onClick={() => updateAccent(accent.id, { endWordId: null })}
          >
            <X />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => startRangePick(accent.id)}
        >
          {t.accents.rangeTo}
        </Button>
      )}
    </div>
  )
}
