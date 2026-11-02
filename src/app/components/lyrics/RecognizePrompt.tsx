import { Trash2, TriangleAlert } from 'lucide-react'
import { Button, Segmented, cn, type SegmentedOption } from '@/ui'
import {
  MAX_QUALITY_WARNING,
  type DownloadEstimate,
  type RecognizeLanguage,
  type TranscribeQuality,
} from '../../adapters'
import { formatBytes } from '../../format'
import { t } from '../../i18n'
import {
  askClearModelCache,
  confirmClearModelCache,
  confirmRecognition,
  dismissRecognitionPrompt,
  setRecognizeLanguage,
  setRecognizeQuality,
} from '../../lyricsActions'
import { useLyricsStore, type LyricsEditorState } from '../../lyricsStore'

const QUALITY_OPTIONS: SegmentedOption<TranscribeQuality>[] = [
  { value: 'light', label: t.lyrics.prompt.light },
  { value: 'max', label: t.lyrics.prompt.max },
]

const LANGUAGE_OPTIONS: SegmentedOption<RecognizeLanguage>[] = [
  { value: 'auto', label: t.lyrics.prompt.auto },
  { value: 'ru', label: t.lyrics.prompt.ru },
  { value: 'en', label: t.lyrics.prompt.en },
]

function variantStatus(estimate: DownloadEstimate | null | undefined): string {
  if (estimate === undefined) return t.lyrics.prompt.estimating
  if (estimate === null) return t.lyrics.prompt.statusUnknown
  return estimate.toDownloadBytes === 0
    ? t.lyrics.prompt.cachedStatus(formatBytes(estimate.totalBytes))
    : t.lyrics.prompt.downloadStatus(formatBytes(estimate.toDownloadBytes))
}

/** Shown before every recognition: quality, language, cache state of each variant, cache clearing. */
export function RecognizePrompt({ prompt }: { prompt: NonNullable<LyricsEditorState['prompt']> }) {
  const { statuses, quality, language, cacheBytes, confirmClear, clearing, confirmReplace } = prompt
  const redo = useLyricsStore((state) => state.recognized !== null)
  const estimate = statuses?.[quality] ?? null
  const needsDownload = (estimate?.toDownloadBytes ?? 0) > 0
  const origin = useLyricsStore((state) => state.origin)
  const warnings = [quality === 'max' ? MAX_QUALITY_WARNING : null, estimate?.note ?? null].filter(
    (warning): warning is string => Boolean(warning),
  )
  const clearSize = formatBytes(cacheBytes ?? 0)

  return (
    <section
      aria-label={t.lyrics.prompt.title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') dismissRecognitionPrompt()
      }}
      className="flex shrink-0 flex-col gap-3 border-b border-line bg-raised/60 p-4"
    >
      <h3 className="text-[13px] font-medium">{t.lyrics.prompt.title}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Segmented
          label={t.lyrics.prompt.quality}
          value={quality}
          options={QUALITY_OPTIONS}
          onChange={setRecognizeQuality}
        />
        <Segmented
          label={t.lyrics.prompt.language}
          value={language}
          options={LANGUAGE_OPTIONS}
          onChange={setRecognizeLanguage}
        />
      </div>
      <ul className="flex flex-col gap-0.5 text-xs" aria-live="polite">
        {QUALITY_OPTIONS.map((option) => {
          const status = variantStatus(statuses ? statuses[option.value] : undefined)
          return (
            <li
              key={option.value}
              className={cn(
                'flex justify-between gap-2',
                option.value === quality ? 'text-fg' : 'text-muted',
              )}
            >
              <span>{option.label}</span>
              <span>{status}</span>
            </li>
          )
        })}
      </ul>
      {statuses && needsDownload && (
        <p className="text-xs text-muted">
          {t.lyrics.prompt.download(formatBytes(estimate?.toDownloadBytes ?? 0))}
        </p>
      )}
      <p className="text-xs text-muted">{t.lyrics.prompt.local}</p>
      {warnings.map((warning) => (
        <p key={warning} className="flex gap-2 text-xs text-warn">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {warning}
        </p>
      ))}
      {confirmReplace && (
        <p role="alert" className="flex gap-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <b className="font-medium">{t.lyrics.prompt.replaceTitle}.</b>{' '}
            {origin === 'recognized'
              ? t.lyrics.prompt.replaceRecognized
              : t.lyrics.prompt.replaceText}
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!statuses || clearing}
          onClick={confirmRecognition}
        >
          {confirmReplace
            ? t.lyrics.prompt.replaceConfirm
            : needsDownload
              ? t.lyrics.prompt.start
              : redo
                ? t.lyrics.prompt.startAgain
                : t.lyrics.prompt.startCached}
        </Button>
        <Button variant="ghost" size="sm" onClick={dismissRecognitionPrompt}>
          {t.lyrics.cancel}
        </Button>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        {confirmClear ? (
          <>
            <p role="alert" className="text-xs text-muted">
              {t.lyrics.prompt.clearConfirm(clearSize)}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={clearing}
                onClick={() => void confirmClearModelCache()}
              >
                {clearing ? t.lyrics.prompt.clearing : t.lyrics.prompt.clearYes}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={clearing}
                onClick={() => askClearModelCache(false)}
              >
                {t.lyrics.cancel}
              </Button>
            </div>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={!cacheBytes}
            title={cacheBytes === 0 ? t.lyrics.prompt.clearEmpty : undefined}
            onClick={() => askClearModelCache(true)}
          >
            <Trash2 aria-hidden />
            {cacheBytes ? t.lyrics.prompt.clearCacheSize(clearSize) : t.lyrics.prompt.clearCache}
          </Button>
        )}
      </div>
    </section>
  )
}
