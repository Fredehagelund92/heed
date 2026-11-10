import * as React from 'react'
import { and, cn } from '@/lib/utils'
import {
  ArchiveIcon,
  ArrowLeftRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MessageSquareWarningIcon,
  PencilIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { DockFrame, DockMissing, PeekBar } from '@/components/dock'
import { DockStepper } from '@/components/heed/list'
import {
  PeekAttention,
  PeekBand,
  PeekBands,
  PeekFact,
  PeekFacts,
  PeekFold,
  PeekLink,
  PeekMeaning,
  PeekPending,
  PeekTitle,
  PeekToolbar,
} from '@/components/heed/peek'
import { Button } from '@/components/ui/button'
import { ownersOf } from '@/model/people'
import { DetailsBody, detailsSummary } from '@/components/heed/details-body'
import { countComments } from '@/components/templates/comment-box/utils'
import { closeDock, openDock } from '@/lib/dock'
import { useComments } from '@/lib/comments'
import { href, navigate, useRoute } from '@/lib/router'
import { useQuery } from '@tanstack/react-query'
import { conflictQuery, itemPageQuery, useInbox, useWrite } from '@/api/queries'
import { useDomains, useFact, useFacts, useMe } from '@/lib/workspace'
import { useAfter } from '@/lib/loading'
import { MentionText } from '@/components/heed/mention-chip'
import type { Fact } from '@/model/items'

// The context quick view: the note, one closed Details and a toolbar under it. Title once, the
// words, its domain, who owns it and whether it is still right, where it comes from, the one
// action. One attention line only when a decision is needed (a flag, an overlap, an overdue check),
// with one button; the choice itself is made on the page. What agents get, history and the full
// source are not here.
//
// The list's row draws it at once; the item's own read brings its source, its quote and whether
// another item disagrees with it. Until that read answers nothing is settled from here: the
// attention line holds its place, its button waits, and a read that fails or takes longer than
// CHECK_WAIT says so with Try again. The warning is never absent while it is unknown.

/** How long the item's own read may take before the quick view says it couldn't check. */
export const CHECK_WAIT = 8000

/** What the quick view knows of the pair an item is in: still coming, or failed, or known. */
type PairCheck =
  | { state: 'checking' }
  | { state: 'failed' }
  | { state: 'known'; key: string; canSettle: boolean; asked: number }

export function FactPeek({ id }: { id: string }) {
  const listed = useFact(id)
  // The item's own read has its text, source and quote; the list's row shows while it loads.
  const itemRead = useQuery(itemPageQuery(id))
  const read = itemRead.data
  const fact = read?.item ?? listed
  const history = read?.history ?? []
  // Whether the item's own read has said what it is in: the check. A slow one counts as failed,
  // and Try again starts the wait over.
  const [attempt, setAttempt] = React.useState(0)
  const checked = read !== undefined
  const itemSlow = useTooLong(!checked && !itemRead.isError, attempt)
  const unchecked = !checked && (failedNow(itemRead) || itemSlow)
  const facts = useFacts()
  const me = useMe()
  const domains = useDomains()
  const { cards, done } = useInbox()
  const write = useWrite()
  const { query } = useRoute()
  const comments = useComments(`context:${id}`)
  const flagCard = cards.find((c) => c.id === query.get('flag'))
  // Opened here counts as read: only items someone opened can be marked checked together.
  const found = !!fact
  React.useEffect(() => {
    if (found) void write('markViewed', { id })
    // Once per item opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, id])
  // The item it is in a conflict with, whichever of the two holds the flag.
  const overlap = fact
    ? facts.find(
        (f) =>
          f.id !== fact.id &&
          (f.id === fact.disagreesWith || f.disagreesWith === fact.id) &&
          (f.status === 'Live' || f.status === 'Needs checking'),
      )
    : undefined
  const pairRead = useQuery({
    ...conflictQuery(`${id}.${overlap?.id ?? ''}`),
    enabled: !!overlap && checked,
  })
  const pairSlow = useTooLong(
    !!overlap && checked && pairRead.data === undefined && !pairRead.isError,
    attempt,
  )
  const pair: PairCheck = pairRead.data
    ? {
        state: 'known',
        key: pairRead.data.key,
        canSettle: Object.values(pairRead.data.rights).some(Boolean),
        asked: pairRead.data.asked,
      }
    : unchecked || failedNow(pairRead) || pairSlow
      ? { state: 'failed' }
      : { state: 'checking' }
  const retry = () => {
    setAttempt((n) => n + 1)
    void itemRead.refetch()
    if (overlap) void pairRead.refetch()
  }
  if (!fact && !checked && !unchecked) return <PeekLoading />
  if (!fact)
    return (
      <DockFrame title="Context">
        <DockMissing>
          This context item isn't in Context any more. Close the panel and search for it by name.
        </DockMissing>
      </DockFrame>
    )
  const owner = me.owns.includes(fact.domain) || me.admin
  const owners = ownersOf(fact, domains)
  const page = `/context/${fact.id}`
  const flag = flagCard?.flag && !done[flagCard.id] ? flagCard : undefined
  const stale = fact.status === 'Needs checking' || !!fact.outOfDate
  const question = `What should I know about ${fact.where[0]?.toLowerCase() ?? 'this'}${fact.where[1] ? ` in ${fact.where[1]}` : ''}?`
  const nComments = countComments(comments)

  // One decision at most, the most pressing first.
  const attention = flag ? (
    <PeekAttention
      icon={MessageSquareWarningIcon}
      action={
        owner && (
          <Button
            variant="outline"
            size="sm"
            disabled={!checked}
            onClick={() => {
              void write('completeCard', { card: flag.id, outcome: 'Not a problem' })
              toast('Report closed', { description: 'The context item stays as it is.' })
              closeDock()
            }}
          >
            Not a problem
          </Button>
        )
      }
    >
      Reported {flag.flag!.reason}, {flag.flag!.when}: “{flag.flag!.note}”
    </PeekAttention>
  ) : overlap ? (
    <Disagreement other={overlap} pair={pair} onRetry={retry} />
  ) : !checked ? (
    unchecked ? (
      <PeekAttention
        icon={TriangleAlertIcon}
        action={
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        }
      >
        Not checked whether another item disagrees: it didn&apos;t load. Don&apos;t settle anything
        on it yet.
      </PeekAttention>
    ) : (
      <Checking />
    )
  ) : stale && fact.status !== 'Archived' ? (
    <PeekAttention
      icon={TriangleAlertIcon}
      action={
        owner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void write('editItem', {
                id: fact.id,
                patch: {
                  status: 'Live',
                  outOfDate: undefined,
                  checkedOn: '23 Oct 2026',
                  checkedBy: me.name,
                },
              }).then(() =>
                toast('Checked: still true', {
                  description: 'Checked today. The next check is due in 90 days.',
                }),
              )
            }
          >
            Still true
          </Button>
        )
      }
    >
      {fact.outOfDate ?? 'Its check date has passed.'}
    </PeekAttention>
  ) : null

  return (
    <DockFrame
      title="Context"
      quietTitle
      actions={
        <PeekBar onExpand={() => navigate(page)}>
          <DockStepper list="context" id={fact.id} onGo={(next) => openDock('context', next)} />
        </PeekBar>
      }
      footer={
        owner ? (
          <Button size="sm" nativeButton={false} render={<a href={href(`${page}/edit`)} />}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button size="sm" nativeButton={false} render={<a href={href(`${page}/suggest`)} />}>
            <PencilIcon data-icon="inline-start" />
            Suggest a change
          </Button>
        )
      }
    >
      <PeekBands>
        <PeekBand first>
          <PeekTitle>{fact.title}</PeekTitle>
          <PeekMeaning>
            <p>
              <MentionText text={fact.summary} />
            </p>
          </PeekMeaning>
          {attention}
        </PeekBand>
        <PeekBand label="Who owns it and where it comes from">
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
                <b>{domains[fact.domain]?.name}</b> - owned by <b>{and(owners)}</b> - checked{' '}
                {fact.checkedOn}
                {fact.status === 'Needs checking' && (flag || overlap) && ', needs checking'}
              </PeekFact>
            )}
            {!checked && !fact.source ? (
              <PeekFact icon={ExternalLinkIcon}>
                <PeekPending className="mt-1 h-3 w-52 max-w-full" />
              </PeekFact>
            ) : (
              fact.source && (
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
              )
            )}
          </PeekFacts>
        </PeekBand>
        <PeekBand flush>
          <PeekFold summary={detailsSummary(fact)}>
            <DetailsBody fact={fact} pending={!checked} />
          </PeekFold>
        </PeekBand>
        <PeekBand flush>
          <PeekToolbar label="More about this context item">
            <PeekLink
              icon={FlaskConicalIcon}
              className="h-8"
              onClick={() => openDock('ask', undefined, { q: question })}
            >
              Try it
            </PeekLink>
            <PeekLink icon={ClockIcon} className="h-8" href={href(page)}>
              {history.length
                ? `History: ${history.length} ${history.length === 1 ? 'version' : 'versions'}`
                : 'History'}
            </PeekLink>
            <PeekLink icon={MessageSquareIcon} className="h-8" href={href(page)}>
              {nComments ? `Comments: ${nComments}` : 'Comments'}
            </PeekLink>
          </PeekToolbar>
        </PeekBand>
      </PeekBands>
    </DockFrame>
  )
}

