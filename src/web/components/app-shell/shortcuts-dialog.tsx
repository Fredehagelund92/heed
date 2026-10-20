import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { commands, formatHotkey } from '@/lib/commands'

/** Sections of the sheet, by command scope, in the order a person meets them. */
const sections = [
  { title: 'Anywhere', scope: 'global' },
  { title: 'In the library list', scope: 'list' },
  { title: 'On a fact', scope: 'document' },
  { title: 'On a record page', scope: 'record' },
] as const

function Keys({ hotkey }: { hotkey: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
      {formatHotkey(hotkey).map((key, index) =>
        key === 'then' ? (
          <span key={index}>then</span>
        ) : (
          <Kbd key={index} className="font-mono tabular-nums">
            {key}
          </Kbd>
        ),
      )}
    </span>
  )
}

/**
 * The keyboard shortcut sheet (contract 9.1, `?`). It reads the command registry, so it always
 * shows what is really bound. Movement keys that share a meaning are listed once.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-dialog-wide gap-6 p-6">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work anywhere except while you type in a field.
          </DialogDescription>
        </DialogHeader>
        <div className="@container grid max-h-popover grid-cols-1 gap-6 overflow-y-auto @lg:grid-cols-2">
          {sections.map((section) => {
            const seen = new Set<string>()
            const rows = commands.filter((command) => {
              if (command.scope !== section.scope || !command.hotkey) return false
              const key = command.title
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
            return (
              <section key={section.scope} className="flex flex-col gap-2">
                <h3 className="text-caption font-bold text-muted-foreground">{section.title}</h3>
                <ul className="flex flex-col">
                  {rows.map((command) => (
                    <li
                      key={command.id}
                      className="flex h-control-md items-center justify-between gap-4 text-dense"
                    >
                      <span className="truncate">{command.title}</span>
                      {command.hotkey ? <Keys hotkey={command.hotkey} /> : null}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
