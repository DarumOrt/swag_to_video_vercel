import type { GridDivision } from '@/lyrics'
import { Segmented, Slider, Switch } from '@/ui'
import { t } from '../../i18n'
import { setGrid } from '../../lyricsActions'
import { useLyricsStore } from '../../lyricsStore'

const DIVISIONS = ([4, 8, 16] as const).map((value) => ({
  value,
  label: t.lyrics.grid.divisions[value],
}))

/** "Тайминги по сетке BPM": toggle, division, strength and how evenly the vocal sits on the beat. */
export function GridControls({ disabled }: { disabled: boolean }) {
  const grid = useLyricsStore((state) => state.grid)
  const { fit } = grid
  if (!fit) return null
  return (
    <div className="flex flex-col gap-2.5 rounded-md bg-raised/60 px-3 py-2.5">
      <Switch
        label={t.lyrics.grid.title}
        checked={grid.enabled}
        disabled={disabled}
        onChange={(enabled) => setGrid({ enabled })}
      />
      <p className="tabular text-2xs text-subtle">
        {t.lyrics.grid.evenness(Math.round(fit.score * 100))}
      </p>
      {grid.enabled && (
        <>
          <Segmented<GridDivision>
            label={t.lyrics.grid.division}
            value={grid.division}
            options={DIVISIONS}
            disabled={disabled}
            onChange={(division) => setGrid({ division })}
          />
          <Slider
            label={t.lyrics.grid.strength}
            value={grid.strength}
            step={0.05}
            disabled={disabled}
            onChange={(strength) => setGrid({ strength })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      )}
    </div>
  )
}
