import { ColorField, Select, Slider, Switch, TextField } from '@/ui'
import type { ParamSchema, ParamValue, ParamValues } from '../adapters'

export interface ParamControlsProps {
  schema: readonly ParamSchema[]
  values: ParamValues
  onChange: (key: string, value: ParamValue) => void
  disabled?: boolean
}

/** Form generated from a parameter schema; params with a `group` get a heading. */
export function ParamControls({ schema, values, onChange, disabled }: ParamControlsProps) {
  const groups = new Map<string, ParamSchema[]>()
  for (const param of schema) {
    const key = param.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), param])
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups].map(([group, params]) => (
        <fieldset key={group} className="flex flex-col gap-3" disabled={disabled}>
          {group && (
            <legend className="mb-3 text-2xs font-semibold tracking-[0.08em] text-subtle uppercase">
              {group}
            </legend>
          )}
          {params.map((param) => (
            <ParamControl
              key={param.key}
              param={param}
              value={values[param.key] ?? param.default}
              onChange={(value) => onChange(param.key, value)}
              disabled={disabled}
            />
          ))}
        </fieldset>
      ))}
    </div>
  )
}

function ParamControl({
  param,
  value,
  onChange,
  disabled,
}: {
  param: ParamSchema
  value: ParamValue
  onChange: (value: ParamValue) => void
  disabled?: boolean
}) {
  switch (param.kind) {
    case 'color':
      return (
        <ColorField
          label={param.label}
          value={String(value)}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'range':
      return (
        <Slider
          label={param.label}
          value={Number(value)}
          min={param.min}
          max={param.max}
          step={param.step}
          onChange={onChange}
          format={(v) => (param.step >= 1 ? String(v) : v.toFixed(2))}
          disabled={disabled}
        />
      )
    case 'toggle':
      return (
        <Switch
          label={param.label}
          checked={Boolean(value)}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'select':
      return (
        <Select
          label={param.label}
          value={String(value)}
          options={param.options}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'text':
      return (
        <TextField
          label={param.label}
          value={String(value)}
          placeholder={param.placeholder}
          onChange={onChange}
          disabled={disabled}
        />
      )
  }
}
