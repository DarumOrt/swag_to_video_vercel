import { CircleCheck, Download, X } from 'lucide-react'
import { Button, cn } from '@/ui'
import { cancelExport, startExport } from '../actions'
import { formatTime } from '../format'
import { t } from '../i18n'
import { useAppStore } from '../store'

export function ExportPanel() {
  const ready = useAppStore((state) => state.timeline !== null)
  const { status, progress, etaSec, error } = useAppStore((state) => state.export)
  const percent = Math.round(progress * 100)

  return (
    <section
      aria-label={t.export.title}
      className="flex shrink-0 flex-col gap-2.5 border-t border-line bg-surface p-4"
    >
      {status === 'running' ? (
        <>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-fg">{t.export.running(percent)}</span>
            <span className="tabular font-mono text-subtle">
              {etaSec !== null && `${t.export.eta(formatTime(etaSec))} · `}
              {percent}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t.export.title}
            className="h-1.5 overflow-hidden rounded-full bg-line-strong"
          >
            <div
              className="h-full origin-left rounded-full bg-accent transition-transform duration-150 ease-linear"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <Button variant="secondary" onClick={cancelExport}>
            <X aria-hidden />
            {t.export.cancel}
          </Button>
        </>
      ) : (
        <>
          <StatusLine status={status} error={error} />
          <Button
            variant="primary"
            size="lg"
            disabled={!ready}
            onClick={() => void startExport()}
            className="w-full"
          >
            <Download aria-hidden />
            {status === 'done' ? t.export.again : t.export.start}
          </Button>
          {!ready && <p className="text-center text-2xs text-subtle">{t.export.needTrack}</p>}
        </>
      )}
    </section>
  )
}

function StatusLine({ status, error }: { status: string; error: string | null }) {
  if (status === 'done')
    return (
      <p role="status" className="flex items-start gap-2 text-xs text-muted">
        <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-accent" />
        <span>
          <span className="text-fg">{t.export.done}.</span> {t.export.doneSaved}
        </span>
      </p>
    )
  if (status === 'cancelled' || status === 'error')
    return (
      <p role="status" className={cn('text-xs', status === 'error' ? 'text-danger' : 'text-muted')}>
        {status === 'error' ? `${t.export.error}${error ? `: ${error}` : ''}` : t.export.cancelled}
      </p>
    )
  return null
}
