import * as React from 'react'
import type { Editor } from '@tiptap/react'
import { cn } from '@/lib/utils'
import {
  Command,
  CommandFooter,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'

// The one list a text box offers while typing: shadcn's Command list under the caret (a bottom sheet
// on a phone), in groups, filtered as you type. '@' lists what can be mentioned; ':' and two letters
// list emoji. One popover and one keyboard model for both: the keys stay in the text box, arrows
// move, Enter or Tab adds, Esc closes. The box tells screen readers about the list (aria-controls and
// the active option, which a text box may carry).

export type SuggestItem = {
  id: string
  /** What the row shows. */
  label: string
  hint?: string
  icon: React.ReactNode
}
export type SuggestGroup = { label: string; items: SuggestItem[] }
export type SuggestHandle = { onKeyDown: (e: KeyboardEvent) => boolean }

export const SuggestList = React.forwardRef<
  SuggestHandle,
  {
    /** The list's name for screen readers: "Mention", "Emoji". */
    label: string
    query: string
    groups: SuggestGroup[]
    editor: Editor
    onPick: (item: SuggestItem) => void
    /** Words that match nothing and hold a space are a sentence, not a search: the list steps aside. */
    exit: () => void
    empty: { title: React.ReactNode; line: string }
    className?: string
  }
>(function SuggestList({ label, query, groups, editor, onPick, exit, empty, className }, ref) {
  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups])
  // The active row resets to the first whenever the words change.
  const [sel, setSel] = React.useState({ query, index: 0 })
  const index = sel.query === query ? Math.min(sel.index, Math.max(0, flat.length - 1)) : 0
  const active = flat[index]
  const list = React.useRef<HTMLDivElement>(null)

  React.useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!flat.length) return true
        const step = e.key === 'ArrowDown' ? 1 : -1
        setSel({ query, index: (index + step + flat.length) % flat.length })
        return true
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && active) {
        onPick(active)
        return true
      }
      return false
    },
  }))

  const sentence = !flat.length && /\s/.test(query.trim())
  React.useEffect(() => {
    if (sentence) exit()
  }, [sentence, exit])

  // The text box keeps focus, so it names the list and the active option for screen readers.
  React.useEffect(() => {
    const dom = editor.view.dom
    const option =
      active &&
      list.current?.querySelector<HTMLElement>(`[data-suggest="${CSS.escape(active.id)}"]`)
    option?.scrollIntoView({ block: 'nearest' })
    if (list.current?.id) dom.setAttribute('aria-controls', list.current.id)
    dom.setAttribute('aria-autocomplete', 'list')
    if (option?.id) dom.setAttribute('aria-activedescendant', option.id)
    else dom.removeAttribute('aria-activedescendant')
  }, [active, editor])
  React.useEffect(() => {
    const dom = editor.view.dom
    return () =>
      ['aria-controls', 'aria-autocomplete', 'aria-activedescendant'].forEach((a) =>
        dom.removeAttribute(a),
      )
  }, [editor])

  return (
    <Command
      shouldFilter={false}
      value={active?.id ?? ''}
      loop
      label={label}
      // Keeps the caret in the box when a row is clicked.
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'rounded-lg! border bg-popover p-0 shadow-md',
        'animate-in duration-(--dur-2) fade-in-0 slide-in-from-top-1',
        'max-sm:rounded-b-none! max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-safe-area max-sm:shadow-sheet-up max-sm:slide-in-from-bottom-4 sm:w-104',
        className,
      )}
    >
      <CommandList
        ref={list}
        label={label}
        className="max-h-72 p-1 max-sm:max-h-bottom-sheet-phone"
      >
        {flat.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm">
            <p className="font-medium">{empty.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{empty.line}</p>
          </div>
        ) : (
          groups.map((g) => (
            <CommandGroup key={g.label} heading={g.label} className="px-1 py-1">
              {g.items.map((m) => (
                <CommandItem
                  key={`${g.label}-${m.id}`}
                  value={m.id}
                  data-suggest={m.id}
                  onSelect={() => onPick(m)}
                  className="min-h-9 gap-2.5 py-1.5 *:[svg:last-child]:hidden"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">{m.icon}</span>
                  <span className="min-w-0 flex-1 truncate" title={m.label}>
                    {m.label}
                  </span>
                  {m.hint && (
                    <span className="max-w-2/5 shrink-0 truncate text-xs text-muted-foreground">
                      {m.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))
        )}
      </CommandList>
      <CommandFooter className="h-9 gap-3 px-3">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
        </span>
        <span>
          <Kbd>Enter</Kbd> to add
        </span>
        <span>
          <Kbd>Esc</Kbd> to close
        </span>
      </CommandFooter>
    </Command>
  )
})
