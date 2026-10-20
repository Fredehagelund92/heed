import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { Area } from '@domain/item'
import {
  ChevronRightIcon,
  FilePlusIcon,
  FlagIcon,
  InfoIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  type Icon,
} from '@/components/icons'
import { ReportGapDialog } from '@/components/gaps/report-gap-dialog'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { ReviewStamp, useReviewStamps } from '@/components/item/review-stamp'
import { AbsenceLine } from '@/components/page/absence-line'
import { outcomeLook, validityWords } from '@/components/proposal/agent-preview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDay } from '@/lib/library'
import type { ReviewStampView } from '@/lib/review-stamp'
import {
  countWords,
  draftSearch,
  formatKb,
  tryItInput,
  type DeliveredFact,
  type TriedReply,
  type TryItScope,
} from '@/lib/try-it'
import { cn } from '@/lib/utils'
import { CopyBlock } from './copy-block'

/*
  The reply of What an agent would get (Assistant board, direction A, with the Try it frames): the
  outcome and the live edition, the counts in one line, the sentence the AI app may say to the
  person (`say`), the facts delivered in their rank order, and the next step and instructions the
  agent is told word for word. Each part folds, so a long list does not
  push the instructions out of reach. Nothing here is a model's: it is get_context's reply.
*/

function Note({
  icon: Glyph,
  tone,
  children,
}: {
  icon: Icon
  tone?: 'warning'
  children: ReactNode
}) {
  return (
    <p className="flex gap-2 text-caption">
      <Glyph
        aria-hidden="true"
        data-tone={tone}
        className={cn(
          'size-icon-sm shrink-0 translate-y-px',
          tone ? 'text-tone-dot' : 'text-muted-foreground',
        )}
      />
      <span>{children}</span>
    </p>
  )
}

/** A part of the reply that folds: a bold title with its count, then its rows. */
function Part({
  title,
  count,
  aside,
  slot,
  children,
}: {
  title: string
  count?: number
  aside?: ReactNode
  slot: string
  children: ReactNode
}) {
  return (
    <details open data-slot={slot} className="group/part rounded-lg border bg-card">
      <summary className="flex min-h-control-lg cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2 text-dense font-bold focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-icon-sm shrink-0 text-muted-foreground transition-transform group-open/part:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1">
          {title}
          {count === undefined ? null : (
            <span className="font-normal text-muted-foreground tabular-nums"> {count}</span>
          )}
        </span>
        {aside}
      </summary>
      <div className="border-t">{children}</div>
    </details>
  )
}

function Fact({
  fact,
  domain,
  stamp,
  rankOf,
  onLeave,
}: {
  fact: DeliveredFact
  domain: Pick<Area, 'name' | 'label'> | null
  /** How it was reviewed before it was served (FR-326). */
  stamp: ReviewStampView | null
  rankOf: (id: string) => number | null
  onLeave?: () => void
}) {
  const conflicts = fact.conflictsWith.map(rankOf).filter((rank): rank is number => rank !== null)
  const when = validityWords(fact.validity)
  return (
    <li data-slot="try-it-fact" className="flex min-w-0 gap-3 px-4 py-3">
      <span className="flex h-5 shrink-0 items-center">
        <KindIcon kind={fact.kind} size="md" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Link
          to="/library/$itemId"
          params={{ itemId: fact.id }}
          onClick={onLeave}
          className="text-dense font-bold break-words underline-offset-4 hover:underline focus-visible:underline"
        >
          {fact.title}
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-caption">
          <span className="font-bold tabular-nums" aria-label={`Ranked ${fact.rank}`}>
            #{fact.rank}
          </span>
          {domain ? <DomainBadge name={domain.name} label={domain.label} size="sm" /> : null}
          <Badge form="outline" size="sm">
            {fact.match === 'exact' ? 'Exact match' : 'Partial match'}
          </Badge>
        </div>
        {fact.appliesNote ? <Note icon={InfoIcon}>{fact.appliesNote}</Note> : null}
        {fact.summary ? (
          <p className="text-caption break-words text-muted-foreground">{fact.summary}</p>
        ) : null}
        {when ? <p className="text-caption text-muted-foreground">{when}</p> : null}
        <ReviewStamp view={stamp} domain={domain?.name} />
        {fact.verified ? null : (
          <Note icon={TriangleAlertIcon} tone="warning">
            AI apps are told this fact may be out of date: its source changed or its check date
            passed.
          </Note>
        )}
        {conflicts.length ? (
          <Note icon={TriangleAlertIcon} tone="warning">
            It says something different from {conflicts.map((rank) => `#${rank}`).join(' and ')}. AI
            apps are told they conflict.
          </Note>
        ) : null}
      </div>
    </li>
  )
}

const inlineLink = 'text-brand-ink underline underline-offset-4 hover:no-underline'

/**
 * Where the facts end: a person who knows one that is missing writes it down, and anyone can
 * tell the owners that AI apps fall short here (Report a gap, FR-606 case 5).
 */
function NextSteps({
  tried,
  onLeave,
  onReport,
  prominent,
}: {
  tried: TryItScope
  onLeave?: () => void
  onReport: () => void
  prominent: boolean
}) {
  const link = <Link to="/library/new" search={draftSearch(tried)} onClick={onLeave} />
  return prominent ? (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" render={link}>
        <FilePlusIcon />
        Start a draft
      </Button>
      <Button variant="outline" onClick={onReport}>
        <FlagIcon />
        Report a gap
      </Button>
    </div>
  ) : (
    <p className="text-dense text-muted-foreground">
      Know a fact that&apos;s missing?{' '}
      <Link to="/library/new" search={draftSearch(tried)} onClick={onLeave} className={inlineLink}>
        Start a draft
      </Link>{' '}
      about this. Is something wrong with what AI apps get?{' '}
      <button type="button" onClick={onReport} className={cn(inlineLink, 'rounded-sm')}>
        Report a gap
      </button>
      .
    </p>
  )
}

