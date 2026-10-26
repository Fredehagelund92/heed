import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { SHORTCUTS, type Keys } from '@/lib/help-content'
import { onOpen } from '@/lib/events'
import { isTyping } from '@/lib/keys'

function Combo({ row }: { row: Keys }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {row.keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      {row.or && (
        <>
          <span className="text-xs text-muted-foreground">or</span>
          {row.or.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </>
      )}
    </span>
  )
}

/** The shortcut sheet, opened with ? from anywhere nobody is typing. Short on purpose: only keys the app really has. */
export function ShortcutsDialog() {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => onOpen('shortcuts', () => setOpen(true)), [])
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      e.preventDefault()
      setOpen((o) => !o)
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl" data-testid="shortcuts">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single keys work when you are not typing. On Windows, use Ctrl for ⌘ and Alt for ⌥.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-px bg-border sm:grid-cols-2">
          {SHORTCUTS.map((g) => (
            <section key={g.group} className="bg-background px-5 py-4">
              <h3 className="mb-2 text-sm font-medium">{g.group}</h3>
              <ul className="flex flex-col">
                {g.rows.map((r) => (
                  <li
                    key={r.label}
                    className="flex items-center justify-between gap-4 border-t py-2 text-sm first:border-t-0"
                  >
                    <span className="min-w-0 text-muted-foreground">{r.label}</span>
                    <Combo row={r} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
