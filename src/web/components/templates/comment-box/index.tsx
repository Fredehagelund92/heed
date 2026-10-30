import * as React from 'react'
import { toast } from 'sonner'
import { MessageSquarePlusIcon } from '@/components/icons'
import { cn, midSentence } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  useCommentActions,
  useComments,
  useSubjectReactions,
  useWithdrawable,
} from '@/lib/comments'
import type { CommentAnchor, Subject } from '@/model/comments'
import { onVersions, placeLabel, placeOf, type ReviewVersions } from '@/model/source-places'
import { Composer } from './composer'
import type { CommentItem } from './types'
import { CommentThread, ReactionChips, ReactionPicker, type ThreadActions } from './thread'
import { countComments } from './utils'
import { ShowMoreButton } from '@/components/heed/show-more'
import { useShowMore } from '@/hooks/use-show-more'
import '@/components/editor/style.css'
import '@/components/static-renderer/style.css'

// The Comments box: the editorcn Comment Box's anatomy (a heading, the threads, a composer) laid
// out flat in the Efferd style, with no card around it. Reactions to the thing itself sit on the
// heading's row. An empty box stays folded to its heading until someone adds a comment, and the
// rule about agents is printed under the heading, always. It has no side padding of its own: it
// takes the edges of the column it sits in (the review's reading column, the item's sheet). In a
// review, a thread on a line or a field of the source hangs there instead; one written against an
// earlier version of the suggestion stays here, saying where it was, as every such thread does in
// the Inbox.

/**
 * Where a thread on a review's source hangs, said above it where it is shown apart from the
 * source: in the Inbox, or in the review when it was written on an earlier version.
 */
const whereItHangs = (anchor: CommentAnchor, earlier: boolean) =>
  `On ${placeLabel(placeOf(anchor)).toLowerCase()}${earlier ? ', of an earlier version' : ''}`

/** The state of a thread on a line or a field, with Resolve or Reopen, above it where it is shown apart. */
function AnchoredState({
  comment,
  earlier,
  onResolve,
}: {
  comment: CommentItem
  earlier: boolean
  onResolve: (resolved: boolean) => void
}) {
  const resolved = !!comment.resolved
  const state = comment.resolved
    ? `Resolved by ${comment.resolved.by}, ${midSentence(comment.resolved.when)}`
    : comment.reopened
      ? `Open, reopened by ${comment.reopened.by}, ${midSentence(comment.reopened.when)}`
      : 'Open'
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="min-w-0">
        {whereItHangs(comment.anchor!, earlier)}. {state}
      </span>
      <Button variant="outline" size="xs" className="ml-auto" onClick={() => onResolve(!resolved)}>
        {resolved ? 'Reopen' : 'Resolve'}
      </Button>
    </div>
  )
}

export function CommentBox({
  subject,
  me,
  owners,
  note,
  versions,
  className,
}: {
  subject: Subject
  /** A review's two versions: its threads on a line or a field of them hang on the source. */
  versions?: ReviewVersions
  me: string
  /** The owners of the domain: their comments say "Owner", since their word settles it. */
  owners: string[]
  /** One more line under the heading, as on an agent's suggestion. */
  note?: React.ReactNode
  className?: string
}) {
  const all = useComments(subject)
  const comments = React.useMemo(
    () => (versions ? all.filter((c) => !c.anchor || !onVersions(c.anchor, versions)) : all),
    [all, versions],
  )
  const reactions = useSubjectReactions(subject)
  const withdrawable = useWithdrawable(subject)
  const commentActions = useCommentActions()
  const [adding, setAdding] = React.useState(false)
  const total = countComments(comments)
  // A long discussion shows its newest five threads; earlier ones on request, above them.
  const newestFirst = [...comments].reverse()
  const { shown, more, next, showMore } = useShowMore(newestFirst, 5, 10)
  const visible = [...shown].reverse()
  const open = comments.length > 0 || adding

  const actions: ThreadActions = {
    me,
    owners,
    post: (content, parentId) => void commentActions.post(subject, content, { parentId }),
    react: (id, emoji) => void commentActions.react(subject, id, emoji),
    edit: (id, content) => void commentActions.edit(subject, id, content),
    remove: (id) => void commentActions.remove(subject, id),
    ...(withdrawable
      ? { withdraw: (id, withdrew) => void commentActions.withdraw(subject, id, withdrew) }
      : {}),
  }

  const resolve = (thread: CommentItem, resolved: boolean) => {
    commentActions.resolve(subject, thread.id, resolved).then(
      () => {
        if (resolved) toast('Resolved')
      },
      () => toast.error(resolved ? "The thread wasn't resolved" : "The thread wasn't reopened"),
    )
  }

  return (
    <section aria-labelledby={`comments-${subject}`} className={cn('flex flex-col', className)}>
      <div className="pb-4">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <h2
            id={`comments-${subject}`}
            className="flex items-baseline gap-2 text-base leading-snug font-medium"
          >
            Comments
            {total > 0 && (
              <span className="text-sm font-normal text-muted-foreground tabular-nums">
                {total}
              </span>
            )}
          </h2>
          <div
            className="flex flex-wrap items-center justify-end gap-1"
            aria-label="Reactions"
            role="group"
          >
            <ReactionChips
              reactions={reactions}
              me={me}
              onReact={(e) => void commentActions.reactToSubject(subject, e)}
            />
            <ReactionPicker onPick={(e) => void commentActions.reactToSubject(subject, e)} />
            {!open && (
              <Button variant="outline" size="sm" className="ml-1" onClick={() => setAdding(true)}>
                <MessageSquarePlusIcon data-icon="inline-start" />
                Add a comment
              </Button>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Comments are not part of what agents get.
        </p>
        {note && <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{note}</p>}
      </div>
      {more > 0 && (
        <div className="border-t py-1.5">
          <ShowMoreButton more={more} next={next} onClick={showMore} label="earlier comments" />
        </div>
      )}
      {comments.length > 0 && (
        <ul className="border-t">
          {visible.map((c) => (
            <CommentThread
              key={c.id}
              comment={c}
              actions={actions}
              context={
                c.anchor && (
                  <AnchoredState
                    comment={c}
                    earlier={!!versions}
                    onResolve={(resolved) => resolve(c, resolved)}
                  />
                )
              }
            />
          ))}
        </ul>
      )}
      {open && (
        <div className="border-t pt-4">
          <Composer
            author={me}
            autoFocus={adding && comments.length === 0}
            label="Write a comment"
            placeholder="Add a comment"
            onCancel={comments.length === 0 ? () => setAdding(false) : undefined}
            onPost={(content) => {
              actions.post(content)
              setAdding(false)
            }}
          />
        </div>
      )}
    </section>
  )
}
