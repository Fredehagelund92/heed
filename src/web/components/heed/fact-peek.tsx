import * as React from 'react'
import { and } from '@/lib/utils'
import {
  ArchiveIcon,
  ArrowLeftRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
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
import { MentionText } from '@/components/heed/mention-chip'

// The context quick view: the note, one closed Details and a toolbar under it. Title once, the
// words, its domain, who owns it and whether it is still right, where it comes from, the one
// action. One attention line only when a decision is needed (a flag, an overlap, an overdue check),
// with one button; the choice itself is made on the page. What agents get, history and the full
// source are not here.

export function FactPeek({ id }: { id: string }) {
  const listed = useFact(id)
  // The item's own read has its text, source and quote; the list's row shows while it loads.
  const read = useQuery(itemPageQuery(id)).data
  const fact = read?.item ?? listed
  const history = read?.history ?? []
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
  const pair = useQuery({
    ...conflictQuery(`${id}.${overlap?.id ?? ''}`),
    enabled: !!overlap,
  }).data
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
    <PeekAttention
      icon={ArrowLeftRightIcon}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => openDock('conflict', pair?.key ?? `${fact.id}.${overlap.id}`)}
        >
          {pair && Object.values(pair.rights).some(Boolean)
            ? 'Compare and decide'
            : 'Compare the two'}
        </Button>
      }
    >
      Disagrees with “{overlap.title}”.
      {pair &&
        pair.asked > 0 &&
        ` Agents say Conflict for ${pair.asked} ${pair.asked === 1 ? 'question' : 'questions'} this week.`}
    </PeekAttention>
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
        </PeekBand>
        <PeekBand flush>
          <PeekFold summary={detailsSummary(fact)}>
            <DetailsBody fact={fact} />
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
