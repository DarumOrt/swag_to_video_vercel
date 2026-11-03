import { Check } from 'lucide-react'
import { Dices } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createFakeTimeline } from '@/render'
import { type Timeline } from '@/shared'
import { Button, Slider, cn } from '@/ui'
import {
  STYLE_PRESETS,
  buildScene,
  createRenderer,
  presetDefaults,
  type StylePreset,
} from '../adapters'
import { t } from '../i18n'
import { useAppStore } from '../store'
import { useThrottled } from '../useThrottled'
import { ParamControls } from './ParamControls'

export function StylePanel() {
  const style = useAppStore((state) => state.style)
  const setPreset = useAppStore((state) => state.setPreset)
  const setStyleValue = useAppStore((state) => state.setStyleValue)
  const locked = useAppStore((state) => state.export.status === 'running')
  const preset = STYLE_PRESETS.find((p) => p.id === style.presetId) ?? STYLE_PRESETS[0]!

  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      <div role="radiogroup" aria-label={t.style.presets} className="grid grid-cols-2 gap-2">
        {STYLE_PRESETS.map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            selected={p.id === style.presetId}
            disabled={locked}
            onSelect={() => setPreset(p.id)}
          />
        ))}
      </div>
      <p className="-mt-2 text-xs text-subtle">{preset.description}</p>
      <DirectorControls schema={preset.params} locked={locked} />
      <ParamControls
        schema={preset.params}
        values={style.values}
        onChange={setStyleValue}
        disabled={locked}
      />
    </div>
  )
}

/** Seed ("Перемешать") and the director's knobs. Only for scenes that have a director. */
function DirectorControls({
  schema,
  locked,
}: {
  schema: readonly { key: string }[]
  locked: boolean
}) {
  const director = useAppStore((state) => state.scene.director)
  const seed = useAppStore((state) => state.style.seed)
  const shuffleSeed = useAppStore((state) => state.shuffleSeed)
  const setDirector = useAppStore((state) => state.setDirector)
  if (!director) return null
  // A preset that already has "Энергия" / "Хаос" in its own form feeds them to the director itself.
  const own = new Set(schema.map((param) => param.key))
  const knobs = [
    { key: 'energy', label: t.style.energy, value: director.energy },
    { key: 'chaos', label: t.style.chaos, value: director.chaos },
    { key: 'randomness', label: t.style.randomness, value: director.randomness },
  ].filter((knob) => !own.has(knob.key))
  return (
    <fieldset className="flex flex-col gap-3" disabled={locked}>
      <legend className="mb-3 text-2xs font-semibold tracking-[0.08em] text-subtle uppercase">
        {t.style.director}
      </legend>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" title={t.style.shuffleHint} onClick={shuffleSeed}>
          <Dices aria-hidden />
          {t.style.shuffle}
        </Button>
        <span className="tabular font-mono text-2xs text-subtle">{t.style.seed(seed)}</span>
      </div>
      {knobs.map((knob) => (
        <Slider
          key={knob.key}
          label={knob.label}
          value={knob.value}
          step={0.05}
          onChange={(value) => setDirector({ [knob.key]: value })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      ))}
    </fieldset>
  )
}

function PresetCard({
  preset,
  selected,
  disabled,
  onSelect,
}: {
  preset: StylePreset
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'group flex flex-col gap-1.5 rounded-md p-1.5 text-left transition-[background-color,transform] duration-150 ease-out',
        'hover:bg-hover active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:opacity-45',
        selected && 'bg-raised',
      )}
    >
      <span
        className={cn(
          'relative block aspect-[4/5] overflow-hidden rounded-sm bg-black',
          'shadow-[inset_0_0_0_1px_var(--color-line)]',
          selected && 'shadow-[0_0_0_2px_var(--color-accent)]',
        )}
      >
        <Thumbnail presetId={preset.id} selected={selected} />
        {selected && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-accent-fg">
            <Check className="size-3" strokeWidth={3} aria-hidden />
          </span>
        )}
      </span>
      <span className="px-0.5 text-xs font-medium">{preset.name}</span>
    </button>
  )
}

let fakeTimeline: Timeline | null = null

/** One frame of the current track (or a synthetic one) in the preset's look. */
function Thumbnail({ presetId, selected }: { presetId: string; selected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The selected card shows the user's tweaks; the others show preset defaults.
  const liveScene = useThrottled(useAppStore((state) => (selected ? state.scene : null)))
  const timeline = useAppStore((state) => state.timeline)
  const output = useAppStore((state) => state.output)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    fakeTimeline ??= createFakeTimeline({ durationSec: 8 })
    const source = timeline ?? fakeTimeline
    const fps = output.fps
    const width = 160
    const height = Math.round((width * output.height) / output.width)
    const renderer = createRenderer()
    let disposed = false
    void renderer
      .init({
        canvas,
        width,
        height,
        fps,
        timeline: source,
        scene: liveScene ?? buildScene(presetId, presetDefaults(presetId)),
      })
      .then(() => {
        if (!disposed) renderer.renderFrame(Math.floor(loudestTime(source) * fps))
      })
      .catch(() => {})
    return () => {
      disposed = true
      renderer.dispose()
    }
  }, [presetId, liveScene, timeline, output.width, output.height, output.fps])

  return <canvas ref={canvasRef} className="absolute inset-0 m-auto max-h-full max-w-full" />
}

/** A representative moment: the loudest frame in the middle part of the track. */
function loudestTime(timeline: Timeline): number {
  const { rms, rate, frameCount } = timeline.audio.features
  let best = Math.floor(frameCount / 2)
  for (let i = Math.floor(frameCount * 0.2); i < frameCount * 0.8; i++) {
    if ((rms[i] ?? 0) > (rms[best] ?? 0)) best = i
  }
  return best / rate
}
