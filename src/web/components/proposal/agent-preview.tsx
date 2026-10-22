import { useMemo, type ReactNode } from 'react'
import type { Area } from '@domain/item'
import { shiftDate } from '@domain/validity'
import { Markdown } from '@/components/form/markdown'
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  InfoIcon,
  TriangleAlertIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge, KindBadge } from '@/components/item/item-marks'
import { ReviewStamp, useReviewStamps } from '@/components/item/review-stamp'
import { AbsenceLine } from '@/components/page/absence-line'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { PreviewReply } from '@/api/client'
import { readAgentReply, type AgentReply, type ReplyItem } from '@/lib/agent-reply'
import { formatCount, formatDay } from '@/lib/library'
import type { ReviewStampView } from '@/lib/review-stamp'
import { cn } from '@/lib/utils'
import { PartCard } from './part-card'

/*
  "What agents will get" (FR-214, contract 7.2 AgentPreview): the real get_facts reply for a
  draft, from the same code as delivery, shown as an agent would read it. The card names what the
  question was about, says whether anything was found, and shows each fact with its dates, its
  source and what an agent may say about cause. Nothing is shared: a draft is seen only by the
  people FR-214 names.
*/

export const outcomeLook: Record<
  AgentReply['status'],
  { glyph: Icon; tone: BadgeTone; label: string; sentence?: string }
> = {
  matched: { glyph: CircleCheckIcon, tone: 'success', label: 'Found' },
  conflict: {
    glyph: TriangleAlertIcon,
    tone: 'warning',
    label: 'Found, with a conflict',
    sentence: 'Two of these facts say different things. Agents are told they conflict.',
  },
  no_match: {
    glyph: CircleDashedIcon,
    tone: 'neutral',
    label: 'Nothing found',
    sentence: 'Agents are told that nothing is written down for this.',
  },
  need_more_detail: {
    glyph: CircleDashedIcon,
    tone: 'neutral',
    label: 'Needs more detail',
    sentence:
      'The question is too open. Agents are asked to name the metric, the market or the dates.',
  },
  check_failed: {
    glyph: TriangleAlertIcon,
    tone: 'warning',
    label: "Couldn't check",
    sentence: "We couldn't run the checks. Try again in a minute.",
  },
}

/** The outcome in words: "Found", "Nothing found". */
export function outcomeLabel(status: AgentReply['status']): string {
  return outcomeLook[status].label
}

/**
 * "From 4 August 2026, still going on." or "From 4 August to 2 September 2026." (the last day,
 * NFR-048): the year is said once when both days share it.
 */
export function validityWords(validity: ReplyItem['validity'] | null): string | null {
  if (!validity) return null
  const from = formatDay(validity.start, 'long')
  if (!validity.end) return `From ${from}, still going on.`
  const last = shiftDate(validity.end, -1)
  if (last === validity.start) return `On ${from} only.`
  const sameYear = last.slice(0, 4) === validity.start.slice(0, 4)
  return `From ${sameYear ? from.replace(/ \d{4}$/, '') : from} to ${formatDay(last, 'long')}.`
}

/** The site a source is on: "regulator.example". Null for a link that is not a web address. */
export function sourceHost(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.hostname.replace(/^www\./, '')
      : null
  } catch {
    return null
  }
}

const claimWords = {
  fact_only: (
    <>
      Agents may say it <strong className="font-bold">could explain</strong> a change, never that it{' '}
      <strong className="font-bold">caused</strong> it.
    </>
  ),
  effect_stated: (
    <>
      The source states the effect. Agents may say it <strong className="font-bold">caused</strong>{' '}
      the change.
    </>
  ),
} satisfies Record<NonNullable<ReplyItem['claimLevel']>, ReactNode>

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

