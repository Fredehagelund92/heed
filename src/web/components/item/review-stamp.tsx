import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { areasQuery, peopleQuery, servedReviewsQuery } from '@/api/queries'
import { CircleDotIcon, HeedAcceptedIcon } from '@/components/icons'
import type { ServedStamp } from '@/lib/agent-reply'
import { formatDay } from '@/lib/library'
import { acceptedByWords, reviewStampView, type ReviewStampView } from '@/lib/review-stamp'
import { cn } from '@/lib/utils'

/*
  Reviewed before served (contract 7.2 `ReviewStamp`, FR-326). One 12/16 line under every fact
  shown as served (Try it, the assistant's facts read, What an agent will see and the item page):
  the accepted mark, who accepted it with their role, the day and that its
  checks passed. It is quiet on purpose, like a commit line under a change: the mark stays neutral
  (a healthy fact is never green, 6.1) and only the person's name is in the foreground colour.
  Inside Heed it names the person; an AI app reads the same line with the role alone.
*/

/** A fact a page shows as served: its id, the version an agent gets and its review as served. */
export type ServedFact = { id: string; version?: number; reviewed: ServedStamp | null }

/**
 * The review stamp of each served fact on a page: Heed's own record of who accepted it, read in
 * one request for the page, over the review as the agent reads it until that arrives.
 */
export function useReviewStamps(facts: readonly ServedFact[]) {
  const ids = facts.filter((fact) => fact.reviewed).map((fact) => fact.id)
  const { data: reviews } = useQuery(servedReviewsQuery(ids))
  const { data: people } = useQuery(peopleQuery())
  const { data: areas } = useQuery(areasQuery())
  return (fact: ServedFact): ReviewStampView | null => {
    if (!fact.reviewed) return null
    const review = reviews?.find(
      (entry) =>
        entry.id === fact.id && (fact.version === undefined || entry.version === fact.version),
    )
    return reviewStampView(fact.reviewed, review, {
      person: (id) => people?.find((person) => person.id === id)?.name,
      domain: (id) => areas?.find((area) => area.id === id)?.name,
    })
  }
}

/**
 * The review stamp of a library item the live edition serves, from Heed's own record; null for an
 * item that is not served, and until the record is read.
 */
export function useItemReviewStamp(item: {
  id: string
  version: number
  status: string
}): ReviewStampView | null {
  const served = item.status === 'accepted'
  const { data: reviews } = useQuery(servedReviewsQuery(served ? [item.id] : []))
  const { data: people } = useQuery(peopleQuery())
  const { data: areas } = useQuery(areasQuery())
  const review = reviews?.find((entry) => entry.id === item.id && entry.version === item.version)
  if (!served || !review) return null
  return reviewStampView(null, review, {
    person: (id) => people?.find((person) => person.id === id)?.name,
    domain: (id) => areas?.find((area) => area.id === id)?.name,
  })
}

/**
 * In a narrow column (the assistant page's facts, under 16rem) the stamp keeps who and when:
 * the role and the checks are left to a screen reader, as the domain badge above names
 * the domain. Everywhere wider they show.
 */
const narrowHidden = 'sr-only @3xs:not-sr-only'

/**
 * A separator a screen reader hears as a comma. It keeps to the words before it, so a line that
 * wraps ends with the dot and the next starts with words, never with a dot.
 */
function Dot() {
  return (
    <>
      <span aria-hidden="true">&nbsp;· </span>
      <span className="sr-only">, </span>
    </>
  )
}

function Line({
  icon,
  state,
  by,
  className,
  children,
}: {
  icon: ReactNode
  state: 'accepted' | 'pending' | 'unrecorded'
  /** Whether it names the person, or the role alone until Heed has read who it was. */
  by?: 'person' | 'role'
  className?: string
  children: ReactNode
}) {
  return (
    <p
      data-slot="review-stamp"
      data-state={state}
      data-by={by}
      className={cn('@container flex min-w-0 gap-2 text-caption text-muted-foreground', className)}
    >
      <span className="flex h-4 shrink-0 items-center">{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

/**
 * The stamp of a served fact. With `view` null it says why there is none: the proposal's own
 * `draft` in What an agent will see is not reviewed yet, and an agent gets it only once the owner
 * of `domain` accepts it; any other fact is live, and one with no accept decision on record
 * (added before reviews were kept) says so.
 */
export function ReviewStamp({
  view,
  draft = false,
  domain,
  className,
}: {
  view: ReviewStampView | null
  /** The proposal's own item in What an agent will see, which no one has accepted yet. */
  draft?: boolean
  /** The fact's domain, for a draft. */
  domain?: string | null
  className?: string
}) {
  if (!view && !draft)
    return (
      <Line
        state="unrecorded"
        className={className}
        icon={<CircleDotIcon aria-hidden="true" className="size-icon-sm" />}
      >
        No review on record. This fact was added before we kept reviews.
      </Line>
    )
  if (!view)
    return (
      <Line
        state="pending"
        className={className}
        icon={<CircleDotIcon aria-hidden="true" className="size-icon-sm" />}
      >
        Not reviewed yet. AI apps get it once {domain ? `the owner of ${domain}` : 'the owner'}{' '}
        accepts it.
      </Line>
    )
  const by = acceptedByWords(view)
  const name = view.person
  return (
    <Line
      state="accepted"
      by={name ? 'person' : 'role'}
      className={className}
      icon={<HeedAcceptedIcon aria-hidden="true" className="size-icon-sm" />}
    >
      Accepted <span className="whitespace-nowrap">{formatDay(view.acceptedOn, 'long')}</span> by{' '}
      {name ? (
        <>
          <span className="whitespace-nowrap text-foreground">{name}</span>
          <span className={narrowHidden}>{by.slice(name.length)}</span>
        </>
      ) : (
        by
      )}
      {view.checks?.length ? (
        <span className={narrowHidden}>
          <Dot />
          <span className="whitespace-nowrap">Checks passed</span>
        </span>
      ) : null}
    </Line>
  )
}
