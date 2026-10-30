import * as React from 'react'
import { CheckIcon, CopyIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

// A copy says it worked where it was pressed (docs/design/motion.md): the copy icon turns into a
// tick in 90ms, holds it a moment, then turns back. The toast, where there is one, still says it.

/** How long the tick stays after a copy. */
export const COPIED_MS = 1500

/** Copies `text` and returns true until the tick has been shown for COPIED_MS. */
export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef(0)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = React.useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined)
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
  }, [])
  return [copied, copy]
}

/** The copy icon, or the tick once `copied`: one cell, so the button keeps its size. */
export function CopiedIcon({
  copied,
  className,
  ...props
}: { copied: boolean } & React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="copied-icon"
      data-done={copied || undefined}
      className={cn('icon-swap', className)}
      {...props}
    >
      <CopyIcon />
      <CheckIcon />
    </span>
  )
}
