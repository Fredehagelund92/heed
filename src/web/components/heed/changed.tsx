import * as React from 'react'
import { cn } from '@/lib/utils'

// A number that changed while you watched: there at once, with a tint that fades over 600ms, so the
// change is seen without a count-up. Shown the first time, it is simply there.

export function Changed({
  value,
  children,
  className,
}: {
  value: string | number | undefined
  children: React.ReactNode
  className?: string
}) {
  const [was, setWas] = React.useState(value)
  const [times, setTimes] = React.useState(0)
  if (was !== value) {
    setWas(value)
    setTimes(times + 1)
  }
  return (
    <span key={times} className={cn('rounded-sm', times > 0 && 'value-changed', className)}>
      {children}
    </span>
  )
}