/** A read that failed and is not being tried again right now. */
const failedNow = (q: { isError: boolean; isFetching: boolean }) => q.isError && !q.isFetching

/** True once `waiting` has lasted CHECK_WAIT in this attempt: a new attempt waits afresh. */
function useTooLong(waiting: boolean, attempt: number) {
  const [late, setLate] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!waiting) return
    const t = window.setTimeout(() => setLate(attempt), CHECK_WAIT)
    return () => window.clearTimeout(t)
  }, [waiting, attempt])
  return waiting && late === attempt
}

/** The attention line's place while the item's own read has not said yet whether it needs one. */
function Checking() {
  const shown = useAfter(true)
  return (
    <div className={shown ? undefined : 'invisible'}>
      <PeekAttention icon={LoaderCircleIcon} checking>
        Checking whether another item disagrees…
      </PeekAttention>
    </div>
  )
}

/**
 * The conflict the item is in: the other item at once, then who may settle it and how often agents
 * got both, which hold their places (the button keeps its width) until the read says.
 */
function Disagreement({
  other,
  pair,
  onRetry,
}: {
  other: Fact
  pair: PairCheck
  onRetry: () => void
}) {
  const label = pair.state === 'known' && pair.canSettle ? 'Compare and decide' : 'Compare the two'
  return (
    <PeekAttention
      icon={ArrowLeftRightIcon}
      action={
        pair.state === 'failed' ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={pair.state !== 'known'}
            aria-busy={pair.state === 'checking' || undefined}
            onClick={() => pair.state === 'known' && openDock('conflict', pair.key)}
          >
            {/* Both labels share the button's place, so its width never changes. */}
            <span className="grid">
              <span aria-hidden className="invisible col-start-1 row-start-1">
                Compare and decide
              </span>
              <span
                className={cn(
                  'col-start-1 row-start-1',
                  pair.state === 'checking' &&
                    'animate-pulse rounded-sm bg-foreground/12 text-transparent',
                )}
              >
                {label}
              </span>
            </span>
          </Button>
        )
      }
    >
      Disagrees with “{other.title}”.{' '}
      {pair.state === 'known' ? (
        pair.asked > 0 &&
        `Agents say Conflict for ${pair.asked} ${pair.asked === 1 ? 'question' : 'questions'} this week.`
      ) : pair.state === 'failed' ? (
        "Not checked who can decide it: it didn't load. Don't settle it yet."
      ) : (
        // The sentence's own shape, so the line wraps as it will once the count is in.
        <span className="animate-pulse rounded-sm bg-foreground/12 box-decoration-clone text-transparent">
          Agents say Conflict for 00 questions this week.
          <span className="sr-only">Checking who can decide it.</span>
        </span>
      )}
    </PeekAttention>
  )
}

/** The quick view of an item the list has no row for yet: its shape until its own read answers. */
function PeekLoading() {
  const shown = useAfter(true)
  return (
    <DockFrame title="Context">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading"
        className={cn('flex flex-col gap-3 px-4 pt-6 @md:px-5', !shown && 'invisible')}
      >
        <PeekPending className="h-5 w-3/4" />
        <PeekPending className="h-4 w-full" />
        <PeekPending className="h-4 w-2/3" />
        <PeekAttention icon={LoaderCircleIcon} checking>
          Checking whether another item disagrees…
        </PeekAttention>
      </div>
    </DockFrame>
  )
}
