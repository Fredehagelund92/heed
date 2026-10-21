import { memo, type ReactNode } from 'react'
import type { ItemKind } from '@domain/item'
import { ChevronRightIcon, CircleCheckIcon, CircleSlashIcon, type Icon } from '@/components/icons'
import { KindIcon } from '@/components/item/item-marks'
import { ReviewStamp, useReviewStamps } from '@/components/item/review-stamp'
import { PreviewLink } from '@/components/preview/preview-link'
import {
  factCount,
  factDatesWords,
  factSentence,
  type AnswerView,
  type FactRead,
  type FactVerdict,
} from '@/lib/assistant'
import { kindNames, type LibraryRow } from '@/lib/library'
import type { ReviewStampView } from '@/lib/review-stamp'
import { cn } from '@/lib/utils'

/*
  The facts of an answer, each as a small block you can scan: its title in full (it wraps, it is
  never cut, and a screen reader and a copy get all of it), a quiet line with its kind, domain and
  date, which tells two facts with the same title apart, then the one sentence of what it says.
  The list says once, above it, that these facts were read for this answer, not on every line.
  The facts that do not apply are folded under their own control, apart from the ones that do.
*/

/** A fact of the library index, for a block's kind, domain, dates and words. */
export type FactLookup = (
  id: string,
) => Pick<LibraryRow, 'kind' | 'areaName' | 'summary' | 'validity' | 'until'> | null

/** "Event · Sales · from 15 Jun 2026": what tells one fact from another with the same title. */
export function factMeta(row: ReturnType<FactLookup>, kind: ItemKind | null): string {
  const named = row?.kind ?? kind
  return [named ? kindNames[named] : null, row?.areaName ?? null, row ? factDatesWords(row) : null]
    .filter(Boolean)
    .join(' · ')
}

/** The words above a list of facts the answer read, once: they were read for this answer. */
export const FACTS_CAPTION = 'Facts I read for this answer'

/**
 * One fact as a block: its title in full as a link to its page, the quiet line of what it is,
 * then what it says. `children` is that sentence, or whatever follows the title.
 */
export function FactBlock({
  id,
  title,
  kind,
  meta,
  children,
  aside,
  stamp,
}: {
  id: string
  title: string
  kind: ItemKind | null
  meta: string
  children?: ReactNode
  /** Beside the title: how the fact stands (applies, applies in part). */
  aside?: ReactNode
  stamp?: ReviewStampView | null
}) {
  return (
    <div data-slot="ask-fact-block" className="flex min-w-0 gap-3">
      {kind ? (
        <span className="flex h-6 shrink-0 items-center">
          <KindIcon kind={kind} size="md" />
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-col items-start gap-1 @sm:flex-row @sm:gap-2">
          {/* The whole title, wrapped when it must: a screen reader and a copy get all of it. */}
          <PreviewLink
            preview={{ type: 'item', id }}
            className="flex min-h-6 min-w-0 items-center text-dense font-bold break-words underline-offset-4 hover:underline focus-visible:underline @sm:flex-1"
          >
            {title}
          </PreviewLink>
          {aside}
        </div>
        {meta ? <p className="text-caption text-muted-foreground">{meta}</p> : null}
        {children ? <div className="text-dense break-words">{children}</div> : null}
        {stamp ? <ReviewStamp view={stamp} /> : null}
      </div>
    </div>
  )
}

const verdictLook: Record<
  Exclude<FactVerdict, 'read'>,
  { label: string; icon: Icon; className: string }
> = {
  applies: { label: 'Applies', icon: CircleCheckIcon, className: 'text-status-success-fg' },
  partial: { label: 'Applies in part', icon: CircleCheckIcon, className: 'text-status-success-fg' },
  not: { label: 'Doesn’t apply', icon: CircleSlashIcon, className: 'text-muted-foreground' },
}

/** One fact the answer read: what it is, how it stands, what it says, and how it was reviewed. */
function FactRow({
  fact,
  lookup,
  stamp,
}: {
  fact: FactRead
  lookup: FactLookup
  stamp: ReviewStampView | null
}) {
  const row = lookup(fact.id)
  const look = fact.verdict === 'read' ? null : verdictLook[fact.verdict]
  const says = row ? factSentence(row.summary, fact.title) : ''
  // "It applies to everything you asked about" says what the label above it does.
  const why = fact.verdict === 'applies' ? null : fact.reason
  return (
    <li data-slot="ask-fact" data-verdict={fact.verdict} className="px-4 py-3">
      <FactBlock
        id={fact.id}
        title={fact.title}
        kind={row?.kind ?? fact.kind}
        meta={factMeta(row, fact.kind)}
        stamp={stamp}
        aside={
          look ? (
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 text-caption font-bold',
                look.className,
              )}
            >
              <look.icon aria-hidden="true" className="size-icon-sm" />
              {look.label}
            </span>
          ) : null
        }
      >
        {says || why ? (
          <>
            {says}
            {says && why ? ' ' : null}
            {why ? <span className="text-muted-foreground">{why}</span> : null}
          </>
        ) : null}
      </FactBlock>
    </li>
  )
}

/** A folded list of facts: a summary row with its words and count, and the blocks under it. */
function FactsFold({
  title,
  count,
  label,
  open,
  slot,
  className,
  children,
}: {
  title: string
  count: number
  label: string
  open: boolean
  slot: string
  className?: string
  children: ReactNode
}) {
  return (
    <details
      open={open}
      data-slot={slot}
      className={cn('group/facts @container rounded-lg border bg-card', className)}
    >
      <summary className="flex min-h-control-lg cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2 text-dense focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-icon-sm shrink-0 text-muted-foreground transition-transform group-open/facts:rotate-90 motion-reduce:transition-none"
        />
        <span className="font-bold">{title}</span>
        <span className="min-w-0 truncate text-caption text-muted-foreground tabular-nums">
          {count.toLocaleString('en')}
        </span>
      </summary>
      <ul aria-label={label} className="flex flex-col divide-y border-t">
        {children}
      </ul>
    </details>
  )
}

/**
 * The facts the answer read: the ones that apply, or that were only read, first and open (folded
 * when there are many), then the ones that do not apply, folded apart. Drawn again only when its
 * answer changes, so a long conversation stays quick while an answer streams.
 */
export const FactsRead = memo(function FactsRead({
  answer,
  lookup,
  className,
}: {
  answer: AnswerView
  lookup: FactLookup
  className?: string
}) {
  const stampOf = useReviewStamps(answer.facts)
  if (!answer.facts.length) return null
  const reading = answer.facts.filter((fact) => fact.verdict !== 'not')
  const apart = answer.facts.filter((fact) => fact.verdict === 'not')
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {reading.length ? (
        <FactsFold
          slot="ask-facts"
          title="Facts read for this answer"
          label="Facts read for this answer"
          count={reading.length}
          open={reading.length <= 6}
        >
          {reading.map((fact) => (
            <FactRow key={fact.id} fact={fact} lookup={lookup} stamp={stampOf(fact)} />
          ))}
        </FactsFold>
      ) : null}
      {apart.length ? (
        <FactsFold
          slot="ask-facts-apart"
          title="Facts that don’t apply"
          label={`${factCount(apart.length)} that don’t apply`}
          count={apart.length}
          open={false}
        >
          {apart.map((fact) => (
            <FactRow key={fact.id} fact={fact} lookup={lookup} stamp={stampOf(fact)} />
          ))}
        </FactsFold>
      ) : null}
    </div>
  )
})
