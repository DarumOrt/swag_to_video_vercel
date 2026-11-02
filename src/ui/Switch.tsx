import { useId } from 'react'
import { cn } from './cn'

export interface SwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/** On/off toggle (role="switch") with its label on the left. */
export function Switch({ label, checked, onChange, disabled, className }: SwitchProps) {
  const id = useId()
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ease-out',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'disabled:opacity-45',
          checked ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0.5 left-0.5 size-4 rounded-full bg-fg shadow-sm',
            'transition-transform duration-150 ease-out',
            checked && 'translate-x-4 bg-accent-fg',
          )}
        />
      </button>
    </div>
  )
}
