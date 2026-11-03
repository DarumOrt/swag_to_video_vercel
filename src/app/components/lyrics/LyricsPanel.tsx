import { ClipboardPaste, FileDown, FileUp, Keyboard, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { flattenWords } from '@/lyrics'
import { Button, cn } from '@/ui'
import { t } from '../../i18n'
import {
  cancelRecognition,
  clearLyrics,
  exportLrc,
  autoSplitGain,
  importLrc,
  splitLongLines,
  realignLyrics,
  requestRecognition,
  setPasteOpen,
  startTapSync,
} from '../../lyricsActions'
import { countWords } from '../../lyricsEdit'
import { useLyricsStore, type LyricsEditorState } from '../../lyricsStore'
import { useAppStore } from '../../store'
import { GridControls } from './GridControls'
import { PasteForm } from './PasteForm'
import { RecognizePrompt } from './RecognizePrompt'
import { TapBar } from './TapBar'
import { WordEditor } from './WordEditor'
import { WordList } from './WordList'

export function LyricsPanel() {
  const ready = useAppStore((state) => state.timeline !== null)
  const lyrics = useAppStore((state) => state.timeline?.lyrics ?? null)
  const trackName = useAppStore((state) => state.track?.name ?? 'lyrics')
  const { recognize, recognized, alignStats, pasteOpen, tap, notice, selectedWordId, prompt } =
    useLyricsStore()
  const lrcInput = useRef<HTMLInputElement>(null)
  const counts = countWords(lyrics)
  const running = recognize.status === 'running'
  const [confirmSplit, setConfirmSplit] = useState(false)
  const splitGain = useMemo(() => (lyrics ? autoSplitGain(lyrics) : 0), [lyrics])
  const selected =
    lyrics && selectedWordId
      ? (flattenWords(lyrics).find((ref) => ref.word.id === selectedWordId)?.word ?? null)
      : null

  function downloadLrc() {
    const text = exportLrc()
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${trackName.replace(/\.[^.]+$/, '')}.lrc`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <aside
      aria-label={t.lyrics.title}
      className="order-2 flex min-h-0 w-full shrink-0 flex-col border-line bg-surface lg:order-none lg:w-[22rem] lg:border-r xl:w-96"
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-2xs font-semibold tracking-[0.08em] text-subtle uppercase">
            {t.lyrics.title}
          </h2>
          <div className="flex items-center">
            <input
              ref={lrcInput}
              type="file"
              accept=".lrc,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) importLrc(await file.text())
              }}
            />
            <IconAction
              label={t.lyrics.importLrc}
              disabled={!ready || !!tap}
              onClick={() => lrcInput.current?.click()}
            >
              <FileUp />
            </IconAction>
            <IconAction
              label={t.lyrics.exportLrc}
              disabled={!counts.timed || !!tap}
              onClick={downloadLrc}
            >
              <FileDown />
            </IconAction>
            <IconAction label={t.lyrics.clear} disabled={!lyrics || !!tap} onClick={clearLyrics}>
              <Trash2 />
            </IconAction>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={lyrics ? 'secondary' : 'primary'}
            disabled={!ready || !!tap || !!prompt}
            title={t.lyrics.recognizeHint}
            onClick={() => (running ? cancelRecognition() : void requestRecognition())}
          >
            <Sparkles aria-hidden />
            {running ? t.lyrics.cancel : recognized ? t.lyrics.recognizeAgain : t.lyrics.recognize}
          </Button>
          <Button size="sm" disabled={!ready || !!tap} onClick={() => setPasteOpen(!pasteOpen)}>
            <ClipboardPaste aria-hidden />
            {t.lyrics.paste}
          </Button>
          <Button
            size="sm"
            disabled={!lyrics || !!tap || pasteOpen}
            title={t.lyrics.tap.startHint}
            onClick={startTapSync}
          >
            <Keyboard aria-hidden />
            {t.lyrics.tap.start}
          </Button>
          {recognized && lyrics && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!!tap}
              title={t.lyrics.realignHint}
              onClick={realignLyrics}
            >
              <Wand2 aria-hidden />
              {t.lyrics.realign}
            </Button>
          )}
        </div>
        <StatusLine
          text={
            running
              ? recognizeStatusText(recognize)
              : recognize.status === 'error'
                ? `${t.lyrics.recognizeError}${recognize.error ? `: ${recognize.error}` : ''}`
                : (notice?.text ??
                  (alignStats
                    ? t.lyrics.anchored(alignStats.anchored, alignStats.total)
                    : lyrics
                      ? t.lyrics.timedCount(counts.timed, counts.total)
                      : null))
          }
          error={recognize.status === 'error' || notice?.kind === 'error'}
        />
        {lyrics && !tap && (
          <div className="flex items-center gap-1.5">
            {confirmSplit ? (
              <>
                <span className="text-xs text-muted">
                  {t.lyrics.lines.autoSplitConfirm(splitGain)}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    splitLongLines()
                    setConfirmSplit(false)
                  }}
                >
                  {t.lyrics.lines.autoSplitDo}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmSplit(false)}>
                  {t.lyrics.lines.autoSplitCancel}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={splitGain === 0 || running}
                title={splitGain === 0 ? t.lyrics.lines.autoSplitNone : undefined}
                onClick={() => setConfirmSplit(true)}
              >
                {t.lyrics.lines.autoSplit}
              </Button>
            )}
          </div>
        )}
        {lyrics && counts.timed > 0 && <GridControls disabled={!!tap || running} />}
      </header>

      {prompt && <RecognizePrompt prompt={prompt} />}
      {running && recognize.note && (
        <p className="border-b border-line bg-warn-soft px-4 py-2 text-xs text-warn">
          {recognize.note}
        </p>
      )}
      {tap && <TapBar session={tap} />}

      {pasteOpen ? (
        <PasteForm />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!ready ? (
            <p className="px-4 py-6 text-xs text-subtle">{t.lyrics.noTrack}</p>
          ) : !lyrics ? (
            <div className="flex flex-col gap-1 px-4 py-6">
              <p className="text-[13px] font-medium">{t.lyrics.emptyTitle}</p>
              <p className="text-xs text-subtle">{t.lyrics.emptyHint}</p>
            </div>
          ) : (
            <>
              {counts.timed === 0 && !tap && (
                <p className="mx-4 mt-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                  {t.lyrics.untimedHint}
                </p>
              )}
              <WordList lyrics={lyrics} />
            </>
          )}
        </div>
      )}

      {selected && !tap && !pasteOpen && <WordEditor key={selected.id} word={selected} />}
    </aside>
  )
}

function recognizeStatusText({ stage, progress }: LyricsEditorState['recognize']): string {
  const percent = Math.round(progress * 100)
  if (stage === 'load') return t.lyrics.stages.load(percent)
  if (stage === 'recognize') return t.lyrics.stages.recognize(percent)
  return t.lyrics.stages.device
}

function StatusLine({ text, error }: { text: string | null; error: boolean }) {
  if (!text) return null
  return (
    <p role="status" className={cn('text-xs', error ? 'text-danger' : 'text-muted')}>
      {text}
    </p>
  )
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
