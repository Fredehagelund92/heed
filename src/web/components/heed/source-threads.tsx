import * as React from 'react'
import type { JSONContent } from '@tiptap/core'
import { toast } from 'sonner'
import { CircleCheckIcon, CircleDotIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Composer } from '@/components/templates/comment-box/composer'
import { CommentThread, type ThreadActions } from '@/components/templates/comment-box/thread'
import type { CommentItem } from '@/components/templates/comment-box/types'
import { countComments, plainOf } from '@/components/templates/comment-box/utils'
import { useCommentActions, useComments } from '@/lib/comments'
import { cn, midSentence } from '@/lib/utils'
import type { Subject } from '@/model/comments'
import {
  onVersions,
  placeKey,
  placeLabel,
  placeOf,
  type ReviewVersions,
  type SourcePlace,
} from '@/model/source-places'
import { fieldKeys } from '@/model/review-fields'
import type { SourceNotes } from './source-review'

// Threads on a line or a field of a review's source (design contract, section 5.3). A thread
// hangs under its line or field row, its left rule in the accent while it is open and grey once
// resolved, its state said in words beside an icon; a resolved thread folds to that one line.
// Replies, mentions and reactions are the comment box's own parts. The rail sums up the open ones
// and steps to each. A thread written against an earlier version of the suggestion is shown with
// the other comments, under the change, saying so. Open or resolved, a thread never holds Publish,
// and agents never read any of it.

/** A thread's place in reading order: the fields as the table lists them, then the lines. */
function order(c: CommentItem) {
  const at = placeOf(c.anchor!)
  return 'field' in at
    ? fieldKeys.indexOf(at.field)
    : fieldKeys.length + at.line * 2 + (at.side === 'before' ? 0 : 1)
}

/**
 * The threads on a review's source: those written against the two versions it compares, by
 * place, open and resolved, in reading order; and those written against an earlier version.
 */
export function useSourceThreads(subject: Subject, versions: ReviewVersions) {
  const comments = useComments(subject)
  const { before, after } = versions
  return React.useMemo(() => {
    const here = new Map<string, CommentItem[]>()
    const earlier: CommentItem[] = []
    for (const c of comments) {
      if (!c.anchor) continue
      if (!onVersions(c.anchor, { before, after })) {
        earlier.push(c)
        continue
      }
      const key = placeKey(placeOf(c.anchor))
      here.set(key, [...(here.get(key) ?? []), c])
    }
    const all = [...here.values()].flat().sort((a, b) => order(a) - order(b))
    return {
      here,
      earlier,
      open: all.filter((c) => !c.resolved),
      resolved: all.filter((c) => c.resolved),
    }
  }, [comments, before, after])
}

/** The open and resolved threads, counted: "2 open, 1 resolved". */
export function threadCount(open: number, resolved: number) {
  const parts = [open && `${open} open`, resolved && `${resolved} resolved`].filter(Boolean)
  return parts.join(', ')
}

const placeOn = (key: string) =>
  document.querySelector<HTMLElement>(`[data-source-place="${CSS.escape(key)}"]`)

/** Opens a thread, scrolled to at once and in focus. */
export function goToThread(id: string) {
  const el = document.getElementById(`thread-${id}`)
  el?.scrollIntoView({ block: 'center' })
  el?.focus({ preventScroll: true })
}

/** One thread under its line or field: its state, Resolve or Reopen, and the thread itself. */
function PlaceThread({
  thread,
  at,
  actions,
  onResolve,
}: {
  thread: CommentItem
  at: SourcePlace
  actions: ThreadActions
  onResolve: (resolved: boolean) => void
}) {
  const resolved = !!thread.resolved
  // A thread folds as it is resolved and opens as it is reopened; in between, the person decides.
  const [shown, setShown] = React.useState(!resolved)
  const [was, setWas] = React.useState(resolved)
  if (was !== resolved) {
    setWas(resolved)
    setShown(!resolved)
  }
  const n = countComments([thread])
  const state = thread.resolved
    ? `Resolved by ${thread.resolved.by}, ${midSentence(thread.resolved.when)}`
    : thread.reopened
      ? `Open, reopened by ${thread.reopened.by}, ${midSentence(thread.reopened.when)}`
      : 'Open'
  return (
    <section
      id={`thread-${thread.id}`}
      tabIndex={-1}
      aria-label={`${placeLabel(at)}: ${thread.author}'s thread, ${resolved ? 'resolved' : 'open'}`}
      className={cn(
        'flex flex-col border-l-2 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring',
        resolved ? 'border-muted-foreground/50' : 'border-primary',
      )}
    >
      <header className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {resolved ? (
          <CircleCheckIcon aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <CircleDotIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
        )}
        <span className="min-w-0">{state}</span>
        <span className="ml-auto flex items-center gap-1">
          {resolved && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              aria-expanded={shown}
              onClick={() => setShown((s) => !s)}
            >
              {shown ? 'Hide the thread' : n === 1 ? 'Show the comment' : `Show the ${n} comments`}
            </Button>
          )}
          <Button variant="outline" size="xs" onClick={() => onResolve(!resolved)}>
            {resolved ? 'Reopen' : 'Resolve'}
          </Button>
        </span>
      </header>
      {shown && (
        <ul className="animate-in duration-(--dur-2) fade-in-0">
          <CommentThread comment={thread} actions={actions} className="py-2" />
        </ul>
      )}
    </section>
  )
}