export function TryItReply({
  reply,
  tried,
  about,
  today,
  domainOf,
  onLeave,
}: {
  reply: TriedReply
  /** The scope the reply is for: a draft started from it starts with it. */
  tried: TryItScope
  /** The scope in words, for a report about it. */
  about: string
  /** The service's day, which the reply was resolved on. */
  today: string | null
  /** A fact's domain, from the library index; the reply does not carry it. */
  domainOf: (itemId: string) => Pick<Area, 'name' | 'label'> | null
  /** Going to another page from the reply (a fact, Add a fact). */
  onLeave?: () => void
}) {
  const look = outcomeLook[reply.status]
  const ranks = new Map(reply.delivered.map((fact) => [fact.id, fact.rank]))
  const rankOf = (id: string) => ranks.get(id) ?? null
  const found = reply.status === 'matched' || reply.status === 'conflict'
  const [reporting, setReporting] = useState(false)
  const report = () => setReporting(true)
  const stampOf = useReviewStamps(reply.delivered)
  return (
    <div data-slot="try-it-reply" data-status={reply.status} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={look.tone} icon={look.glyph} data-slot="try-it-outcome">
            {look.label}
          </Badge>
          {today ? (
            <span className="text-caption text-muted-foreground">
              As of {formatDay(today, 'long')}
            </span>
          ) : null}
        </div>
        <p className="text-dense">
          <span className="font-bold">{countWords(reply)}.</span>{' '}
          <span className="text-muted-foreground">
            {formatKb(reply.bytes)} of {formatKb(reply.limit)}.
          </span>
        </p>
        {look.sentence && reply.status !== 'no_match' ? (
          // An absence says it in its own line, below.
          <p className="text-dense text-muted-foreground">{look.sentence}</p>
        ) : null}
      </div>
      {reply.say ? (
        <figure data-slot="try-it-say" className="flex flex-col gap-1">
          <figcaption className="text-caption text-muted-foreground">
            What the AI app tells you
          </figcaption>
          <blockquote className="border-l-2 border-border pl-3 text-reading break-words">
            {reply.say}
          </blockquote>
        </figure>
      ) : null}
      {reply.assumedDay ? (
        <Note icon={InfoIcon}>
          You didn&apos;t choose dates, so this is what applies today,{' '}
          {formatDay(reply.assumedDay, 'long')}. AI apps are told to say so. Add a first and last
          day to see another period.
        </Note>
      ) : null}
      {reply.needs.length ? (
        <ul aria-label="What the question needs" className="flex flex-col gap-2">
          {reply.needs.map((need) => (
            <li key={`${need.field} ${need.words}`}>
              <Note icon={InfoIcon}>{need.words}</Note>
            </li>
          ))}
        </ul>
      ) : null}
      {reply.status === 'no_match' ? (
        <AbsenceLine
          slot="try-it-no-match"
          title="Nothing is written down for this"
          action={<NextSteps tried={tried} onLeave={onLeave} onReport={report} prominent />}
        >
          No checked fact applies to {about || 'this question'}. AI apps are told so, which doesn’t
          mean nothing happened. If you know something that changes these numbers, write it down:
          the owner of its domain checks it before AI apps get it. If not, report a gap so the
          owners know AI apps find nothing here.
        </AbsenceLine>
      ) : null}
      {found && reply.delivered.length ? (
        <Part title="What the AI app gets" count={reply.delivered.length} slot="try-it-delivered">
          <ol aria-label="What the AI app gets, in order" className="flex flex-col divide-y">
            {reply.delivered.map((fact) => (
              <Fact
                key={fact.id}
                fact={fact}
                domain={domainOf(fact.id)}
                stamp={stampOf(fact)}
                rankOf={rankOf}
                onLeave={onLeave}
              />
            ))}
          </ol>
          <p className="border-t px-4 py-3 text-caption text-muted-foreground">
            An owner accepted each fact before AI apps got it. AI apps read who as a role, such as
            the owner of a domain, never a person&apos;s name.
          </p>
        </Part>
      ) : null}
      {found && reply.heldBack + reply.cut > 0 ? (
        <Note icon={InfoIcon}>
          {reply.heldBack
            ? 'Held back: facts for other people, stopped facts, and high-risk facts not checked yet. '
            : ''}
          {reply.cut ? "Left out: facts that apply but didn't fit in one reply. " : ''}
          The AI app gets only how many there are.
        </Note>
      ) : null}
      {found ? (
        <NextSteps tried={tried} onLeave={onLeave} onReport={report} prominent={false} />
      ) : null}
      {reply.instructions || reply.next ? (
        <Part title="What the AI app is told" slot="try-it-instructions">
          <div className="flex flex-col gap-2 p-4">
            {reply.next ? (
              <p data-slot="try-it-next" className="text-dense break-words">
                <span className="font-bold">Next step:</span> {reply.next}
              </p>
            ) : null}
            {reply.instructions ? (
              <CopyBlock text={reply.instructions} label="what the AI app is told" />
            ) : null}
            <p className="text-caption text-muted-foreground">
              {reply.statements.join(' ')}
              {reply.digest ? ` Tool descriptions version ${reply.digest}.` : ''}
            </p>
          </div>
        </Part>
      ) : null}
      <p className="flex gap-2 text-caption text-muted-foreground">
        <ShieldCheckIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
        Nothing is saved.
      </p>
      {found || reply.status === 'no_match' ? (
        <ReportGapDialog
          scope={tryItInput(tried)}
          about={about}
          open={reporting}
          onOpenChange={setReporting}
        />
      ) : null}
    </div>
  )
}
