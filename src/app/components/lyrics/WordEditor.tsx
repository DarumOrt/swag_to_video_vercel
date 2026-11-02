import { Clock, Play, Trash2, X } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import type { LyricWord } from '@/shared'
import { Button, cn } from '@/ui'
import { formatTimeInput, parseTimeInput } from '../../format'
import { t } from '../../i18n'
import { removeWord, selectWord, updateWord } from '../../lyricsActions'
import { playback } from '../../playback'
import { WordAccentPicker } from '../accents/WordAccentPicker'

/** Edits one word: text, start and end. Saving marks the timing as 'manual'. Keyed by word id. */
export function WordEditor({ word }: { word: LyricWord }) {
  const id = useId()
  const [text, setText] = useState(word.text)
  const [start, setStart] = useState(word.start !== null ? formatTimeInput(word.start) : '')
  const [end, setEnd] = useState(word.end !== null ? formatTimeInput(word.end) : '')
  const [error, setError] = useState(false)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) {
      removeWord(word.id)
      return
    }
    const startSec = start.trim() ? parseTimeInput(start) : null
    let endSec = end.trim() ? parseTimeInput(end) : null
    const badStart = start.trim() !== '' && startSec === null
    if (startSec !== null && endSec === null) endSec = startSec + 0.3
    if (badStart || (startSec !== null && endSec !== null && endSec <= startSec)) {
      setError(true)
      return
    }
    const timingChanged = startSec !== word.start || endSec !== word.end
    if (trimmed !== word.text || timingChanged) {
      updateWord(word.id, {
        text: trimmed,
        start: startSec,
        end: startSec === null ? null : endSec,
      })
    }
    selectWord(null)
  }

  const inputClass = cn(
    'h-8 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-fg',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
  )

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') selectWord(null)
      }}
      aria-label={t.lyrics.editor.title}
      className="flex shrink-0 flex-col gap-3 border-t border-line bg-raised/60 p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-2xs font-semibold tracking-[0.08em] text-subtle uppercase">
          {t.lyrics.editor.title}
          {word.timingSource && (
            <span className="ml-2 font-normal tracking-normal normal-case">
              · {t.lyrics.sources[word.timingSource]}
              {word.confidence !== null &&
                ` · ${t.lyrics.editor.confidence.toLowerCase()} ${Math.round(word.confidence * 100)}%`}
            </span>
          )}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="-my-1 -mr-2 size-7"
          aria-label={t.lyrics.editor.close}
          title={t.lyrics.editor.close}
          onClick={() => selectWord(null)}
        >
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className="text-xs text-muted">
          {t.lyrics.editor.text}
        </label>
        <input
          id={`${id}-text`}
          className={inputClass}
          value={text}
          autoFocus
          onChange={(event) => setText(event.currentTarget.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TimeField
          id={`${id}-start`}
          label={t.lyrics.editor.start}
          value={start}
          onChange={(value) => {
            setStart(value)
            setError(false)
          }}
          className={inputClass}
        />
        <TimeField
          id={`${id}-end`}
          label={t.lyrics.editor.end}
          value={end}
          onChange={(value) => {
            setEnd(value)
            setError(false)
          }}
          className={inputClass}
        />
      </div>
      {error && (
        <p role="alert" className="-mt-1 text-xs text-danger">
          {t.lyrics.editor.invalidTime}
        </p>
      )}

      <div className="flex items-center gap-1">
        <Button type="submit" variant="primary" size="sm">
          {t.lyrics.editor.save}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title={t.lyrics.editor.play}
          aria-label={t.lyrics.editor.play}
          disabled={word.start === null}
          onClick={() => {
            playback.seek(word.start ?? 0)
            void playback.play()
          }}
        >
          <Play />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title={t.lyrics.editor.delete}
          aria-label={t.lyrics.editor.delete}
          className="ml-auto hover:text-danger"
          onClick={() => removeWord(word.id)}
        >
          <Trash2 />
        </Button>
      </div>
      <WordAccentPicker word={word} />
    </form>
  )
}

function TimeField({
  id,
  label,
  value,
  onChange,
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  className: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className={cn(className, 'tabular pr-8 font-mono text-xs')}
          value={value}
          placeholder={t.lyrics.editor.timeHint}
          inputMode="decimal"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <button
          type="button"
          title={t.lyrics.editor.setNow}
          aria-label={`${label}: ${t.lyrics.editor.setNow}`}
          onClick={() => onChange(formatTimeInput(playback.time))}
          className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-subtle hover:bg-hover hover:text-fg"
        >
          <Clock className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
