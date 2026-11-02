import { useId } from 'react'
import { cn } from './cn'

export interface ColorFieldProps {
  label: string
  /** #rrggbb */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

/** Native color picker shown as a swatch plus the hex value. */
export function ColorField({ label, value, onChange, disabled, className }: ColorFieldProps) {
  const id = useId()
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <span className="tabular font-mono text-2xs text-subtle uppercase">{value}</span>
        <span className="relative size-6 overflow-hidden rounded-sm shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
          <span aria-hidden className="absolute inset-0" style={{ background: value }} />
          <input
            id={id}
            type="color"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </span>
      </span>
    </div>
  )
}
