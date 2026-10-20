import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  HeedDomainIcon,
  MessageSquareIcon,
  SigmaIcon,
  SplitIcon,
  TagIcon,
  type Icon,
} from '@/components/icons'
import { kindGlyphs } from '@/components/item/item-marks'
import { PreviewBody } from '@/components/preview/preview-card'
import { HoverCard, HoverCardContent } from '@/components/ui/hover-card'
import { Kbd } from '@/components/ui/kbd'
import { useMediaQuery } from '@/hooks/use-media-query'
import { mentionGroups, type MentionMatch, type MentionOption } from '@/lib/mention-targets'
import { previewTargetOf, type PreviewTarget } from '@/lib/preview'
import { cn } from '@/lib/utils'

/** The id of the last row, which asks an owner to add a term the list does not have. */
export const REQUEST_ROW = 'request'

/** The mark before a name: the glyph a chip of that target carries, a domain's mark included. */
export function TargetMark({ option }: { option: MentionOption }) {
  if (option.type === 'area')
    return (
      <span
        aria-hidden="true"
        data-tone={option.label ?? 'neutral'}
        className="flex size-4 shrink-0 items-center justify-center"
      >
        <HeedDomainIcon className="size-4 text-tone-dot" />
      </span>
    )
  const Glyph =
    option.type === 'item'
      ? kindGlyphs[option.kind ?? 'note']
      : option.type === 'metric'
        ? SigmaIcon
        : option.type === 'dim'
          ? SplitIcon
          : TagIcon
  return (
    <Glyph
      aria-hidden="true"
      data-kind={option.type === 'item' ? (option.kind ?? 'note') : undefined}
      className="size-4 shrink-0 text-muted-foreground"
    />
  )
}

/** The name with the typed words shown in bold where they start a word, as the list matches. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = query.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return text
  const lower = text.toLocaleLowerCase('en')
  const marks: [number, number][] = []
  for (const part of parts) {
    const needle = part.toLocaleLowerCase('en')
    let from = 0
    for (;;) {
      const at = lower.indexOf(needle, from)
      if (at < 0) break
      if (at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1] ?? '')) {
        marks.push([at, at + needle.length])
        break
      }
      from = at + 1
    }
  }
  if (marks.length === 0) return text
  marks.sort((a, b) => a[0] - b[0])
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of marks) {
    if (start < cursor) continue
    if (start > cursor) nodes.push(text.slice(cursor, start))
    nodes.push(
      <b key={start} className="font-bold">
        {text.slice(start, end)}
      </b>,
    )
    cursor = end
  }
  nodes.push(text.slice(cursor))
  return nodes
}

/**
 * Places a list under a point in its field (the @ or the caret): it spans the field, and the list
 * moves right to the point but never past the field's right edge, so it never makes the page
 * scroll sideways. Without a point it opens under the field's left edge. With `side="top"` it
 * opens above the point instead (`bottom` is the point's distance from the field's bottom), for a
 * field at the bottom of the screen such as the assistant's composer.
 */
