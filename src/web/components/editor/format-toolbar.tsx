import { useState, type KeyboardEvent, type RefObject } from 'react'
import {
  AtSignIcon,
  BoldIcon,
  CheckIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  UnlinkIcon,
  type Icon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { inputVariants } from '@/components/ui/input-variants'
import { formatHotkey } from '@/lib/commands'
import { safeHref } from '@/lib/markdown'
import { cn } from '@/lib/utils'

export type FormatAction = 'bold' | 'italic' | 'code' | 'h2' | 'h3' | 'mention'

type Tool = { id: FormatAction; label: string; icon: Icon; hotkey?: string }

const marks: Tool[] = [
  { id: 'bold', label: 'Bold', icon: BoldIcon, hotkey: 'mod+b' },
  { id: 'italic', label: 'Italic', icon: ItalicIcon, hotkey: 'mod+i' },
  { id: 'code', label: 'Code', icon: CodeIcon, hotkey: 'mod+e' },
]
const blocks: Tool[] = [
  { id: 'h2', label: 'Heading 2', icon: Heading2Icon, hotkey: 'mod+alt+2' },
  { id: 'h3', label: 'Heading 3', icon: Heading3Icon, hotkey: 'mod+alt+3' },
]

/**
 * The selection toolbar of the body editor (contract 9.6): bold, italic, code and a link for the
 * selected words, heading 2 or 3 for their block, and a mention made from them. It never takes
 * focus from the text on a click, so the selection stays; Alt F10 moves focus into it, the arrows
 * move between buttons and Escape goes back to the text.
 */
export function FormatToolbar({
  pressed,
  available,
  link,
  onAction,
  onLink,
  onReturn,
  toolbarRef,
}: {
  pressed: Partial<Record<FormatAction | 'link', boolean>>
  /** Actions that apply where the selection is; the others are left out. */
  available: Partial<Record<FormatAction, boolean>>
  /** The link the selection has, if any. */
  link: string | null
  onAction: (action: FormatAction) => void
  /** A checked address to link the words to, or null to remove the link. */
  onLink: (href: string | null) => void
  /** Gives focus back to the text. */
  onReturn: () => void
  toolbarRef: RefObject<HTMLDivElement | null>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(false)
  const roving = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (editing) setEditing(false)
      else onReturn()
      return
    }
    if (editing || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = [...(toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    buttons[next]?.focus()
  }
  const tool = ({ id, label, icon: Glyph, hotkey }: Tool) =>
    available[id] === false ? null : (
      <Button
        key={id}
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={label}
        aria-pressed={pressed[id] ?? false}
        title={hotkey ? `${label} (${formatHotkey(hotkey).join(' ')})` : label}
        tabIndex={-1}
        data-tool={id}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onAction(id)}
      >
        <Glyph aria-hidden="true" />
      </Button>
    )
  const save = () => {
    const href = safeHref(draft)
    if (!href) {
      setError(true)
      return
    }
    onLink(href)
    setEditing(false)
  }
  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Format the selected words"
      data-slot="format-toolbar"
      onKeyDown={roving}
      className="z-popover flex w-fit max-w-full items-center gap-1 rounded-lg bg-popover p-1 text-popover-foreground shadow-raised ring-1 ring-foreground/10"
    >
      {editing ? (
        // Not a form: the toolbar sits inside the page's form, and forms do not nest.
        <div className="flex max-w-popover flex-wrap items-center gap-1">
          {/* A native input with the Input look: it sits in no Field, so it needs none of Base
              UI's field wiring, which would also split shared chunks into the first load. */}
          <input
            type="url"
            autoFocus
            aria-label="Link address"
            aria-invalid={error || undefined}
            aria-describedby={error ? 'format-link-error' : undefined}
            placeholder="https://"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(false)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              event.stopPropagation()
              save()
            }}
            className={cn(inputVariants(), 'min-w-0 flex-1')}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Link the words"
            onClick={save}
          >
            <CheckIcon aria-hidden="true" />
          </Button>
          {error ? (
            <p id="format-link-error" className="w-full px-1 text-caption text-status-danger-fg">
              Use a full https, http or mailto address.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {marks.map(tool)}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={link ? 'Remove the link' : 'Link'}
            aria-pressed={Boolean(link)}
            title={link ? `Remove the link to ${link}` : 'Link'}
            tabIndex={-1}
            data-tool="link"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (link) onLink(null)
              else {
                setDraft('')
                setError(false)
                setEditing(true)
              }
            }}
          >
            {link ? <UnlinkIcon aria-hidden="true" /> : <LinkIcon aria-hidden="true" />}
          </Button>
          {available.h2 === false && available.h3 === false ? null : (
            <span role="separator" aria-orientation="vertical" className="h-4 w-px bg-border" />
          )}
          {blocks.map(tool)}
          {available.mention === false ? null : (
            <>
              <span role="separator" aria-orientation="vertical" className="h-4 w-px bg-border" />
              {tool({ id: 'mention', label: 'Mention these words', icon: AtSignIcon })}
            </>
          )}
        </>
      )}
    </div>
  )
}
