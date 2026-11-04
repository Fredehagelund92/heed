import { and, cn } from '@/lib/utils'
import { ContextText, MentionText } from '@/components/heed/mention-chip'
import {
  ArchiveIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
} from '@/components/icons'
import { DetailsBody, detailsSummary } from '@/components/heed/details-body'
import { PeekFact, PeekFacts } from '@/components/heed/peek'
import { DocFold, prose } from '@/components/heed/doc'
import { Badge } from '@/components/ui/badge'
import type { Fact } from '@/model/items'
import { ownersOf } from '@/model/people'
import { useDomains } from '@/lib/workspace'

// A context item as people read it: the title (with its status only when it isn't Live), the
// text, then who owns it and where it comes from, and everything else folded into Details. The one
// view of an item, so the item's page and a review's Preview of the suggested version can't drift.

export function ItemDocument({
  fact,
  heading: Heading = 'h1',
  preview,
}: {
  fact: Fact
  /** The title's level: the page's own heading on the item's page, under the review's elsewhere. */
  heading?: 'h1' | 'h2' | 'h3'
  /**
   * A version not published yet, shown as it will read once it is. What only publishing sets, the
   * day it was checked, says so instead of a date.
   */
  preview?: boolean
}) {
  const domains = useDomains()
  return (
    <div data-slot="item-document">
      <div className="mb-5 flex flex-wrap items-start gap-x-3 gap-y-2 sm:mb-6">
        <Heading className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl">
          {fact.title}
        </Heading>
        {fact.status !== 'Live' && (
          <Badge variant="outline" className="mt-1.5 text-muted-foreground sm:mt-2">
            {fact.status}
          </Badge>
        )}
      </div>
      <div className={cn('flex flex-col gap-3 text-base leading-7', prose)}>
        <p>
          <MentionText text={fact.summary} />
        </p>
        {fact.body && <ContextText text={fact.body} />}
        {fact.quote && (
          <blockquote className="mt-2 border-l-2 pl-4 text-muted-foreground italic">
            “{fact.quote}”
          </blockquote>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-3 border-t pt-4 text-sm">
        <PeekFacts>
          {fact.status === 'Archived' ? (
            <PeekFact icon={ArchiveIcon}>
              <b>{domains[fact.domain]?.name}</b> - archived, agents don't get it
            </PeekFact>
          ) : fact.status === 'Draft' ? (
            <PeekFact icon={CircleDashedIcon}>
              <b>{domains[fact.domain]?.name}</b> - a draft
              {fact.by && (
                <>
                  {' '}
                  by <b>{fact.by}</b>
                </>
              )}
              , agents don't get it until it is published
            </PeekFact>
          ) : (
            <PeekFact icon={CircleCheckIcon}>
              <b>{domains[fact.domain]?.name}</b> - owned by <b>{and(ownersOf(fact, domains))}</b> -{' '}
              {preview ? 'checked when you publish it' : `checked ${fact.checkedOn}`}
            </PeekFact>
          )}
          {fact.source && (
            <PeekFact icon={ExternalLinkIcon}>
              <a
                href={fact.source}
                target="_blank"
                rel="noreferrer"
                className="font-medium break-all text-primary underline-offset-4 hover:underline"
              >
                {fact.source.replace('https://', '')}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </PeekFact>
          )}
        </PeekFacts>
        <div className="mt-1">
          <DocFold label="Details" summary={detailsSummary(fact)}>
            <div className="pt-1">
              {/* The quote is in the text above, and the item page's side panel has Related. */}
              <DetailsBody fact={fact} leaveOut={['source', 'related']} />
            </div>
          </DocFold>
        </div>
      </div>
    </div>
  )
}
