import * as React from 'react'
import { MessageSquarePlusIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { commentActions, useComments, useSubjectReactions } from '@/lib/comments'
import type { Subject } from '@/data/comments'
import { Composer } from './composer'
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
// takes the edges of the column it sits in (the review's reading column, the item's sheet).

export function CommentBox({
  subject,
  me,
  owners,
  note,
  className,
}: {
  subject: Subject
  me: string
  /** The owners of the domain: their comments say "Owner", since their word settles it. */
  owners: string[]
  /** One more line under the heading, as on an agent's suggestion. */
  note?: React.ReactNode
  className?: string
}) {
  const comments = useComments(subject)
  const reactions = useSubjectReactions(subject)
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
    post: (content, parentId) => commentActions.post(subject, me, content, { parentId }),
    react: (id, emoji) => commentActions.react(subject, id, emoji, me),
    edit: (id, content) => commentActions.edit(subject, id, content),
    remove: (id) => commentActions.remove(subject, id),
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
              onReact={(e) => commentActions.reactToSubject(subject, e, me)}
            />
            <ReactionPicker onPick={(e) => commentActions.reactToSubject(subject, e, me)} />
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
            <CommentThread key={c.id} comment={c} actions={actions} />
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
