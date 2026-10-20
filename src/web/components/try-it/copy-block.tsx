import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon } from '@/components/icons'
import { COPIED_FOR_MS } from '@/components/proposal/edition-label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Copying a text: `copied` for two seconds after a copy, `failed` when the clipboard is blocked,
 * so a button never pretends. `copy` resolves whether it worked.
 */
export function useCopy(text: string) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), COPIED_FOR_MS)
    return () => window.clearTimeout(timer)
  }, [state])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
      return true
    } catch {
      setState('failed')
      return false
    }
  }
  return { state, copy }
}

/**
 * Text to copy word for word, such as a command or the instructions an agent is told: the text
 * in the mono face in a quiet box, and a copy button in its corner. After a copy the icon turns
 * into a check for two seconds and a polite status says "Copied"; a blocked clipboard says "Copy
 * failed" instead of pretending. A long text scrolls, and the keyboard reaches it.
 */
export function CopyBlock({
  text,
  label,
  className,
}: {
  text: string
  /** What the text is, for the block's and the button's names: "the command for Claude Code". */
  label: string
  className?: string
}) {
  const { state, copy } = useCopy(text)
  return (
    <div data-slot="copy-block" data-state={state} className={cn('relative min-w-0', className)}>
      <pre
        tabIndex={0}
        aria-label={label}
        className="max-h-chart overflow-auto rounded-md border bg-muted py-2 pr-12 pl-3 font-mono text-caption break-words whitespace-pre-wrap focus-visible:outline-2 focus-visible:outline-ring"
      >
        {text}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        className="absolute top-1 right-1"
      >
        {state === 'copied' ? <CheckIcon className="text-status-success-icon" /> : <CopyIcon />}
      </Button>
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </div>
  )
}
