import { useEffect, useRef, useState } from 'react'

/**
 * Follows `value`, but changes at most once per `ms`: the first change goes through at once, a burst
 * (dragging a slider) collapses into the latest value at the end of the window.
 */
export function useThrottled<T>(value: T, ms = 160): T {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
    if (Object.is(value, shown)) return
    const wait = last.current + ms - Date.now()
    if (wait <= 0) {
      last.current = Date.now()
      setShown(value)
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null
        last.current = Date.now()
        setShown(latest.current)
      }, wait)
    }
  }, [value, shown, ms])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return shown
}
