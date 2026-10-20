import { useId, type ReactNode } from 'react'
import type { ProposalEvent } from '@/api'
import { Markdown } from '@/components/form/markdown'
import { LockIcon, MessageSquareIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/person-avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoment } from '@/lib/library'
import { discussionOf, discussionRoleNames } from '@/lib/proposal-activity'
import { ReplyComposer } from './reply-composer'
import { productName } from '@/lib/brand'

/*
  A proposal's discussion (FR-222): the comments of its proposer and its reviewers, oldest
  first, so it reads as a conversation, each with the person, their part in the review and when;
  then the composer while the proposal is open. A comment is the small Markdown of item text
  without headings or mentions. A request for changes may carry a comment too: it shows here,
  marked as such. Only the proposer, the reviewers of the proposal's domain and administrators
  read it (the service holds the same rule); the history keeps a line for each comment.
*/

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase())
    .slice(0, 2)
    .join('')

export type DiscussionComposer = {
  proposal: { id: string; revision: number }
  /** "Reply to Jon", "Comment for Maria". */
  title: string
  /** Who is told: "Jon is notified in the app." */
  notice: string
  /** The send button's words. */
  action: string
}

export function Discussion({
  events,
  pending,
  proposerId,
  area,
  nameOf,
  viewerId,
  audience,
  composer,
  headingLevel = 2,
}: {
  events: readonly ProposalEvent[] | undefined
  pending: boolean
  proposerId: string
  area: { ownerIds: readonly string[] } | null
  nameOf: (personId: string) => string | null
  viewerId: string
  /** Who reads the discussion, in one sentence. */
  audience: string
  /** The composer, while the person may comment; null otherwise. */
  composer: DiscussionComposer | null
  headingLevel?: 2 | 3
}) {
  const headingId = useId()
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const comments = discussionOf(events ?? [], { proposerId, area })
  let body: ReactNode
  if (pending && !events)
    body = (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Loading the discussion</span>
        <Skeleton className="h-16 w-full" />
      </div>
    )
  else if (!comments.length)
    body = (
      <p data-slot="discussion-empty" className="text-dense text-muted-foreground">
        {composer
          ? 'No comments yet. Ask a question or say what should change before a decision.'
          : 'No comments.'}
      </p>
    )
  else
    body = (
      <ol aria-label="Comments" className="flex flex-col gap-4">
        {comments.map((comment) => {
          const name = comment.actorId ? (nameOf(comment.actorId) ?? 'Someone') : productName
          const you = comment.actorId === viewerId
          return (
            <li key={comment.id} data-slot="comment" className="flex gap-3">
              <PersonAvatar person={{ name, initials: initialsOf(name) }} size="sm" decorative />
              <article
                aria-label={`${you ? 'You' : name}, ${formatMoment(comment.at, 'long')}`}
                className="flex min-w-0 flex-1 flex-col gap-2"
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dense">
                  <span className="font-bold">{you ? 'You' : name}</span>
                  <Badge size="sm" form="outline" tone="neutral">
                    {discussionRoleNames[comment.role]}
                  </Badge>
                  <time
                    dateTime={comment.at}
                    title={formatMoment(comment.at, 'long')}
                    className="text-caption text-muted-foreground tabular-nums"
                  >
                    {formatMoment(comment.at)}
                  </time>
                  {comment.withRequest ? (
                    <Badge size="sm" form="soft" tone="warning" icon={MessageSquareIcon}>
                      With the request for changes
                    </Badge>
                  ) : null}
                </p>
                <div className="rounded-lg border bg-card px-4 py-3">
                  <Markdown source={comment.text} light className="gap-2 text-dense" />
                </div>
              </article>
            </li>
          )
        })}
      </ol>
    )
  return (
    <section aria-labelledby={headingId} data-slot="discussion" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Heading id={headingId} className="flex items-center gap-2 text-large font-bold">
          Discussion
          {comments.length ? (
            <span className="text-caption font-normal text-muted-foreground tabular-nums">
              {comments.length}
            </span>
          ) : null}
        </Heading>
        <p className="flex items-start gap-2 text-caption text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
          {audience}
        </p>
      </div>
      {body}
      {composer ? (
        <ReplyComposer
          key={composer.proposal.id}
          proposal={composer.proposal}
          title={composer.title}
          notice={composer.notice}
          action={composer.action}
        />
      ) : null}
    </section>
  )
}