export function ListAnchor({
  point,
  side = 'bottom',
  children,
}: {
  point: { left: number; top?: number; bottom?: number } | null
  side?: 'top' | 'bottom'
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(0)
  useLayoutEffect(() => {
    const anchor = ref.current
    const list = anchor?.firstElementChild
    if (!anchor || !(list instanceof HTMLElement) || !point) return setLeft(0)
    setLeft(Math.max(0, Math.min(point.left, anchor.clientWidth - list.offsetWidth)))
  }, [point])
  return (
    <div
      ref={ref}
      className={cn('absolute inset-x-0 z-popover', side === 'top' ? 'pb-1' : 'pt-1')}
      style={side === 'top' ? { bottom: point?.bottom ?? '100%' } : { top: point?.top ?? '100%' }}
    >
      <div className="relative w-fit max-w-full" style={{ left }}>
        {children}
      </div>
    </div>
  )
}

export function optionId(listId: string, key: string) {
  return `${listId}-${key.replace(/[^a-z0-9_-]/gi, '-')}`
}

/** Where the peek fits beside the list: a wide window and a pointer that can hover. */
const PEEK_BESIDE = '(min-width: 48rem) and (pointer: fine)'

/**
 * The peek (the editor design, section 6): the preview of the highlighted row, so four items
 * called "Orders excludes test accounts" in four domains can be told apart before one is
 * picked. Beside the list where there is room, inside it under the rows on a phone. Focus stays
 * in the field, so the peek has no actions and is hidden from screen readers: the row already
 * says its name and what it is.
 */
function Peek({
  preview,
  beside,
  anchor,
}: {
  preview: PreviewTarget
  beside: boolean
  anchor: RefObject<HTMLDivElement | null>
}) {
  const body = (
    <>
      <p className="text-caption text-muted-foreground">Highlighted</p>
      <PreviewBody key={JSON.stringify(preview)} target={preview} variant="peek" />
    </>
  )
  if (!beside)
    return (
      <div
        aria-hidden="true"
        data-slot="mention-peek"
        className="flex flex-col gap-2 border-t border-border p-3"
      >
        {body}
      </div>
    )
  return (
    <HoverCard open>
      <HoverCardContent
        anchor={anchor}
        side="right"
        align="start"
        sideOffset={8}
        aria-hidden="true"
        data-slot="mention-peek"
        onMouseDown={(event) => event.preventDefault()}
      >
        {body}
      </HoverCardContent>
    </HoverCard>
  )
}

/** The most rows a list shows: it never scrolls, so a longer query is how to reach the rest. */
export const LIST_ROWS = 8

/**
 * The list under a chip input: one listbox grouped by type, with the typed words in bold, the
 * other name that matched ("also called Norge"), a quiet line of what each thing is, and a
 * last row that asks an owner to add a missing term. Focus stays in the field, which moves the
 * active row with `aria-activedescendant`, so a mouse press here must not take focus away.
 */
export function MentionList({
  id,
  label,
  matches,
  query,
  activeKey,
  onPick,
  onActivate,
  request,
  empty = 'No match. An owner can add it.',
  hint = true,
  peek = true,
  className,
}: {
  id: string
  /** The accessible name of the listbox, such as "Mention a metric, value, fact or domain". */
  label: string
  matches: MentionMatch[]
  query: string
  activeKey: string | null
  onPick: (option: MentionOption) => void
  onActivate: (key: string) => void
  /** The words of the last row, what it does and its glyph (a message by default), or null for no row. */
  request: { label: string; onRequest: () => void; icon?: Icon } | null
  empty?: string
  /** Shows the keys that drive the list, beside the request row. */
  hint?: boolean
  /** Previews the highlighted row beside the list, or under the rows on a phone. */
  peek?: boolean
  className?: string
}) {
  const groups = mentionGroups
    .map((group) => {
      const rows = matches.filter((match) => match.option.type === group.type)
      // Values of one dimension are headed by it ("Market"), so the rows need not repeat it.
      const dimension =
        group.type === 'val' && rows.every((row) => row.option.detail === rows[0]?.option.detail)
          ? rows[0]?.option.detail
          : undefined
      return { ...group, rows, heading: dimension ?? group.heading, quiet: Boolean(dimension) }
    })
    .filter((group) => group.rows.length > 0)
  const listRef = useRef<HTMLDivElement>(null)
  const beside = useMediaQuery(PEEK_BESIDE)
  const active = activeKey ? matches.find((match) => match.option.key === activeKey) : undefined
  const preview = peek && active ? previewTargetOf(active.option.key) : null
  return (
    <>
      <div
        ref={listRef}
        data-slot="mention-list"
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          'z-popover flex w-mention-list max-w-full flex-col overflow-hidden rounded-lg bg-popover text-dense text-popover-foreground shadow-raised ring-1 ring-foreground/10',
          className,
        )}
      >
        <div id={id} role="listbox" aria-label={label} className="flex flex-col gap-1 p-1">
          {groups.length === 0 ? (
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
          {groups.map((group) => (
            <div
              key={group.type}
              role="group"
              aria-labelledby={`${id}-${group.type}`}
              className="flex flex-col"
            >
              <div
                id={`${id}-${group.type}`}
                role="presentation"
                className="px-2 py-1 text-caption font-bold text-muted-foreground"
              >
                {group.heading}
              </div>
              {group.rows.map(({ option, alias }) => {
                const active = activeKey === option.key
                return (
                  <div
                    key={option.key}
                    id={optionId(id, option.key)}
                    role="option"
                    aria-selected={active}
                    data-active={active || undefined}
                    onClick={() => onPick(option)}
                    onMouseMove={() => {
                      if (!active) onActivate(option.key)
                    }}
                    className="flex min-h-control-md cursor-default items-center gap-2 rounded-md px-2 py-1 pointer-coarse:min-h-control-touch data-active:bg-muted"
                  >
                    <TargetMark option={option} />
                    <span className="min-w-0 flex-1 truncate">
                      <Highlighted text={option.name} query={alias ? '' : query} />
                    </span>
                    <span className="max-w-1/2 shrink-0 truncate text-caption text-muted-foreground">
                      {alias ? `also called ${alias}` : group.quiet ? null : option.detail}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
          {request && groups.length > 0 ? (
            <div role="presentation" className="h-px shrink-0 bg-border" />
          ) : null}
          {request ? (
            <div
              id={optionId(id, REQUEST_ROW)}
              role="option"
              aria-selected={activeKey === REQUEST_ROW}
              data-active={activeKey === REQUEST_ROW || undefined}
              onClick={request.onRequest}
              onMouseMove={() => {
                if (activeKey !== REQUEST_ROW) onActivate(REQUEST_ROW)
              }}
              className="flex min-h-control-md cursor-default items-center gap-2 rounded-md px-2 py-1 text-muted-foreground pointer-coarse:min-h-control-touch data-active:bg-muted data-active:text-foreground"
            >
              {request.icon ? (
                <request.icon aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <MessageSquareIcon aria-hidden="true" className="size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{request.label}</span>
            </div>
          ) : null}
        </div>
        {preview && !beside ? <Peek preview={preview} beside={false} anchor={listRef} /> : null}
        {hint && (groups.length > 0 || request) ? (
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
        ) : null}
      </div>
      {preview && beside ? <Peek preview={preview} beside anchor={listRef} /> : null}
    </>
  )
}