/**
 * Comments on a review's source: the threads under each line and field, a composer where one is
 * started, and how to start one. Pass the result to FieldsDiff and TextDiff as their `notes`.
 */
export function useSourceNotes({
  subject,
  versions,
  me,
  owners,
}: {
  subject: Subject
  versions: ReviewVersions
  me: string
  owners: string[]
}): SourceNotes {
  const threads = useSourceThreads(subject, versions)
  const commentActions = useCommentActions()
  const [composing, setComposing] = React.useState<string | null>(null)
  // What was written where, kept when the composer closes with Esc or Cancel, or a post fails.
  const drafts = React.useRef<Record<string, JSONContent>>({})
  const [posting, setPosting] = React.useState(false)

  const actions: ThreadActions = {
    me,
    owners,
    post: (content, parentId) => void commentActions.post(subject, content, { parentId }),
    react: (id, emoji) => void commentActions.react(subject, id, emoji),
    edit: (id, content) => void commentActions.edit(subject, id, content),
    remove: (id) => void commentActions.remove(subject, id),
  }
  const close = (key: string) => {
    setComposing(null)
    // Back to the line or field it was written on, so C and the arrows go on from there.
    requestAnimationFrame(() => placeOn(key)?.focus({ preventScroll: true }))
  }
  const resolve = (thread: CommentItem, resolved: boolean) => {
    commentActions.resolve(subject, thread.id, resolved).then(
      () => {
        if (resolved)
          toast('Resolved', { description: 'It stays here, folded, for anyone who looks.' })
      },
      () => toast.error(resolved ? "The thread wasn't resolved" : "The thread wasn't reopened"),
    )
  }

  return {
    holds: (at) => threads.here.has(placeKey(at)) || composing === placeKey(at),
    comment: (at) => setComposing(placeKey(at)),
    under: (at) => {
      const key = placeKey(at)
      const list = threads.here.get(key) ?? []
      if (!list.length && composing !== key) return null
      return (
        <div className="flex flex-col gap-3 border-y bg-background p-3 first:border-t-0 last:border-b-0">
          {list.map((t) => (
            <PlaceThread
              key={t.id}
              thread={t}
              at={at}
              actions={actions}
              onResolve={(resolved) => resolve(t, resolved)}
            />
          ))}
          {composing === key && (
            <Composer
              author={me}
              autoFocus
              label={`Comment on ${placeLabel(at).toLowerCase()}`}
              placeholder={'field' in at ? 'Comment on this field' : 'Comment on this line'}
              initialContent={drafts.current[key]}
              clearOnPost={false}
              postDisabled={posting}
              onDraft={(d) => {
                if (d) drafts.current[key] = d
                else delete drafts.current[key]
              }}
              onCancel={() => close(key)}
              onPost={(content) => {
                setPosting(true)
                commentActions
                  .post(subject, content, { anchor: { ...versions, ...at } })
                  .then(
                    () => {
                      delete drafts.current[key]
                      close(key)
                    },
                    () =>
                      toast.error("Your comment wasn't saved", {
                        description: 'Your words are still in the box. Try again.',
                      }),
                  )
                  .finally(() => setPosting(false))
              }}
            />
          )}
        </div>
      )
    },
  }
}

/**
 * The rail's summary of the threads on the source: how many are open and resolved, updated as
 * people write, and each open one, to go to. It never says Publish waits for them: it doesn't.
 */
export function SourceThreadsSummary({
  subject,
  versions,
  onGo = goToThread,
}: {
  subject: Subject
  versions: ReviewVersions
  /** Goes to a thread, by its first comment's id. */
  onGo?: (id: string) => void
}) {
  const id = React.useId()
  const { open, resolved, earlier } = useSourceThreads(subject, versions)
  const count = threadCount(open.length, resolved.length)
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-2 border-b p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={`${id}-h`} className="text-sm font-medium">
          Threads on lines and fields
        </h3>
        <p aria-live="polite" className="text-xs text-muted-foreground tabular-nums">
          {count || 'None yet'}
        </p>
      </div>
      {open.length > 0 ? (
        <ul className="-mx-2 flex flex-col">
          {open.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onGo(c.id)}
                className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-xs text-muted-foreground">
                  {placeLabel(placeOf(c.anchor!))}, {c.author}
                </span>
                <span className="line-clamp-2 text-sm">
                  {c.deleted ? 'Comment deleted' : plainOf(c.content)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          {resolved.length ? 'Every thread here is resolved. ' : ''}
          Comment on a line or a field with the + beside it or C, or tap it on a phone.
        </p>
      )}
      {earlier.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {earlier.length === 1 ? 'One thread was' : `${earlier.length} threads were`} written on an
          earlier version: see Comments, under the change.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Open threads never hold Publish.</p>
    </section>
  )
}
