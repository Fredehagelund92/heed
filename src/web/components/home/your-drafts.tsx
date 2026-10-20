import { useRef, type KeyboardEvent } from 'react'
import type { Area } from '@domain/item'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ProposalRecord } from '@/api'
import { areasQuery } from '@/api/queries'
import { ArrowRightIcon } from '@/components/icons'
import { DomainBadge, KindIcon, proposalStateLook } from '@/components/item/item-marks'
import { DraftedMark } from '@/components/proposal/attribution'
import { DraftRowMenu, isDiscardKey, useDiscardDrafts } from '@/components/proposals/discard-drafts'
import { gridRowControl } from '@/components/page/grid'
import { Badge } from '@/components/ui/badge'
import { useNow } from '@/hooks/use-now'
import { formatMoment } from '@/lib/library'
import { draftsLink, editedAgoWords } from '@/lib/my-drafts'
import { editLinkOf, proposalStateNames, toProposalRow, UNTITLED } from '@/lib/proposals'
import { cn } from '@/lib/utils'
import { useMyDrafts } from '@/lib/use-my-drafts'
import './your-drafts.css'

/*
  Your drafts (Home): the drafts the person started and has not submitted, by hand, with the
  assistant or through an AI app, so they can find one and finish it. Only the writer sees a
  draft, so this is the one part of Home that is the person's own; it is not drawn at all while
  they have none. Each row is one target that opens the draft in its form, to check every field
  and submit it: the kind's glyph, the title (wrapping, never cut), then the domain badge, a
  quiet Draft mark, the bot glyph when an AI app or the assistant drafted it (contract 6.13),
  and how long ago it was last edited. Each of these parts has one column for every row, so it
  lines up from row to row: beside the title when the list is wide, under it when it is narrow,
  and wrapping after it on a phone (`draft-columns` in your-drafts.css). The
  newest five show; All drafts opens Proposals > Mine on the drafts. Each row also has its menu
  (Continue editing, Discard draft), shown while the row is hovered or focused, and Command or
  Control Backspace discards the focused one. A discarded draft leaves at once, the next one
  moves up, and the toast holds Undo for a few seconds (components/proposals/discard-drafts.tsx).
*/

/** How many drafts Home lists before All drafts takes over. */
export const HOME_DRAFTS_SHOWN = 5

/** Where a draft is finished: its form, or the proposal's page for a term. */
function openLink(record: ProposalRecord) {
  return record.subject === 'item'
    ? editLinkOf(record)
    : ({ to: '/proposals/$proposalId', params: { proposalId: record.id } } as const)
}

