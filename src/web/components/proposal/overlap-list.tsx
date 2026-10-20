import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { Area, ItemKind } from '@domain/item'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  GitPullRequestIcon,
  HeedDomainIcon,
  InfoIcon,
  LockIcon,
} from '@/components/icons'
import { KindIcon } from '@/components/item/item-marks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PartCard } from './part-card'

/*
  What already overlaps a proposal (FR-108, FR-209; contract 7.2 OverlapList): accepted items
  with their titles, the person's own open proposals, and for everyone else's open proposals
  only a yes or no, never their content (proposals.overlap). The screen joins the accepted ids to
  the library index for the kind and the domain; without them a row still reads.
*/

export type OverlapItem = {
  id: string
  title: string
  kind?: ItemKind
  domain?: Pick<Area, 'name'>
}

export type OverlapProposal = {
  id: string
  title: string
  number?: number
  kind?: ItemKind
  /** Where it stands, in words ("In review"), for another person's proposal. */
  stateName?: string
}

export type Overlap = {
  accepted: OverlapItem[]
  ownProposals: OverlapProposal[]
  /**
   * Other people's open proposals, with their titles: only a reviewer of their domain gets them
   * (gap G4). Everyone else learns only that one exists.
   */
  otherProposals?: OverlapProposal[]
  otherProposalExists: boolean
}

/** The note about the other people's proposals, said plainly either way. */
function OthersNote({ exists, listed }: { exists: boolean; listed: number }) {
  if (listed > 0)
    return (
      <p className="flex gap-2 text-caption text-muted-foreground">
        <InfoIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
        Other people&apos;s open proposals that overlap show here, because you own their domain.
      </p>
    )
  return (
    <p className="flex gap-2 text-caption text-muted-foreground">
      {exists ? (
        <LockIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
      ) : (
        <InfoIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
      )}
      {exists
        ? "Someone else has an open proposal that overlaps. You can't see it."
        : 'Nobody else has an open proposal that overlaps.'}
    </p>
  )
}

function Row({ mark, title, meta }: { mark: ReactNode; title: ReactNode; meta: string }) {
  return (
    <li className="flex gap-3 border-b py-3 first:pt-0 last:border-b-0 last:pb-0">
      <span className="flex size-5 shrink-0 items-center justify-center">{mark}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-dense font-bold break-words">{title}</span>
        <span className="text-caption text-muted-foreground">{meta}</span>
      </div>
    </li>
  )
}

const linkClass = 'underline-offset-4 hover:underline'

/** The overlaps as a companion card ("Overlaps" on the status page, "Already in the library" on the form). */
export function OverlapList({
  overlap,
  title = 'Overlaps',
  loading = false,
  headingLevel = 2,
  limit,
  className,
}: {
  overlap: Overlap | undefined
  title?: string
  loading?: boolean
  headingLevel?: 2 | 3
  /**
   * Shows this many accepted items and a button for the rest, so a long list stays short, and
   * puts the count in the title row ("7 overlap").
   */
  limit?: number
  className?: string
}) {
  const [showAll, setShowAll] = useState(false)
  // Folding away a single item saves nothing, so a list folds when two or more would hide.
  const folds = (count: number) => limit !== undefined && count > limit + 1
  if (loading || !overlap) {
    return (
      <PartCard title={title} headingLevel={headingLevel} className={className} aria-busy="true">
        <span className="sr-only">Looking for overlaps</span>
        <div className="flex gap-3">
          <Skeleton className="size-5 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </PartCard>
    )
  }
  const { accepted, ownProposals, otherProposalExists } = overlap
  const others = overlap.otherProposals ?? []
  const nothing = !accepted.length && !ownProposals.length && !others.length
  const count = accepted.length + ownProposals.length + others.length
  return (
    <PartCard
      title={title}
      headingLevel={headingLevel}
      className={className}
      data-slot="overlap-list"
      aside={
        limit !== undefined && count > 0 ? (
          <Badge form="outline" size="sm" data-slot="overlap-count">
            {count.toLocaleString('en')} {count === 1 ? 'overlaps' : 'overlap'}
          </Badge>
        ) : null
      }
    >
      {nothing ? (
        <p className="text-dense text-muted-foreground">
          Nothing in the library overlaps, and you have no other open proposal that does.
        </p>
      ) : (
        <ul className="flex flex-col">
          {(folds(accepted.length) && !showAll ? accepted.slice(0, limit) : accepted).map(
            (item) => (
              <Row
                key={item.id}
                mark={
                  item.kind ? (
                    <KindIcon kind={item.kind} />
                  ) : (
                    <HeedDomainIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  )
                }
                title={
                  <Link to="/library/$itemId" params={{ itemId: item.id }} className={linkClass}>
                    {item.title}
                  </Link>
                }
                meta={item.domain ? `Accepted · ${item.domain.name}` : 'Accepted'}
              />
            ),
          )}
          {folds(accepted.length) ? (
            <li className="border-b pb-3 last:border-b-0 last:pb-0">
              <Button
                variant="outline"
                size="sm"
                aria-expanded={showAll}
                onClick={() => setShowAll((shown) => !shown)}
                className="w-full justify-between"
              >
                {showAll
                  ? 'Show fewer'
                  : `Show ${(accepted.length - (limit ?? 0)).toLocaleString('en')} more`}
                {showAll ? (
                  <ChevronUpIcon aria-hidden="true" />
                ) : (
                  <ChevronDownIcon aria-hidden="true" />
                )}
              </Button>
            </li>
          ) : null}
          {ownProposals.map((proposal) => (
            <Row
              key={proposal.id}
              mark={
                <GitPullRequestIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              }
              title={
                <Link
                  to="/proposals/$proposalId"
                  params={{ proposalId: proposal.id }}
                  className={linkClass}
                >
                  {proposal.number === undefined ? null : (
                    <>
                      <span className="tabular-nums">#{proposal.number}</span>{' '}
                    </>
                  )}
                  {proposal.title}
                </Link>
              }
              meta="Your open proposal"
            />
          ))}
          {others.map((proposal) => (
            <Row
              key={proposal.id}
              mark={
                proposal.kind ? (
                  <KindIcon kind={proposal.kind} />
                ) : (
                  <GitPullRequestIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                )
              }
              title={
                <Link
                  to="/proposals/$proposalId"
                  params={{ proposalId: proposal.id }}
                  className={linkClass}
                >
                  {proposal.number === undefined ? null : (
                    <>
                      <span className="tabular-nums">#{proposal.number}</span>{' '}
                    </>
                  )}
                  {proposal.title}
                </Link>
              }
              meta={`Open proposal${proposal.stateName ? ` · ${proposal.stateName}` : ''}`}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 border-t pt-3">
        {!nothing && !ownProposals.length ? (
          <p className="flex gap-2 text-caption text-muted-foreground">
            <InfoIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
            You have no other open proposals that overlap.
          </p>
        ) : null}
        <OthersNote exists={otherProposalExists} listed={others.length} />
      </div>
    </PartCard>
  )
}
