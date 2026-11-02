import { useId } from 'react'
import { cn } from './cn'

export interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: TextFieldProps) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={cn(
          'h-8 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-fg',
          'placeholder:text-subtle disabled:opacity-45',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        )}
      />
    </div>
  )
}
