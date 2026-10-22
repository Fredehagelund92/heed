import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { editionFeedQuery } from '@/api/edition-queries'
import { editionQuery, peopleQuery } from '@/api/queries'
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  GitCommitHorizontalIcon,
  GitCompareArrowsIcon,
} from '@/components/icons'
import { Owner } from '@/components/item/item-marks'
import { AudienceGate } from '@/components/page/audience-gate'
import { Page, PageContent } from '@/components/page/page'
import { EditionLabel } from '@/components/proposal/edition-label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { changesSince, editionChanges } from '@/lib/edition-feed'
import { editionReason, editionsRefusal } from '@/lib/editions'
import { formatMoment } from '@/lib/library'
import { EditionRowMenu, ExportButton } from './edition-actions'
import { changedItems, EditionItemDiffs } from './edition-panel'
import { LoadError } from './load-error'

/** One fact of the edition: its name above, its value below (a property list). */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-caption text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-body">{children}</dd>
    </div>
  )
}

function BackToEditions() {
  return (
    <Button variant="outline" render={<Link to="/editions" />} className="w-fit">
      <ArrowLeftIcon aria-hidden />
      All editions
    </Button>
  )
}

/**
 * One edition (FR-215, FR-217): its number, whether it is live, when it was sealed, what made it
 * and who, its digest, every item it changed against the edition before it, export and, for an
 * administrator, in the overflow menu, going back to it or, for the live one, stopping delivery.
 */
export function EditionPage({ label }: { label: string }) {
  return (
    <AudienceGate audience="quality" title={`Edition ${label}`} refusal={editionsRefusal}>
      <EditionView label={label} />
    </AudienceGate>
  )
}

function EditionView({ label }: { label: string }) {
  const edition = useQuery(editionQuery(label))
  const { data: people } = useQuery(peopleQuery())
  const data = edition.data
  // Who made it and why, as the feed and the docked panel say it: the deciding person and their
  // reason when the edition itself records neither.
  const summary = useQuery(editionFeedQuery({ through: label, limit: 1 }))
  const entry = summary.data?.entries[0]?.edition.label === label ? summary.data.entries[0] : null
  const actorId = entry?.actorId ?? data?.actorId ?? null
  const why = entry?.why ?? data?.note ?? null
  const person = actorId ? people?.find((candidate) => candidate.id === actorId) : null

  return (
    <Page title={`Edition ${label}`}>
      <PageContent width="overview">
        {edition.isPending ? (
          <div role="status" aria-label="Loading the edition" className="flex flex-col gap-3">
            <Skeleton className="h-control-lg w-column-about" />
            <Skeleton className="h-row-scope w-full" />
          </div>
        ) : edition.isError ? (
          <LoadError
            what="this edition"
            onRetry={() => void edition.refetch()}
            detail={edition.error.message}
          />
        ) : !data ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GitCommitHorizontalIcon />
              </EmptyMedia>
              <EmptyTitle>There is no edition {label}</EmptyTitle>
              <EmptyDescription>
                The number may be mistyped, or the edition was never saved.
              </EmptyDescription>
            </EmptyHeader>
            <BackToEditions />
          </Empty>
        ) : (
          <>
            <section
              aria-labelledby="edition-title"
              data-slot="edition-header"
              className="flex flex-col gap-4 rounded-lg border bg-card p-6 @max-md:p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 id="edition-title" className="text-dense font-bold text-muted-foreground">
                      {data.live ? 'What agents get today' : 'Earlier edition'}
                    </h2>
                    {data.live ? (
                      <Badge form="bare" tone="success" icon={CircleCheckIcon}>
                        Live
                      </Badge>
                    ) : null}
                  </div>
                  <EditionLabel label={data.label} size="lg" />
                </div>
                <div className="flex flex-wrap gap-2 @max-md:w-full">
                  <Button
                    render={<Link to="/editions/compare" search={editionChanges(data.label)} />}
                    className="@max-md:flex-1"
                  >
                    <GitCompareArrowsIcon aria-hidden />
                    What changed
                  </Button>
                  {data.live ? null : (
                    <Button
                      variant="outline"
                      render={<Link to="/editions/compare" search={changesSince(data.label)} />}
                      className="@max-md:flex-1"
                    >
                      Since this edition
                    </Button>
                  )}
                  <ExportButton label={data.label} className="@max-md:flex-1" />
                  <EditionRowMenu edition={data} place="page" />
                </div>
              </div>
              <dl className="grid grid-cols-1 gap-4 border-t pt-4 @2xl:grid-cols-3">
                <Fact term="Saved">{formatMoment(data.sealedAt ?? data.createdAt, 'long')}</Fact>
                <Fact term="Reason">{editionReason(data)}</Fact>
                <Fact term="By">
                  {person ? (
                    <Owner name={person.name} initials={person.initials} size="md" />
                  ) : (
                    <span className="text-muted-foreground">Automatic</span>
                  )}
                </Fact>
                {why ? <Fact term="Why">{why}</Fact> : null}
                {data.restores ? (
                  <Fact term="Has the facts of">
                    <Link
                      to="/editions/$label"
                      params={{ label: data.restores }}
                      className="font-mono text-dense underline-offset-4 hover:underline"
                    >
                      {data.restores}
                    </Link>
                  </Fact>
                ) : null}
                {data.digest ? (
                  <Fact term="Content digest">
                    <EditionLabel label={data.digest} what="digest" className="w-full" />
                  </Fact>
                ) : null}
              </dl>
            </section>
            <section aria-labelledby="changes-title" className="flex flex-col gap-3">
              <h2 id="changes-title" className="text-large font-bold">
                What changed
              </h2>
              <EditionPageChanges label={data.label} />
            </section>
          </>
        )}
      </PageContent>
    </Page>
  )
}

/**
 * What the edition changed, as the docked panel shows it: the sentence that says what changed,
 * who did it and why, then each changed item field by field.
 */
function EditionPageChanges({ label }: { label: string }) {
  const read = useQuery(editionFeedQuery({ through: label, limit: 1 }))
  const entry = read.data?.entries[0]
  if (read.isPending)
    return (
      <div role="status" aria-label="Loading what changed" className="flex flex-col gap-3">
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row-scope w-full" />
      </div>
    )
  if (read.isError || entry?.edition.label !== label)
    return (
      <LoadError
        what="what this edition changed"
        onRetry={() => void read.refetch()}
        {...(read.error ? { detail: read.error.message } : {})}
      />
    )
  return (
    <div className="flex max-w-reading flex-col gap-4">
      <p className="text-body break-words">{entry.sentence}</p>
      <EditionItemDiffs entry={entry} total={changedItems(entry)} />
    </div>
  )
}
