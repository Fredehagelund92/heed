import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CopyState = 'idle' | 'copied' | 'failed'

/** How long "Copied" stays before the button reads Copy again. */
export const COPIED_FOR_MS = 2000

/**
 * An edition number (`2026-10-07.2`) or a version id in the mono face, with a copy button
 * (contract 6.5 and 7.2). After a copy the icon turns into a check and "Copied" shows beside it
 * for two seconds; a polite status region says the same to a screen reader. A blocked clipboard
 * says "Couldn't copy" instead of pretending.
 */
export function EditionLabel({
  label,
  what = 'edition',
  copy = true,
  size = 'md',
  className,
}: {
  label: string
  /** What the text is, for the button's name: "Copy edition 2026-10-07.2". */
  what?: string
  /** False for the text alone, where a copy button would repeat one nearby. */
  copy?: boolean
  /** `lg` is the title of a card or page, such as the live edition. */
  size?: 'md' | 'lg'
  className?: string
}) {
  const [state, setState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), COPIED_FOR_MS)
    return () => window.clearTimeout(timer)
  }, [state])

  async function copyLabel() {
    try {
      await navigator.clipboard.writeText(label)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <span
      data-slot="edition-label"
      data-state={state}
      className={cn('inline-flex max-w-full min-w-0 items-center gap-1 align-middle', className)}
    >
      <span
        className={cn(
          'truncate font-mono tabular-nums',
          size === 'lg' ? 'text-title font-bold' : 'text-dense',
        )}
        translate="no"
      >
        {label}
      </span>
      {copy ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void copyLabel()}
            aria-label={`Copy ${what} ${label}`}
          >
            {state === 'copied' ? <CheckIcon className="text-status-success-icon" /> : <CopyIcon />}
          </Button>
          <span role="status" className="text-caption text-muted-foreground">
            {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : ''}
          </span>
        </>
      ) : null}
    </span>
  )
}