/** Up and Down move between the rows, as in a menu; Tab still leaves the list. */
function stepRows(event: KeyboardEvent<HTMLUListElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('[data-draft-link]')]
  const at = links.indexOf(document.activeElement as HTMLAnchorElement)
  if (at === -1) return
  event.preventDefault()
  links[Math.min(links.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
}

function DraftRow({
  record,
  areas,
  now,
  onDiscard,
}: {
  record: ProposalRecord
  areas: readonly Area[]
  now: number
  onDiscard: () => void
}) {
  const row = toProposalRow(record, areas)
  const look = proposalStateLook.draft
  return (
    <li
      data-draft-id={record.id}
      className="group/row flex -outline-offset-2 transition-colors hover:bg-accent has-[[data-draft-link]:focus-visible]:outline-2 has-[[data-draft-link]:focus-visible]:outline-ring @xl:col-span-full @xl:grid @xl:grid-cols-subgrid"
    >
      <Link
        {...openLink(record)}
        data-draft-link
        data-slot="home-draft"
        onKeyDown={(event) => {
          if (!isDiscardKey(event)) return
          event.preventDefault()
          onDiscard()
        }}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 outline-none @xl:col-span-4 @xl:grid @xl:grid-cols-subgrid @xl:items-center @xl:gap-y-1 @3xl:col-span-5"
      >
        <span className="flex h-5 shrink-0 items-center @xl:self-start">
          <KindIcon kind={row.kind} />
        </span>
        {/* On a phone the meta is a line under the title; wider, each part takes its column. */}
        <span className="flex min-w-0 flex-1 flex-col gap-1 @xl:contents">
          <span
            data-slot="home-draft-title"
            className={cn(
              'min-w-0 text-body wrap-break-word text-foreground @xl:col-span-3 @3xl:col-span-1 @3xl:pr-1',
              // A draft with nothing written yet reads as a placeholder, as an empty field does.
              row.title === UNTITLED && 'text-muted-foreground',
            )}
          >
            {row.title}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @xl:contents">
            <span className="flex min-w-0 @xl:col-start-2 @xl:justify-self-start @3xl:col-start-auto">
              <DomainBadge
                name={row.areaName}
                label={row.areaLabel}
                size="sm"
                className="max-w-full"
              />
            </span>
            <span className="flex items-center gap-2 @xl:justify-self-start">
              <Badge form="bare" size="sm" quiet icon={look.glyph} data-slot="home-draft-mark">
                {proposalStateNames.draft}
              </Badge>
              {row.drafted ? <DraftedMark by={row.drafted} /> : null}
            </span>
            <time
              dateTime={record.updatedAt}
              title={`Last edited ${formatMoment(record.updatedAt, 'long')}`}
              className="text-caption whitespace-nowrap text-muted-foreground tabular-nums @xl:justify-self-start @3xl:justify-self-end"
            >
              {editedAgoWords(record.updatedAt, now)}
            </time>
          </span>
        </span>
      </Link>
      {/* Centred on the row, however many lines its title and marks take. */}
      <span className="flex shrink-0 items-center px-2 @xl:pl-0">
        <DraftRowMenu record={record} onDiscard={onDiscard} className={gridRowControl} />
      </span>
    </li>
  )
}

export function YourDrafts() {
  const drafts = useMyDrafts()
  const { data: areas = [] } = useQuery(areasQuery())
  const now = useNow()
  const listRef = useRef<HTMLUListElement>(null)
  // Where the discarded row was: the draft that moves up into its place takes the focus.
  const at = useRef(0)
  const discard = useDiscardDrafts({
    finalFocus: () => {
      const links = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-draft-link]') ?? [])]
      return links[Math.min(at.current, links.length - 1)] ?? null
    },
  })
  if (!drafts?.length) return discard.dialog
  const shown = drafts.slice(0, HOME_DRAFTS_SHOWN)
  return (
    <section
      aria-labelledby="home-drafts"
      data-slot="home-drafts"
      className="@container flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-drafts" className="flex items-baseline gap-2 text-body font-bold">
          Your drafts
          <span className="font-normal text-muted-foreground tabular-nums">
            {drafts.length.toLocaleString('en')}
          </span>
        </h2>
        <Link
          {...draftsLink}
          className="inline-flex min-h-6 items-center gap-1 rounded-sm text-dense text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {drafts.length > shown.length
            ? `All ${drafts.length.toLocaleString('en')} drafts`
            : 'All drafts'}
          <ArrowRightIcon aria-hidden="true" className="size-icon-sm" />
        </Link>
      </div>
      <ul
        ref={listRef}
        aria-label="Your drafts, not sent yet"
        onKeyDown={stepRows}
        // Wider than a phone, one grid for every row, each row a subgrid of it (`draft-columns`).
        className="draft-columns flex flex-col divide-y overflow-hidden rounded-lg border bg-card @xl:grid @xl:gap-x-3"
      >
        {shown.map((record, index) => (
          <DraftRow
            key={record.id}
            record={record}
            areas={areas}
            now={now}
            onDiscard={() => {
              at.current = index
              discard.ask([record])
            }}
          />
        ))}
      </ul>
      {discard.dialog}
    </section>
  )
}