function DeliveredItem({
  item,
  domain,
  stamp,
  draft,
}: {
  item: ReplyItem
  domain: Pick<Area, 'name' | 'label'> | null
  /** How it was reviewed before it was served; null for a draft, or a fact with no review on record. */
  stamp: ReviewStampView | null
  /** The proposal's own item, which no one has accepted yet. */
  draft: boolean
}) {
  const evidence = item.evidence[0]
  const host = evidence ? sourceHost(evidence.url) : null
  const when = validityWords(item.validity)
  return (
    <li
      data-slot="agent-preview-item"
      className="flex flex-col gap-3 rounded-lg border bg-background p-4"
    >
      {item.kind || domain ? (
        <div className="flex flex-wrap items-center gap-2">
          {item.kind ? <KindBadge kind={item.kind} size="sm" /> : null}
          {domain ? <DomainBadge name={domain.name} label={domain.label} size="sm" /> : null}
        </div>
      ) : null}
      <p className="text-dense font-bold break-words">{item.title}</p>
      {item.summary ? <p className="text-dense break-words">{item.summary}</p> : null}
      {item.body ? (
        <details data-slot="agent-preview-body" className="group/body">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-caption text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-icon-sm shrink-0 transition-transform group-open/body:rotate-90 motion-reduce:transition-none"
            />
            The full text, {[...item.body].length.toLocaleString('en')} characters
          </summary>
          <Markdown source={item.body} headingOffset={2} className="gap-2 pt-2 text-dense" />
        </details>
      ) : null}
      {when || evidence ? (
        <p className="text-caption text-muted-foreground">
          {when}
          {when && evidence ? ' ' : null}
          {evidence ? (
            <>
              Source:{' '}
              {host ? (
                <a
                  href={evidence.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand-ink underline underline-offset-4"
                >
                  {host}
                </a>
              ) : (
                'a link'
              )}
              {evidence.date ? `, read ${formatDay(evidence.date)}` : null}.
            </>
          ) : null}
        </p>
      ) : null}
      <ReviewStamp view={stamp} draft={draft} domain={domain?.name} />
      {item.appliesNote ? <Note icon={InfoIcon}>{item.appliesNote}</Note> : null}
      {item.claimLevel || item.notToConclude ? (
        <div className="flex flex-col gap-2 border-t pt-3">
          {item.claimLevel ? <Note icon={InfoIcon}>{claimWords[item.claimLevel]}</Note> : null}
          {item.notToConclude ? (
            <Note icon={CircleSlashIcon}>
              <strong className="font-bold">What not to conclude:</strong>{' '}
              <span className="break-words">{item.notToConclude}</span>
            </Note>
          ) : null}
        </div>
      ) : null}
      {item.verified ? null : (
        <Note icon={TriangleAlertIcon} tone="warning">
          Agents are told this fact may be out of date, because its source changed or its check date
          passed.
        </Note>
      )}
    </li>
  )
}

function Outcome({ reply }: { reply: AgentReply }) {
  const look = outcomeLook[reply.status]
  const count = 'items' in reply ? reply.items.length : null
  // An absence is a result that was looked for (contract 9.5): the absence line says so.
  if (reply.status === 'no_match')
    return (
      <AbsenceLine slot="agent-preview-no-match" title="Nothing written down for this question">
        {look.sentence}
      </AbsenceLine>
    )
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-dense">
        <Badge form="bare" tone={look.tone} icon={look.glyph} data-slot="agent-preview-outcome">
          {look.label}
        </Badge>
        {count === null ? null : (
          <span className="text-caption text-muted-foreground">{formatCount(count)}</span>
        )}
      </p>
      {look.sentence ? (
        <p className="text-caption text-muted-foreground">
          {reply.status === 'check_failed' && reply.message ? reply.message : look.sentence}
        </p>
      ) : null}
    </div>
  )
}

export type AgentPreviewState = 'loading' | 'ready' | 'waiting'

/**
 * The preview card. `result` is the `result` field of proposals.preview, read defensively: a
 * shape this card does not know shows a plain sentence. `state` is `waiting` until the draft
 * passes the format check (the preview needs a saved, format-valid draft), then `loading` and
 * `ready`.
 */
export function AgentPreview({
  state,
  result,
  about = [],
  published = false,
  domainOf,
  draftItemId,
  action,
  waitingFor = "Fill in what happened, where it applies and when. Then you'll see what agents would get.",
  headingLevel = 2,
  className,
}: {
  state: AgentPreviewState
  result?: PreviewReply
  /** What the question was about, as written on the chips: "Units sold", "Norway", "4 Aug 2026". */
  about?: string[]
  /** False for a draft or a proposal under review: the card says "Not shared yet". */
  published?: boolean
  /** The domain of a fact in the reply, from the library index; the reply does not carry it. */
  domainOf?: (itemId: string) => Pick<Area, 'name' | 'label'> | null
  /** The id of the proposal's own item in the reply: the one fact that is not accepted yet. */
  draftItemId?: string
  /** Under the reply, such as "Try another question". */
  action?: ReactNode
  waitingFor?: string
  headingLevel?: 2 | 3
  className?: string
}) {
  const reply = useMemo(
    () => (state === 'ready' && result ? readAgentReply(result) : null),
    [state, result],
  )
  const stampOf = useReviewStamps(reply && 'items' in reply ? reply.items : [])
  return (
    <PartCard
      title="What agents will get"
      headingLevel={headingLevel}
      aside={published ? null : <Badge form="outline">Not shared yet</Badge>}
      data-slot="agent-preview"
      data-state={reply?.status ?? state}
      aria-busy={state === 'loading' ? true : undefined}
      className={className}
    >
      {about.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">For a question about</p>
          <ul aria-label="The question is about" className="flex flex-wrap gap-2">
            {about.map((term) => (
              <li key={term}>
                <Badge form="outline">{term}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state === 'waiting' ? (
        <p className="text-dense text-muted-foreground">{waitingFor}</p>
      ) : state === 'loading' || !reply ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <span className="sr-only">Asking as an agent would</span>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-full max-w-popover" />
        </div>
      ) : (
        <>
          <Outcome reply={reply} />
          {'items' in reply && reply.items.length ? (
            <ul className="flex flex-col gap-3">
              {reply.items.map((item) => (
                <DeliveredItem
                  key={item.id}
                  item={item}
                  domain={domainOf?.(item.id) ?? null}
                  stamp={stampOf(item)}
                  draft={item.id === draftItemId}
                />
              ))}
            </ul>
          ) : null}
          {'cut' in reply && reply.cut ? (
            <Note icon={InfoIcon}>
              More facts apply than fit in one reply. Agents get the ones that rank highest.
            </Note>
          ) : null}
          {reply.edition ? (
            <p className="text-caption text-muted-foreground">
              Compared with what agents get today.
            </p>
          ) : null}
        </>
      )}
      {action}
    </PartCard>
  )
}
