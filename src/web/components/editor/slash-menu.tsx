import {
  AtSignIcon,
  CodeXmlIcon,
  FootprintsIcon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  TextQuoteIcon,
  type Icon,
} from '@/components/icons'
import { optionId } from '@/components/mentions/mention-list'
import { Kbd } from '@/components/ui/kbd'
import type { SlashItem } from './body-commands'

const glyphs: Record<string, Icon> = {
  steps: FootprintsIcon,
  h2: Heading2Icon,
  h3: Heading3Icon,
  bullets: ListIcon,
  numbers: ListOrderedIcon,
  quote: TextQuoteIcon,
  code: CodeXmlIcon,
  mention: AtSignIcon,
}

const groups = [
  { id: 'kind', heading: 'For this kind' },
  { id: 'blocks', heading: 'Blocks' },
  { id: 'insert', heading: 'Insert' },
] as const

/**
 * The `/` menu of the body editor (contract 9.6): the blocks of the subset, a template for the
 * kind, and a mention. It has the @ list's look and keys: focus stays in the text, which moves
 * the active row with `aria-activedescendant`, so a mouse press here must not take focus away.
 */
export function SlashMenu({
  id,
  items,
  activeId,
  onPick,
  onActivate,
}: {
  id: string
  items: SlashItem[]
  activeId: string | null
  onPick: (item: SlashItem) => void
  onActivate: (id: string) => void
}) {
  return (
    <div
      data-slot="slash-menu"
      onMouseDown={(event) => event.preventDefault()}
      className="z-popover flex w-mention-list max-w-full flex-col overflow-hidden rounded-lg bg-popover text-dense text-popover-foreground shadow-raised ring-1 ring-foreground/10"
    >
      <div id={id} role="listbox" aria-label="Add a block" className="flex flex-col gap-1 p-1">
        {groups.map((group) => {
          const rows = items.filter((item) => item.group === group.id)
          if (rows.length === 0) return null
          return (
            <div
              key={group.id}
              role="group"
              aria-labelledby={`${id}-${group.id}`}
              className="flex flex-col"
            >
              <div
                id={`${id}-${group.id}`}
                role="presentation"
                className="px-2 py-1 text-caption font-bold text-muted-foreground"
              >
                {group.heading}
              </div>
              {rows.map((item) => {
                const Glyph = glyphs[item.id] ?? AtSignIcon
                const active = activeId === item.id
                return (
                  <div
                    key={item.id}
                    id={optionId(id, item.id)}
                    role="option"
                    aria-selected={active}
                    data-active={active || undefined}
                    onClick={() => onPick(item)}
                    onMouseMove={() => {
                      if (!active) onActivate(item.id)
                    }}
                    className="flex min-h-control-md cursor-default items-center gap-2 rounded-md px-2 py-1 pointer-coarse:min-h-control-touch data-active:bg-muted"
                  >
                    <Glyph aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? (
                      item.group === 'kind' ? (
                        <span className="shrink-0 text-caption text-muted-foreground">
                          {item.hint}
                        </span>
                      ) : (
                        <Kbd aria-hidden="true">{item.hint}</Kbd>
                      )
                    ) : item.group === 'insert' ? (
                      <span className="shrink-0 truncate text-caption text-muted-foreground">
                        A metric, market, fact or domain
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <div
        aria-hidden="true"
        className="flex items-center justify-end gap-1 border-t border-border px-2 py-1 text-caption text-muted-foreground pointer-coarse:hidden"
      >
        <Kbd>↑↓</Kbd>
        <span>move</span>
        <Kbd>↵</Kbd>
        <span>pick</span>
        <Kbd>esc</Kbd>
        <span>close</span>
      </div>
    </div>
  )
}
