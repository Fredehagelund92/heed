import type { ScopeHit } from '@/api'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  SigmaIcon,
  SplitIcon,
  TagIcon,
} from '@/components/icons'
import { optionId } from '@/components/mentions/mention-list'
import { Kbd } from '@/components/ui/kbd'
import { anyValueWords } from '@/lib/library-core'
import { cn } from '@/lib/utils'

/*
  The list under "Where it applies": metrics, then per dimension a heading with how many values
  match ("Campaign, 240 matches"), the dimension itself as "Any value", a few values and a row to
  search all of them. Inside one dimension it shows a page of values with rows to the next and the
  previous page. Rows are options of one listbox; focus stays in the field, which moves the active
  row with `aria-activedescendant`, so a mouse press here never takes focus away. It never
  scrolls: a page is short, and typing narrows it.
*/

export type ScopeRow =
  | { id: string; type: 'term'; hit: ScopeHit }
  | { id: string; type: 'within'; dimension: ScopeHit; count: number }
  | { id: string; type: 'page'; direction: 'next' | 'previous'; cursor: string }
  | { id: string; type: 'request'; words: string }

export type ScopeSection = {
  id: string
  /** The words of the heading; none for the metrics of a dimension page. */
  heading: string
  /** A quiet count beside the heading: "12 values", "240 matches". */
  count?: string
  rows: ScopeRow[]
}

/** The typed words in bold where they start a word, as the search matches them. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return text
  const words = text.split(/(\s+)/)
  return words.map((word, index) => {
    const lower = word.toLocaleLowerCase('en')
    const part = parts.find((candidate) => lower.startsWith(candidate))
    if (!part) return word
    return (
      <span key={index}>
        <b className="font-bold">{word.slice(0, part.length)}</b>
        {word.slice(part.length)}
      </span>
    )
  })
}

function RowMark({ row }: { row: ScopeRow }) {
  const Glyph =
    row.type === 'page'
      ? row.direction === 'next'
        ? ChevronRightIcon
        : ChevronLeftIcon
      : row.type === 'within'
        ? ChevronRightIcon
        : row.type === 'request'
          ? MessageSquareIcon
          : row.hit.kind === 'metric'
            ? SigmaIcon
            : row.hit.kind === 'dimension'
              ? SplitIcon
              : TagIcon
  return <Glyph aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
}

function RowWords({ row, query }: { row: ScopeRow; query: string }) {
  if (row.type === 'term') {
    if (row.hit.kind === 'dimension')
      return (
        <>
          <span className="min-w-0 flex-1 truncate">{anyValueWords(row.hit.name)}</span>
          <span className="shrink-0 text-caption text-muted-foreground">
            {row.hit.recent ? 'Recent' : null}
          </span>
        </>
      )
    return (
      <>
        <span className="min-w-0 flex-1 truncate">
          <Highlighted text={row.hit.name} query={row.hit.alias ? '' : query} />
        </span>
        <span className="max-w-1/2 shrink-0 truncate text-caption text-muted-foreground">
          {row.hit.alias
            ? `also called ${row.hit.alias}`
            : row.hit.recent
              ? 'Recent'
              : row.hit.uses > 0
                ? `${row.hit.uses.toLocaleString('en')} ${row.hit.uses === 1 ? 'fact' : 'facts'}`
                : null}
        </span>
      </>
    )
  }
  const words =
    row.type === 'within'
      ? `Search all ${row.count.toLocaleString('en')} in ${row.dimension.name}`
      : row.type === 'page'
        ? row.direction === 'next'
          ? 'Next page'
          : 'Previous page'
        : `Ask an owner to add “${row.words}”`
  return <span className="min-w-0 flex-1 truncate">{words}</span>
}

export function ScopeList({
  id,
  label,
  sections,
  query,
  activeId,
  empty,
  onPick,
  onActivate,
}: {
  id: string
  label: string
  sections: ScopeSection[]
  query: string
  activeId: string | null
  /** What an empty list says. */
  empty: string
  onPick: (row: ScopeRow) => void
  onActivate: (id: string) => void
}) {
  const rows = sections.flatMap((section) => section.rows)
  return (
    <div
      data-slot="scope-list"
      onMouseDown={(event) => event.preventDefault()}
      className="z-popover flex w-mention-list max-w-full flex-col overflow-hidden rounded-lg bg-popover text-dense text-popover-foreground shadow-raised ring-1 ring-foreground/10"
    >
      <div id={id} role="listbox" aria-label={label} className="flex flex-col gap-1 p-1">
        {rows.length === 0 ? (
          // A listbox holds options only: the message is one that cannot be chosen.
          <div
            role="option"
            aria-disabled="true"
            aria-selected={false}
            className="px-2 py-2 text-muted-foreground"
          >
            {empty}
          </div>
        ) : null}
        {sections
          .filter((section) => section.rows.length > 0)
          .map((section) => (
            <div
              key={section.id}
              role="group"
              aria-label={section.count ? `${section.heading}, ${section.count}` : section.heading}
              className="flex flex-col"
            >
              <div
                aria-hidden="true"
                className="flex items-baseline gap-2 px-2 py-1 text-caption text-muted-foreground"
              >
                <span className="font-bold">{section.heading}</span>
                {section.count ? <span>{section.count}</span> : null}
              </div>
              {section.rows.map((row) => {
                const active = activeId === row.id
                return (
                  <div
                    key={row.id}
                    id={optionId(id, row.id)}
                    role="option"
                    aria-selected={active}
                    data-active={active || undefined}
                    data-row={row.type}
                    onClick={() => onPick(row)}
                    onMouseMove={() => {
                      if (!active) onActivate(row.id)
                    }}
                    className={cn(
                      'flex min-h-control-md cursor-default items-center gap-2 rounded-md px-2 py-1 pointer-coarse:min-h-control-touch data-active:bg-muted',
                      row.type !== 'term' && 'text-muted-foreground data-active:text-foreground',
                    )}
                  >
                    <RowMark row={row} />
                    <RowWords row={row} query={query} />
                  </div>
                )
              })}
            </div>
          ))}
      </div>
      {rows.length > 0 ? (
        <div
          aria-hidden="true"
          className="flex items-center justify-end gap-1 border-t border-border px-2 py-1 text-caption text-muted-foreground pointer-coarse:hidden"
        >
          <Kbd>↑↓</Kbd>
          <span>move</span>
          <Kbd>→</Kbd>
          <span>open</span>
          <Kbd>↵</Kbd>
          <span>pick</span>
          <Kbd>esc</Kbd>
          <span>close</span>
        </div>
      ) : null}
    </div>
  )
}
