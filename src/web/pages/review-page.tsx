import * as React from 'react'
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  EyeIcon,
  KeyboardIcon,
  ListIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from '@/components/icons'
import { toast } from 'sonner'
import { and, cn, midSentence } from '@/lib/utils'
import { Statement } from '@/components/heed/conflict-pair'
import { comparePair, sharedWords, type Compared } from '@/lib/differing-words'
import { SIDE_BY_SIDE } from '@/lib/conflict'
import { ownersOf } from '@/model/people'
import type { Fact } from '@/model/items'
import { PersonAvatar, StateLine } from '@/components/heed/bits'
import { ChangeBlock, KindLabel } from '@/components/heed/review-parts'
import { ClaimCheck, Rewrite } from '@/components/heed/review-page-parts'
import { Mark } from '@/components/heed/mark'
import { ToolLogo } from '@/components/heed/tool-logo'
import { ResizableAside } from '@/components/resizable-aside'
import { Panel } from '@/components/heed/panel'
import { SiteHeader } from '@/components/site-header'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { connectorById } from '@/model/integrations'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { JSONContent } from '@tiptap/core'
import { isTyping, pageKey } from '@/lib/keys'
import { open as openOverlay } from '@/lib/events'
import { useSend, type Sender } from '@/lib/send'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { flushSync } from 'react-dom'
import { TOUCH } from '@/lib/touch'
import { changeWords, diffStats, lineDiff } from '@/lib/line-diff'
import { FieldsDiff, TextDiff, type SourceNotes } from '@/components/heed/source-review'
import { goToThread, SourceThreadsSummary, useSourceNotes } from '@/components/heed/source-threads'
import { placeFromKey } from '@/model/source-places'
import { fieldRows } from '@/model/review-fields'
import { useSideChoice } from '@/lib/side-panel'
import { useLinksEnabled } from '@/lib/links-switch'
import { Composer } from '@/components/templates/comment-box/composer'
import { CommentBox } from '@/components/templates/comment-box'
import { useCommentActions } from '@/lib/comments'
import { ChoiceGroup, TextSwitch, ViewToggle } from '@/components/heed/switches'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DRAFT_LABEL } from '@/model/ask'
import { useInbox, useReviews, useSavedQuestions, useWrite } from '@/api/queries'
import { checkDraft, itemOfReview, savesQuestion } from '@/lib/saved-check'
import { SavedLine } from '@/components/obs/saved-line'
import { careLine, marks, readiness, type Relation, type Review } from '@/model/review'
import {
  clashOutcome,
  needsCare,
  publishedWords,
  readTime,
  relationText,
} from '@/model/review-page'
import { useIsMobile } from '@/hooks/use-mobile'
import { navigate } from '@/lib/router'
import { useDomains, useFacts } from '@/lib/workspace'
import { useMe } from '@/lib/workspace'
import { Summary } from '@/pages/review'
import { TruncatedText } from '@/components/heed/truncated'
import { plainText } from '@/lib/mentions'
import { useWide } from '@/hooks/use-wide'

// The full-screen review, where you work: the queue of waiting suggestions on the left, the change
// in the middle, Try it and the decision on the right. It loads on its own when first opened.

/* ---------- the full screen ---------- */

/** The folded queue: a slim rail whose button opens it again, with how many are waiting. */
function QueueRail({ count, onShow }: { count: number; onShow: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-1 pt-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Show the queue, ${count} waiting`}
              className="size-9"
              onClick={onShow}
            />
          }
        >
          <ListIcon />
        </TooltipTrigger>
        <TooltipContent side="right">Show the queue</TooltipContent>
      </Tooltip>
      <span aria-hidden className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
  )
}

/** The queue of waiting suggestions, grouped by who sent them. */
function Queue({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const state = useInbox()
  const reviews = useReviews()
  const write = useWrite()
  const senders = [...new Set(reviews.map((r) => r.from))]
  // Only what the owner has read: publishing signs their name on it.
  // Only what needs no look of its own: no claim, overlap, retirement, unchecked value or new link.
  const ready = reviews.filter((r) => !state.done[r.id] && readiness(r).bulk)
  const read = ready.filter((r) => state.reviewed[r.id])
  const apart = reviews.filter((r) => !state.done[r.id] && !readiness(r).bulk).length
  const opened = ready.filter((r) => state.opened[r.id] && !state.reviewed[r.id])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Waiting suggestions" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {senders.map((from) => {
          const items = reviews.filter((r) => r.from === from)
          const head = items[0]!
          const agent = head.agent
          return (
            <section key={from} className="pb-3">
              <h2 className="flex items-center gap-2 px-2 pb-1.5 text-xs font-medium text-muted-foreground">
                {head.synced ? (
                  <ToolLogo c={connectorById('google-drive')!} size="sm" />
                ) : head.drafted ? (
                  <span
                    aria-hidden
                    className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60"
                  >
                    <CircleDashedIcon className="size-3" />
                  </span>
                ) : (
                  <PersonAvatar name={from} size={20} />
                )}
                <span className="truncate">
                  {from}
                  {agent ? ', via an agent' : ''}
                </span>
                <span className="ml-auto tabular-nums">{items.length}</span>
              </h2>
              <ul className="flex flex-col gap-px">
                {items.map((r) => {
                  const done = state.done[r.id]
                  const care = needsCare(r)
                  const wasRead = state.reviewed[r.id]
                  const on = r.id === current
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        aria-current={on ? 'true' : undefined}
                        onClick={() => onPick(r.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50',
                          on && 'bg-muted shadow-hairline',
                          done && 'text-muted-foreground',
                        )}
                      >
                        {done ? (
                          <CheckIcon aria-label="Done" className="size-3.5 shrink-0" />
                        ) : care ? (
                          <TriangleAlertIcon
                            aria-label={careLine(r) ?? 'Needs care'}
                            className="size-3.5 shrink-0 text-caution-icon"
                          />
                        ) : on ? (
                          <CircleIcon
                            aria-label="You are here"
                            className="size-3.5 shrink-0 fill-primary text-primary"
                          />
                        ) : wasRead ? (
                          <CircleCheckIcon
                            aria-label="Read"
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                        ) : (
                          <CircleIcon
                            aria-hidden
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                        )}
                        <TruncatedText text={r.title} className="flex-1" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </nav>
      <div className="flex min-h-bar shrink-0 flex-col justify-center gap-1 border-t px-3 py-2">
        {/* Opened but not yet counted: the reviewer can say they read them, all at once. */}
        {opened.length > 0 && (
          <button
            type="button"
            onClick={() => opened.forEach((r) => void write('markReviewed', { id: r.id }))}
            className="inline-flex min-h-7 items-center self-center rounded-sm px-1 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Mark the {opened.length} I've opened as read
          </button>
        )}
        <PublishReady items={read} unread={ready.length - read.length} apart={apart} />
      </div>
    </div>
  )
}

/**
 * "Publish the 3 you've read": only suggestions the owner has read here (the whole change on
 * screen for a few seconds, or marked read), never one that needs care, nor a retirement, so
 * "Checked by" stays true for every one of them. It lists them before it publishes, and Undo puts
 * all of them back.
 */
function PublishReady({
  items,
  unread,
  apart,
}: {
  items: Review[]
  unread: number
  apart: number
}) {
  const write = useWrite()
  const [confirm, setConfirm] = React.useState(false)
  const sender = useSend()
  const n = items.length
  // Each one is published as a single Publish would, and Undo takes back exactly these, whatever else happened since.
  const publishAll = async () => {
    const { undo } = await write('publishReviews', { ids: items.map((r) => r.id) })
    setConfirm(false)
    toast(`Published ${n}`, {
      description:
        "Agents get them from the next question. The ones you haven't read are still waiting.",
      action: {
        label: 'Undo',
        onClick: () =>
          void write('undo', { token: undo }).then(() =>
            toast(`Back: ${n} waiting again`, { description: 'Nothing was published.' }),
          ),
      },
    })
  }
  const button = (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      disabled={!n || !sender.online}
      onClick={() => setConfirm(true)}
    >
      {n
        ? `Publish the ${n} you've read`
        : unread
          ? 'Read one to publish it'
          : 'Nothing else is ready'}
    </Button>
  )
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<span className="w-full" tabIndex={n && sender.online ? undefined : 0} />}
        >
          {button}
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {!sender.online ? "Offline: publishing waits until you're back. " : ''}
          {unread ? `${unread} more ${unread === 1 ? 'is' : 'are'} ready but not read yet. ` : ''}
          Only what you've read, so “Checked by” stays true.
          {apart
            ? ` ${apart} ${apart === 1 ? 'needs' : 'need'} a look of ${apart === 1 ? 'its' : 'their'} own first (a claim, a new link or an unchecked value) and ${apart === 1 ? 'stays' : 'stay'} out of it.`
            : ''}
        </TooltipContent>
      </Tooltip>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish the {n} you've read?</DialogTitle>
            <DialogDescription>
              Each goes out with you as the one who checked it. Undo puts all of them back.
            </DialogDescription>
          </DialogHeader>
          <ul aria-label="To publish" className="flex min-w-0 flex-col divide-y border-y text-sm">
            {items.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{r.from}</span>
              </li>
            ))}
          </ul>
          {sender.state === 'failed' && (
            <p role="alert" className="text-sm">
              <span className="font-medium">Couldn't publish them.</span>{' '}
              <span className="text-muted-foreground">Nothing changed. Try again.</span>
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={!sender.online}
              loading={sender.state === 'sending'}
              loadingLabel="Publishing…"
              onClick={() => sender.send(publishAll)}
            >
              {`Publish ${n}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Under the change: whether it counts as read for "Publish the ones you've read". The end of the
 * change on screen for long enough counts (longer for a longer change), with a quiet bar while it
 * does; so does Mark as read. Opening and leaving does not.
 */
function ReadMark({ r }: { r: Review }) {
  const state = useInbox()
  const write = useWrite()
  const ref = React.useRef<HTMLParagraphElement>(null)
  const read = !!state.reviewed[r.id]
  const counts = !state.done[r.id] && readiness(r).bulk
  const ms = readTime(r)
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el || read || !counts) return
    // The time left carries over when the end of the change scrolls away and back.
    let left = ms
    let since = 0
    let timer = 0
    const seen = new IntersectionObserver(([e]) => {
      window.clearTimeout(timer)
      if (e?.isIntersecting) {
        since = Date.now()
        timer = window.setTimeout(() => void write('markReviewed', { id: r.id }), left)
      } else if (since) left = Math.max(0, left - (Date.now() - since))
      setVisible(!!e?.isIntersecting)
    })
    seen.observe(el)
    return () => {
      seen.disconnect()
      window.clearTimeout(timer)
    }
    // The write only changes with the query client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id, read, counts, ms])
  if (!counts) return null
  return (
    <p
      ref={ref}
      className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
    >
      {read ? (
        <>
          <CircleCheckIcon aria-hidden className="size-3.5 text-primary" />
          Read. It can be published with the others you've read.
        </>
      ) : (
        <>
          <CircleIcon aria-hidden className="size-3.5" />
          Counts as read after about {Math.round(ms / 1000)} seconds here.
          <span
            aria-hidden
            className="h-0.5 w-16 overflow-hidden rounded-full bg-muted motion-reduce:hidden"
          >
            <span
              className="block h-full origin-left bg-primary/70"
              style={{
                animation: `readfill ${ms}ms linear forwards`,
                animationPlayState: visible ? 'running' : 'paused',
              }}
            />
          </span>
          <button
            type="button"
            onClick={() => void write('markReviewed', { id: r.id })}
            className="inline-flex min-h-6 items-center rounded-sm px-1 text-foreground underline decoration-foreground/30 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Mark as read
          </button>
        </>
      )}
    </p>
  )
}

/** Which view of the change shows: the source (the review), or a preview of the rich text. */
type View = 'source' | 'preview'

/**
 * N and P through the changes of the source, a field row or a place in the text, in reading
 * order: the one stepped to is ringed, focused and scrolled to at once (keys are instant).
 */
function ChangeSteps({
  within,
  count,
}: {
  within: React.RefObject<HTMLElement | null>
  count: number
}) {
  const [at, setAt] = React.useState(-1)
  // The first N goes to the first change, the first P to the last; then round and round.
  const step = React.useCallback(
    (d: 1 | -1) => setAt((a) => (a < 0 ? (d > 0 ? 0 : count - 1) : (a + d + count) % count)),
    [count],
  )
  // The stop stepped to is ringed, focused and in view, at once.
  React.useEffect(() => {
    const all = [...(within.current?.querySelectorAll<HTMLElement>('[data-review-change]') ?? [])]
    all.forEach((el, k) => el.toggleAttribute('data-active', k === at))
    all[at]?.focus({ preventScroll: true })
    all[at]?.scrollIntoView({ block: 'nearest' })
  }, [at, within])
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageKey(e)) return
      if (e.key === 'n') step(1)
      if (e.key === 'p') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])
  if (!count) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
      {at < 0 ? `${count} ${count === 1 ? 'change' : 'changes'}` : `Change ${at + 1} of ${count}`}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous change"
              onClick={() => step(-1)}
            />
          }
        >
          <ChevronUpIcon />
        </TooltipTrigger>
        <TooltipContent>
          Previous change <Kbd>P</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next change"
              onClick={() => step(1)}
            />
          }
        >
          <ChevronDownIcon />
        </TooltipTrigger>
        <TooltipContent>
          Next change <Kbd>N</Kbd>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

/**
 * The arrows and C on the source: Up and Down move between its lines and field rows (from a
 * change N or P stepped to, into it), and C comments on the one in focus, or on the last line of
 * the change in focus. Only while nobody types, and only with the focus in the source.
 */
function useSourceKeys(within: React.RefObject<HTMLElement | null>, notes: SourceNotes) {
  const comment = React.useRef(notes.comment)
  React.useEffect(() => {
    comment.current = notes.comment
  }, [notes.comment])
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageKey(e) || e.shiftKey) return
      const root = within.current
      const el = document.activeElement
      if (!root || !(el instanceof HTMLElement) || !root.contains(el)) return
      const places = [...root.querySelectorAll<HTMLElement>('[data-source-place]')]
      const change = el.matches('[data-review-change]:not([data-source-place])') ? el : null
      const inside = change ? places.filter((p) => change.contains(p)) : []
      const here = el.matches('[data-source-place]') ? el : null
      if (e.key === 'c') {
        const target = here ?? inside.at(-1)
        const at = target && placeFromKey(target.dataset.sourcePlace ?? '')
        if (!at) return
        e.preventDefault()
        comment.current(at)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const from = here ? places.indexOf(here) : -1
      const to = change
        ? e.key === 'ArrowDown'
          ? places.indexOf(inside[0]!)
          : places.indexOf(inside[0]!) - 1
        : here
          ? from + (e.key === 'ArrowDown' ? 1 : -1)
          : -1
      const next = places[to]
      if (!next) return
      e.preventDefault()
      next.focus({ preventScroll: true })
      next.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [within])
}

/**
 * The review of the source: what agents will read, exactly. The fields as a table, then the
 * stored text as a line diff. Two sides in, so the parts know nothing of suggestions; the
 * comments on its lines and fields come in as `notes`.
 */
function SourceReview({ r, me, owners }: { r: Review; me: string; owners: string[] }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const notes = useSourceNotes({ subject: `review:${r.id}`, versions: r.versions, me, owners })
  useSourceKeys(ref, notes)
  // Each changed field row and each changed place in the text is a stop.
  const { before, after } = r.fields
  const count =
    (before && after ? fieldRows(before, after).filter((x) => x.changed).length : 0) +
    diffStats(lineDiff(r.source.before, r.source.after)).changes
  return (
    <section aria-label="The source" ref={ref} className="flex flex-col gap-6 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-pretty text-muted-foreground">
          What agents will read, exactly.
          <span className="pointer-coarse:hidden">
            {' '}
            N and P step through the changes, the arrows through the lines, and C comments on one.
          </span>
        </p>
        <ChangeSteps within={ref} count={count} />
      </div>
      <FieldsDiff before={r.fields.before} after={r.fields.after} notes={notes} />
      <TextDiff before={r.source.before} after={r.source.after} notes={notes} />
    </section>
  )
}

/** The rich text with its changes marked, by kind: a second look, never the review itself. */
function Preview({ r }: { r: Review }) {
  const [showUnchanged, setShowUnchanged] = React.useState(false)
  const facts = useFacts()
  const { cards } = useInbox()
  const fact = facts.find((f) => f.id === itemOfReview(r, cards))
  return (
    <section aria-label="Preview" className="flex flex-col">
      <p className="pb-2 text-xs text-muted-foreground">
        A preview of the rich text, with the changes marked by kind. The source is what you review.
      </p>
      {r.rewrite && <Rewrite rewrite={r.rewrite} />}
      {r.blocks.length > 0 && (
        <div>
          {r.blocks.map((b, i) => (
            <ChangeBlock key={i} block={b} index={i} total={r.blocks.length} />
          ))}
        </div>
      )}
      {r.unchanged.length > 0 && (
        <div className="mt-2 border-t pt-4">
          <button
            type="button"
            aria-expanded={showUnchanged}
            onClick={() => setShowUnchanged((s) => !s)}
            className="flex items-center gap-1.5 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
          >
            {showUnchanged ? (
              <ChevronUpIcon className="size-4" aria-hidden />
            ) : (
              <ChevronDownIcon className="size-4" aria-hidden />
            )}
            {r.unchanged.length} fields unchanged: {r.unchanged.join(', ')}
          </button>
          {showUnchanged && fact && (
            <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm text-muted-foreground sm:grid-cols-(--cols-lead-36)">
              {r.unchanged.map((f) => (
                <React.Fragment key={f}>
                  <dt>{f}</dt>
                  <dd className="text-foreground/80">
                    {f === 'Title'
                      ? fact.title
                      : f === 'Where'
                        ? fact.where.join(', ')
                        : f === 'When'
                          ? fact.when
                          : f === "Don't conclude"
                            ? fact.dontConclude
                            : f === 'Source'
                              ? fact.source
                              : 'As before'}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * The change: first what must be decided or known, the same in every view (a withdrawal, the
 * item to archive, where a synced suggestion came from, the claim check, the clash gate), then
 * the source or its preview. No view can hide the gate.
 */
function TheChange({
  r,
  view,
  me,
  owners,
}: {
  r: Review
  view: View
  me: string
  owners: string[]
}) {
  const facts = useFacts()
  const { cards } = useInbox()
  const item = itemOfReview(r, cards)
  const fact = facts.find((f) => f.id === item)
  const gate = !!(r.claims || r.clash)
  return (
    <div className="flex flex-col">
      {r.retire?.withdrawn && (
        <section
          aria-label="What the thread decided"
          className="mb-6 flex flex-col gap-2 rounded-frame border border-dashed bg-muted/40 p-4"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <Undo2Icon aria-hidden className="size-4 text-muted-foreground" />
            Withdrawn in the comments
          </p>
          <blockquote className="text-sm italic">“{r.retire.withdrawn.quote}”</blockquote>
          <p className="text-xs text-muted-foreground">
            {r.retire.withdrawn.by}, {midSentence(r.retire.withdrawn.when)}. Archive is still
            possible, but no longer the suggestion.
          </p>
        </section>
      )}
      {r.retire && fact && (
        <section className="flex flex-col gap-3 py-2">
          <header className="flex items-center gap-2">
            <KindLabel kind="Removed" />
            <span className="text-xs text-muted-foreground">
              The context item, as agents get it now
            </span>
          </header>
          <div className="relative rounded-frame border p-4">
            <span
              className={cn(
                'absolute top-3 right-3 rotate-2 rounded-md border-2 px-2 py-0.5 text-xs font-semibold tracking-wide',
                r.retire.withdrawn
                  ? 'border-muted-foreground/50 text-muted-foreground'
                  : 'border-[var(--mark-del-line)] text-[var(--mark-del-line)]',
              )}
            >
              {r.retire.withdrawn ? 'Withdrawn' : 'Will be archived'}
            </span>
            <p className="pr-28 font-medium">{fact.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{plainText(fact.summary)}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{r.retire.used} questions</span> used it
            this week. {r.retire.checkFirst}
          </p>
        </section>
      )}
      {r.synced && <SyncedFrom r={r} />}
      {r.claims && <ClaimCheck claims={r.claims} from={r.from} drafted={!!r.drafted} />}
      {r.clash && <Clash r={r} />}
      <div className={cn((gate || r.retire) && 'mt-6 border-t pt-4')}>
        {view === 'source' ? <SourceReview r={r} me={me} owners={owners} /> : <Preview r={r} />}
      </div>
    </div>
  )
}

/** Where a synced suggestion came from: the document, the quote Heed kept, and what the source does not set. */
function SyncedFrom({ r }: { r: Review }) {
  const s = r.synced!
  return (
    <section className="mb-6 flex flex-col gap-3 border-b pb-6">
      <header className="flex items-center gap-2">
        <ToolLogo c={connectorById('google-drive')!} size="sm" />
        <span className="text-sm font-medium">From the document</span>
        <span className="text-xs text-muted-foreground">
          {s.folder} / {s.doc}, read {s.read.toLowerCase()}
        </span>
      </header>
      <blockquote className="rounded-frame bg-muted px-3 py-2 text-sm italic">
        “{s.quote}”
      </blockquote>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-(--cols-lead-40)">
        <dt className="text-muted-foreground">Set by the document</dt>
        <dd>The title, what agents should know, where and when it applies</dd>
        <dt className="text-muted-foreground">Not set by it</dt>
        <dd>Who owns it and who it's for: the owners of Sales decide when they publish</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        Only a link, the title and this quote are kept, never the document. If the document changes,
        its suggestion is replaced.
      </p>
    </section>
  )
}

const relations = (['replaces', 'disagree', 'unrelated'] as const).map((id) => ({
  id,
  ...relationText[id],
}))
/** The owner's answer for each live item the suggestion overlaps, by its id, and how to give one. */
const RelationContext = React.createContext<
  [Record<string, Relation>, (factId: string, r: Relation) => void]
>([{}, () => undefined])

/**
 * A clash with live context: the suggestion once, then each live item it overlaps beside its own
 * choice, so one answer never stands for another item.
 */
function Clash({ r }: { r: Review }) {
  const [answers, answer] = React.useContext(RelationContext)
  const facts = useFacts()
  const [unfold, setUnfold] = React.useState(false)
  const c = r.clash!
  const plain = (text: string) =>
    marks(text)
      .map((x) => x.text)
      .join('')
  const mine = plain(c.mine)
  // Ordered by the words each shares with the suggestion; the ones that share none overlap only by
  // where they apply, and fold into one line with one answer (FR-225 still asks for each).
  const items = c.items
    .map((item) => {
      const theirs = plain(item.theirs)
      return { item, theirs, pair: comparePair(mine, theirs), shared: sharedWords(mine, theirs) }
    })
    .sort((x, y) => y.shared - x.shared)
  const words = items.filter((x) => x.pair[0].how !== 'plain')
  const folded = unfold ? [] : items.filter((x) => x.pair[0].how === 'plain')
  const shown = unfold ? items : words
  return (
    <section className="flex flex-col gap-4 py-2">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-caution-icon" />
        <Mark role="needs" icon={false} className="text-sm">
          Overlaps live context
        </Mark>
        <span className="text-sm text-muted-foreground">
          {items.length > 1
            ? `${words.length} of ${items.length} say something about the same thing. Answer for each.`
            : 'Publish waits for your answer.'}
        </span>
      </header>
      {shown.map(({ item, pair }, i) => {
        const relation = answers[item.factId]
        const live = facts.find((f) => f.id === item.factId)
        return (
          <div key={item.factId} className="flex flex-col gap-3">
            {items.length > 1 && (
              <p className="text-sm">
                <span className="font-medium">
                  {i + 1} of {items.length}
                </span>{' '}
                <span className="text-xs text-muted-foreground">
                  {pair[0].how === 'plain'
                    ? 'Overlaps only by where it applies'
                    : 'Says about the same thing'}
                </span>
              </p>
            )}
            <ClashPair r={r} title={item.title} live={live} pair={pair} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs text-muted-foreground">How do they relate?</legend>
              <ChoiceGroup
                label={`How this relates to ${item.title}`}
                options={relations.map((x) => ({ value: x.id, label: x.label }))}
                value={relation}
                onChange={(v) => answer(item.factId, v)}
              />
              <p className="text-xs text-muted-foreground">
                {relation ? relationText[relation].hint : 'Choose one of the three.'}
              </p>
            </fieldset>
          </div>
        )
      })}
      {folded.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-frame border p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {folded.length} more {folded.length === 1 ? 'overlaps' : 'overlap'} only by where{' '}
              {folded.length === 1 ? 'it applies' : 'they apply'}
            </p>
            <p className="text-xs text-muted-foreground">
              {folded.map((x) => x.item.title).join('; ')}. No shared words.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setUnfold(true)}>
              Show
            </Button>
            {folded.every((x) => answers[x.item.factId] === 'unrelated') ? (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckIcon aria-hidden className="size-4" />
                Marked unrelated
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => folded.forEach((x) => answer(x.item.factId, 'unrelated'))}
              >
                Mark it unrelated
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** One overlap in the conflict view's split rows: this suggestion against the live item, with where it comes from. */
function ClashPair({
  r,
  title,
  live,
  pair,
}: {
  r: Review
  title: string
  live: Fact | undefined
  pair: [Compared, Compared]
}) {
  const domains = useDomains()
  const [ref, wide] = useWide<HTMLDivElement>(SIDE_BY_SIDE)
  const side = (
    label: string,
    heading: string,
    stmt: Compared,
    meta: React.ReactNode,
    second?: boolean,
  ) => (
    <div
      role="group"
      aria-label={`${label}: ${heading}`}
      className={cn('flex min-w-0 flex-col', second && (wide ? 'border-l' : 'border-t'))}
    >
      <div className="flex flex-col gap-0.5 border-b bg-muted/40 p-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{heading}</span>
      </div>
      <div className="border-b p-3">
        <Statement c={stmt} />
      </div>
      <div className="p-3 text-sm text-muted-foreground">{meta}</div>
    </div>
  )
  return (
    <div
      ref={ref}
      className={cn(
        'grid overflow-hidden rounded-frame border',
        wide ? 'grid-cols-2' : 'grid-cols-1',
      )}
    >
      {side('This suggestion', r.mode === 'new' ? 'New context' : r.title, pair[0], r.from)}
      {side(
        'Live now',
        title,
        pair[1],
        live ? (
          <>
            {domains[live.domain]?.name ?? live.domain}, owned by {and(ownersOf(live, domains))}.
            {live.checkedOn && ` Checked ${live.checkedOn}.`}{' '}
            {live.source && (
              <a
                href={live.source}
                target="_blank"
                rel="noreferrer"
                className="break-all text-primary underline underline-offset-4"
              >
                {live.source.replace(/^https?:\/\//, '')}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </>
        ) : null,
        true,
      )}
    </div>
  )
}

/** Try it: Heed's answer from the context, with the draft or as published. */
function TryItPanel({ r, now }: { r: Review; now?: string }) {
  const { cards } = useInbox()
  const [version, setVersion] = React.useState<'draft' | 'published'>('draft')
  const linksOn = useLinksEnabled()
  // Links the suggestion adds or removes: whether an answer would follow them.
  const linked = r.blocks.flatMap((b) => (b.kind === 'Link' && 'mention' in b ? [b.mention] : []))
  // Just published: the answer agents now give, in place of the draft.
  if (now)
    return (
      <section className="flex flex-col gap-3 border-b p-4">
        <h3 className="text-sm font-medium">Agents now say</h3>
        <p className="text-sm text-muted-foreground">“{r.tryIt.question}”</p>
        <div className="flex animate-in flex-col gap-2 rounded-frame border bg-muted/30 p-3 duration-(--dur-4) fade-in-0">
          <StateLine state={r.tryIt.after.state} sentence />
          <p className="text-sm leading-relaxed">{now}</p>
        </div>
      </section>
    )
  const a = version === 'draft' ? r.tryIt.after : r.tryIt.before
  const same = r.tryIt.after.text === r.tryIt.before.text
  return (
    <section className="flex flex-col gap-3 border-b p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">What agents will say</h3>
        <TextSwitch
          label="Which version answers"
          lead="Answer as"
          separator="-"
          className="text-xs"
          value={version}
          onChange={setVersion}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'published', label: 'Published' },
          ]}
        />
      </div>
      <p className="text-sm text-muted-foreground">“{r.tryIt.question}”</p>
      <div className="flex flex-col gap-2 rounded-frame border bg-muted/30 p-3">
        <StateLine state={a.state} draft={version === 'draft'} sentence>
          {version === 'draft' && a.state === 'grounded' ? DRAFT_LABEL : undefined}
        </StateLine>
        <p className="text-sm leading-relaxed">{a.text}</p>
        <p className="text-xs text-muted-foreground">
          {version === 'draft'
            ? 'What agents will say after you publish, from this draft.'
            : 'What agents say today, from the checked context.'}
        </p>
      </div>
      {same && <p className="text-xs text-muted-foreground">Same answer before and after.</p>}
      <p className="text-sm text-muted-foreground">
        {r.tryIt.reach} questions agents asked this week would get this version.
      </p>
      <SavedLine r={r} domain={cards.find((c) => c.id === r.id)?.domain ?? 'sales'} />
      {linked.map((m) => (
        <p key={m.id} className="text-sm text-muted-foreground">
          {m.change === 'removed'
            ? `The answer no longer links to ${m.label}.`
            : linksOn
              ? `The answer would follow the new link to ${m.label}, one step, to read what it means.`
              : `Following links is off, so the answer won't follow the new link to ${m.label}.`}
        </p>
      ))}
    </section>
  )
}

/** What a decision just did, shown in place until the next suggestion opens, with Undo. */
type Finished = {
  outcome: string
  message: string
  description: string
  /** Pass to `undo`: takes back exactly this decision. */
  undo: string
  now?: string
  next?: string
  /** What Undo puts back on this screen beyond the decision: a returned note, back in the editor. */
  afterUndo?: () => void
}

type DecisionProps = {
  r: Review
  onDone: (f: Finished) => void
  finished: Finished | null
  onUndo: () => void
  returning: boolean
  setReturning: (v: boolean) => void
  /** The note being written, kept when it closes, so Esc never loses it. */
  draft?: JSONContent
  onDraft: (d: JSONContent | null) => void
  /** Publish, archive and return go through it: offline they wait, and a failure says so with Retry. */
  sender: Sender
  /** Previous and next, for the phone bar (the header keeps them on wider screens). */
  onStep?: (d: 1 | -1) => void
  /** The wait before the next suggestion: paused while the pointer or focus is on the outcome. */
  onHold: (held: boolean) => void
  paused: boolean
  /** Reduced motion: nothing moves on its own, so the outcome offers Next instead. */
  reduced: boolean
  onNext: () => void
  /** The panel beside or under the change; on a phone, also a bar stuck to the bottom edge. */
  variant?: 'panel' | 'bar'
}

/** Ready, Overlaps and the decision: one primary action that fits the state. */
function Decision({
  r,
  onDone,
  finished,
  onUndo,
  returning,
  setReturning,
  draft,
  onDraft,
  sender,
  onStep,
  onHold,
  paused,
  reduced,
  onNext,
  variant = 'panel',
}: DecisionProps) {
  const hovered = React.useRef(false)
  const focused = React.useRef(false)
  const hold = (which: typeof hovered, on: boolean) => {
    which.current = on
    onHold(hovered.current || focused.current)
  }
  const state = useInbox()
  const reviews = useReviews()
  const me = useMe()
  const write = useWrite()
  const [answers] = React.useContext(RelationContext)
  // What the answers do, once every live item it overlaps has one.
  const settled = clashOutcome(r, answers)
  const first = r.from.split(' ')[0]
  const done = state.done[r.id]
  // The last thing tried, so Retry does it again.
  const [tried, setTried] = React.useState<'publish' | 'archive' | 'return' | 'close'>()
  const sending = sender.state === 'sending'
  const blockedBySend = !sender.online || sending
  const publish = () => {
    setTried('publish')
    sender.send(commitPublish)
  }
  const commitPublish = async () => {
    const { undo } = await write('publishReview', {
      id: r.id,
      ...(r.clash ? { relations: answers } : {}),
      saveQuestion: savesQuestion(r.id),
    })
    onDone({
      undo,
      outcome: 'Published',
      message: 'Published',
      description: publishedWords(r, answers),
      now: r.tryIt.after.text,
    })
  }
  const archive = () => {
    setTried('archive')
    sender.send(commitArchive)
  }
  const commitArchive = async () => {
    const { undo } = await write('archiveReview', { id: r.id })
    setConfirmArchive(false)
    onDone({
      undo,
      outcome: 'Archived',
      message: 'Archived',
      description: 'Agents stop getting it from the next question.',
    })
  }
  // Archiving takes context away from agents, so it always asks first, from the button or the key.
  const [confirmArchive, setConfirmArchive] = React.useState(false)
  // A withdrawn retirement closes: nothing changes, and the context item stays live.
  const close = () => {
    setTried('close')
    sender.send(async () => {
      const { undo } = await write('closeReview', { id: r.id })
      onDone({
        undo,
        outcome: 'Closed',
        message: 'Closed',
        description: 'Nothing changes: the context item stays live.',
      })
    })
  }
  const withdrawn = r.retire?.withdrawn
  const returnNote = React.useRef<JSONContent | null>(null)
  const commitReturn = async () => {
    const note = returnNote.current!
    // The note becomes the first comment; if the return fails, it stays in the editor.
    const { undo } = await write('returnReview', { id: r.id, note })
    onDraft(null)
    onDone({
      undo,
      outcome: 'Returned',
      message: `Returned to ${r.from}`,
      description: `${first} sees your note in the comments. Agents don't get the change, or the note.`,
      // Undo takes the note back out of the comments and keeps it as a draft.
      afterUndo: () => onDraft(note),
    })
  }
  const retry = () =>
    tried === 'close'
      ? close()
      : sender.send(
          tried === 'archive' ? commitArchive : tried === 'return' ? commitReturn : commitPublish,
        )
  const verb =
    tried === 'archive'
      ? 'archive it'
      : tried === 'return'
        ? 'return it'
        : tried === 'close'
          ? 'close it'
          : 'publish'
  // Offline nothing is sent; a failed try changed nothing. Both said at the button, never "Published".
  // The one action offline turns off, by name.
  const mainVerb = r.retire?.withdrawn ? 'Close' : r.retire ? 'Archive' : 'Publish'
  const failed = sender.state === 'failed'
  const problem = !sender.online ? (
    <p role="status" className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">You're offline.</span> {mainVerb} is off until
      you're back; nothing is lost.
    </p>
  ) : failed ? (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <span>
        <span className="font-medium">Couldn't {verb}.</span>{' '}
        <span className="text-muted-foreground">
          Nothing changed{tried === 'return' ? '; your note is kept' : ''}.
        </span>
      </span>
      {/* A failed note retries beside its editor; a failed decision retries from the buttons below. */}
      {tried === 'return' && (
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  ) : null
  const blocked = !!r.clash && !settled
  // What Command and Enter does here, if anything: the hint only shows when the key acts.
  const keyAction =
    done || finished || returning || blockedBySend
      ? null
      : withdrawn
        ? 'close'
        : r.retire
          ? 'archive'
          : blocked || (r.claims && !r.drafted)
            ? null
            : 'publish'
  // Command and Enter publishes, as the button says (the panel listens; the phone bar is the same decision).
  React.useEffect(() => {
    if (variant !== 'panel') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || !keyAction || isTyping(e.target)) return
      e.preventDefault()
      if (keyAction === 'archive') setConfirmArchive(true)
      else if (keyAction === 'close') close()
      else publish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // A draft that would make a saved question worse says so instead of a plain Ready; it never stops Publish.
  const drift = checkDraft(r, useSavedQuestions(), itemOfReview(r, state.cards))
  const base = readiness(r, settled ? { hint: settled } : null)
  const ready =
    drift?.look && !r.retire?.withdrawn
      ? r.retire
        ? {
            ok: false,
            bulk: false,
            title: 'To check before archiving',
            text: `${drift.look === 1 ? '1 saved question answers' : `${drift.look} saved questions answer`} from it and would hear nothing is written down. Archive anyway if you meant it.`,
          }
        : {
            ok: false,
            bulk: false,
            title: 'A draft to check',
            text: `${drift.look === 1 ? '1 saved question needs' : `${drift.look} saved questions need`} a look with it. Publish anyway if you meant it.`,
          }
      : base
  const ReadyIcon = ready.ok ? CircleCheckIcon : CircleDashedIcon

  // The buttons, the same in the panel and in the phone's bar.
  const actions = r.drafted ? (
    <>
      <Button variant="outline" size="sm" onClick={() => navigate('/context/new', { gap: r.id })}>
        Edit<span className="max-sm:hidden"> the draft</span>
      </Button>
      <Button
        size="sm"
        className="ml-auto"
        disabled={blockedBySend && !(sending && tried === 'publish')}
        loading={sending && tried === 'publish'}
        loadingLabel="Publishing…"
        onClick={publish}
      >
        Publish
      </Button>
    </>
  ) : r.claims ? (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={blockedBySend && !(sending && tried === 'publish')}
        loading={sending && tried === 'publish'}
        loadingLabel="Publishing…"
        onClick={publish}
      >
        Publish anyway
      </Button>
      <Button size="sm" className="ml-auto" disabled={sending} onClick={() => setReturning(true)}>
        Return<span className="max-sm:hidden"> with a note</span>
      </Button>
    </>
  ) : (
    <>
      {withdrawn ? (
        <Button
          variant="outline"
          size="sm"
          disabled={blockedBySend}
          onClick={() => setConfirmArchive(true)}
        >
          Archive anyway
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={sending} onClick={() => setReturning(true)}>
          Return<span className="max-sm:hidden"> with a note</span>
        </Button>
      )}
      {withdrawn ? (
        <Button
          size="sm"
          className="ml-auto"
          disabled={blockedBySend && !(sending && tried === 'close')}
          loading={sending && tried === 'close'}
          loadingLabel="Closing…"
          onClick={close}
        >
          Close the suggestion
        </Button>
      ) : r.retire ? (
        <Button
          size="sm"
          className="ml-auto"
          disabled={blockedBySend && !(sending && tried === 'archive')}
          loading={sending && tried === 'archive'}
          loadingLabel="Archiving…"
          onClick={() => setConfirmArchive(true)}
        >
          Archive<span className="max-sm:hidden"> the context item</span>
        </Button>
      ) : (
        <Button
          size="sm"
          className="ml-auto"
          disabled={blocked || (blockedBySend && !(sending && tried === 'publish'))}
          loading={sending && tried === 'publish'}
          loadingLabel="Publishing…"
          onClick={publish}
        >
          Publish
        </Button>
      )}
    </>
  )

  // After a failed decision there is one way forward: Try again, with Return beside it.
  const shownActions =
    failed && tried !== 'return' ? (
      <>
        <Button variant="outline" size="sm" onClick={() => setReturning(true)}>
          Return<span className="max-sm:hidden"> with a note</span>
        </Button>
        <Button size="sm" className="ml-auto" onClick={retry}>
          Try again
        </Button>
      </>
    ) : (
      actions
    )

  // What just happened, in place: what agents now say, a short countdown to the next one, and Undo.
  // The pointer or focus on it holds the wait, so Undo is never a race.
  const outcome = finished && (
    <div
      role="status"
      onPointerEnter={() => hold(hovered, true)}
      // The outcome appears under a still pointer (where Publish was): moving it toward Undo holds too.
      onPointerMove={() => !hovered.current && hold(hovered, true)}
      onPointerLeave={() => hold(hovered, false)}
      onFocus={() => hold(focused, true)}
      onBlur={() => hold(focused, false)}
      className="flex animate-in flex-col gap-2 duration-(--dur-4) fade-in-0 slide-in-from-bottom-1"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <CircleCheckIcon className="size-4 text-primary" aria-hidden />
        {finished.message}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 pointer-coarse:h-10"
          onClick={onUndo}
        >
          <Undo2Icon data-icon="inline-start" />
          Undo
        </Button>
      </p>
      {variant === 'panel' && (
        <p className="line-clamp-1 text-sm text-muted-foreground">{finished.description}</p>
      )}
      {reduced ? (
        <Button size="sm" className="self-end pointer-coarse:h-10" onClick={onNext}>
          {finished.next ? 'Next suggestion' : 'Back to the Inbox'}
        </Button>
      ) : (
        <span aria-hidden className="h-0.5 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full origin-left animate-[countdown_2.6s_linear_forwards] bg-primary"
            style={{ animationPlayState: paused ? 'paused' : 'running' }}
          />
        </span>
      )}
    </div>
  )

  const archiveDialog = r.retire && (
    <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive the context item?</DialogTitle>
          <DialogDescription>
            Agents stop getting “{r.title}” from the next question; {r.retire.used} questions used
            it this week.
            {withdrawn
              ? ` ${withdrawn.by.split(' ')[0]} withdrew this suggestion in the comments.`
              : ''}{' '}
            Undo is there for a moment after.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant={withdrawn ? 'destructive' : 'default'} onClick={archive}>
            Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // On a phone: the state in words and where you are, then the two actions at full touch size.
  if (variant === 'bar') {
    if (returning) return null
    const at = reviews.findIndex((x) => x.id === r.id)
    return (
      <div className="flex shrink-0 flex-col gap-2 border-t bg-background px-4 pt-2.5 pb-safe-sm">
        {archiveDialog}
        {finished ? (
          outcome
        ) : done ? (
          <p className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4" aria-hidden /> {done.label}, {midSentence(done.at)}.
          </p>
        ) : (
          <>
            {problem ?? (
              <p className="flex items-center gap-2 text-sm">
                {careLine(r) ? (
                  <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-caution-icon" />
                ) : (
                  <ReadyIcon className="size-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 font-medium text-pretty">
                  {careLine(r) ? (
                    <Mark role="needs" icon={false}>
                      {careLine(r)}
                    </Mark>
                  ) : (
                    ready.title
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {at + 1} of {reviews.length}
                </span>
                {onStep && (
                  <span className="-mr-2 flex shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Previous suggestion"
                      disabled={at === 0}
                      onClick={() => onStep(-1)}
                    >
                      <ChevronUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Next suggestion"
                      disabled={at === reviews.length - 1}
                      onClick={() => onStep(1)}
                    >
                      <ChevronDownIcon />
                    </Button>
                  </span>
                )}
              </p>
            )}
            <div className="flex gap-2 *:data-[slot=button]:h-11 *:data-[slot=button]:flex-1">
              {shownActions}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div id="decision" className="flex scroll-mt-4 flex-col">
      {archiveDialog}
      {/* Once decided, the panel says what happened, never what was true before. */}
      <section hidden={!!done && !finished} className="flex flex-col gap-3 border-b p-4">
        <p className="flex items-start gap-2 text-sm">
          <ReadyIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">{ready.title}.</span>{' '}
            <span className="text-muted-foreground">{ready.text}</span>
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Overlaps:</span>{' '}
          {r.clash ? r.clash.items.map((c) => c.title).join('; ') : 'none'}.
        </p>
      </section>
      <section className="flex min-h-25 flex-col justify-center gap-3 p-4">
        {finished ? (
          outcome
        ) : done ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4" aria-hidden /> {done.label}, {midSentence(done.at)}.
          </p>
        ) : returning ? (
          // The note is the first comment of the suggestion's thread, so the reply lands in the same place.
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">A note for {r.from}</p>
            <p className="text-xs text-muted-foreground">
              It goes into the comments, where {first} can answer.
            </p>
            <Composer
              author={me.name}
              avatar={false}
              autoFocus
              label={`A note for ${r.from}`}
              placeholder="What would make it ready?"
              submitLabel={`Return to ${first}`}
              initialContent={draft}
              onDraft={onDraft}
              clearOnPost={false}
              postDisabled={blockedBySend}
              onCancel={() => setReturning(false)}
              onPost={(content) => {
                setTried('return')
                returnNote.current = content
                sender.send(commitReturn)
              }}
            />
            {problem}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {problem}
            {/* Desktop decisions are full size: 36px, 13px text. */}
            <div className="flex flex-wrap gap-2 *:data-[slot=button]:h-9 *:data-[slot=button]:px-3 *:data-[slot=button]:text-dense">
              {shownActions}
            </div>
            {draft && (
              <p className="text-xs text-muted-foreground">
                Your note for {first} is kept. Return with a note opens it again.
              </p>
            )}
            {/* The key is for people with a keyboard, and only when it acts: never on a touch screen. */}
            {keyAction && (
              <p className="text-right text-xs text-muted-foreground pointer-coarse:hidden">
                <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> to{' '}
                {keyAction === 'close' ? 'close it; nothing changes' : keyAction}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/** Everything in the queue decided: how it went, Undo for the last one, and the way back. */
function AllDone({ last, title, onUndo }: { last: Finished; title: string; onUndo: () => void }) {
  const state = useInbox()
  const reviews = useReviews()
  const tally = new Map<string, number>()
  for (const r of reviews) {
    const o = state.done[r.id]?.label
    if (o) tally.set(o, (tally.get(o) ?? 0) + 1)
  }
  const parts = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([o, n]) => `${n} ${o.toLowerCase()}`)
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16 sm:px-8">
      <CircleCheckIcon aria-hidden className="size-6 text-primary" />
      <h2
        id="change-heading"
        tabIndex={-1}
        className="text-xl font-semibold tracking-tight outline-none sm:text-2xl"
      >
        All {reviews.length} handled
      </h2>
      <p className="text-sm text-muted-foreground">
        {parts.join(', ')}. Agents get what was published from the next question.
      </p>
      <p className="text-sm text-muted-foreground">
        Last: <span className="text-foreground">{title}</span>, {last.outcome.toLowerCase()}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onUndo}>
          <Undo2Icon data-icon="inline-start" />
          Undo the last one
        </Button>
        <Button onClick={() => navigate('/inbox')}>Back to the Inbox</Button>
      </div>
    </div>
  )
}

/** What the source changes, counted as the source counts it: fields, then sentences of text. */
function SourceStats({ r }: { r: Review }) {
  const { before, after } = r.fields
  const fields = before && after ? fieldRows(before, after).filter((x) => x.changed).length : null
  const text = diffStats(lineDiff(r.source.before, r.source.after))
  const parts = [
    fields === null
      ? null
      : fields
        ? `${fields} ${fields === 1 ? 'field' : 'fields'} changed`
        : 'No field changed',
    text.changes ? `${changeWords(text)} in the text` : 'No change to the text',
  ].filter(Boolean)
  return <p className="text-xs text-muted-foreground">{parts.join('. ')}.</p>
}

/** The full-screen review: queue, change, and decision. J and K move, Esc goes back to the Inbox. */
export function ReviewPage({ id }: { id: string }) {
  const reviews = useReviews()
  const r = reviews.find((x) => x.id === id)
  const me = useMe()
  const state = useInbox()
  const domains = useDomains()
  const write = useWrite()
  const commentActions = useCommentActions()
  const isMobile = useIsMobile()
  // The source is the review; the preview is a second look, kept while you go through the queue.
  // `?view=preview` opens with it.
  const [previewChoice, setPreview] = useSideChoice('review-preview')
  const view: View =
    (previewChoice ??
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('view') === 'preview'))
      ? 'preview'
      : 'source'
  const [queueOpen, setQueueOpen] = React.useState(false)
  const [finished, setFinished] = React.useState<Finished | null>(null)
  const [mainRef, wide] = useWide<HTMLDivElement>()
  // The queue keeps its column from 80rem of pane up; below that it folds to a slim rail, opened on request.
  const [roomyRef, roomy] = useWide<HTMLDivElement>(1280)
  const [queuePeek, setQueuePeek] = React.useState(false)
  const paneRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      mainRef(el)
      roomyRef(el)
    },
    [mainRef, roomyRef],
  )
  const [returning, setReturningState] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Record<string, JSONContent>>({})
  // One send state for the panel and the phone bar; a new item starts clean.
  const sender = useSend()
  const [sentFor, setSentFor] = React.useState(id)
  if (sentFor !== id) {
    setSentFor(id)
    sender.reset()
  }
  const reduced = useReducedMotion()
  // After a decision: a short hold with Undo, then the next suggestion. A key skips it, the pointer
  // or focus on the outcome pauses it, and with reduced motion it waits for Next.
  const hold = React.useRef({ timer: 0, left: 0, since: 0 })
  const [paused, setPaused] = React.useState(false)
  React.useEffect(() => () => window.clearTimeout(hold.current.timer), [])
  // Returning from the phone's bar opens the note where the decision is written.
  const setReturning = (v: boolean) => {
    setReturningState(v)
    if (v)
      requestAnimationFrame(() =>
        document.getElementById('decision')?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      )
  }
  // The owner's answers to a clash, over the ones the service already has.
  const [chosen, setChosen] = React.useState<Record<string, Relation>>({})
  const answers = React.useMemo(
    () => ({
      ...Object.fromEntries(
        (r?.clash?.items ?? []).flatMap((c) => (c.relation ? [[c.factId, c.relation]] : [])),
      ),
      ...chosen,
    }),
    [r?.clash, chosen],
  )
  const answer = React.useCallback(
    (factId: string, v: Relation) => setChosen((a) => ({ ...a, [factId]: v })),
    [],
  )
  const at = reviews.findIndex((x) => x.id === id)
  // The next suggestion crossfades in (150ms) where the browser can; with reduced motion it cuts.
  const go = React.useCallback(
    (to: string) => {
      const open = () => navigate(`/inbox/${to}/review`)
      if (reduced || !document.startViewTransition) return open()
      document.startViewTransition(() => flushSync(open))
    },
    [reduced],
  )
  const leave = React.useCallback(() => navigate('/inbox', { card: id }), [id])
  // Opening the review is reading its new reply and any mention of you: the Inbox markers go.
  // Opening it also counts as reading it, for "Publish the ones you've read".
  React.useEffect(() => {
    void commentActions.seen(`review:${id}`)
    void commentActions.seenMention(`review:${id}`)
    void write('markOpened', { ids: [id] })
    // Once per suggestion opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me.name])

  // The hold after a decision ends in the next suggestion, or the Inbox when nothing is left.
  // After the last decision: the review shows that everything is handled, with Undo for that last one.
  const [allDone, setAllDone] = React.useState<Finished | null>(null)
  const [allFor, setAllFor] = React.useState(id)
  if (allFor !== id) {
    setAllFor(id)
    setAllDone(null)
  }
  // Focus goes to the change's heading, never to the page top, unless someone is typing.
  const focusChange = React.useCallback(() => {
    requestAnimationFrame(() => {
      if (isTyping(document.activeElement)) return
      document.getElementById('change-heading')?.focus({ preventScroll: true })
    })
  }, [])
  React.useEffect(() => focusChange(), [id, focusChange])
  const finishedRef = React.useRef(finished)
  React.useEffect(() => {
    finishedRef.current = finished
  }, [finished])
  const moveOn = React.useCallback(() => {
    window.clearTimeout(hold.current.timer)
    hold.current.timer = 0
    const f = finishedRef.current
    setPaused(false)
    setFinished(null)
    if (f?.next) go(f.next)
    // The last one: the review says everything is handled, here, with Undo, instead of leaving.
    else if (f) setAllDone(f)
  }, [go])
  const wait = (ms: number) => {
    hold.current = { timer: window.setTimeout(moveOn, ms), left: ms, since: Date.now() }
  }
  const pauseWait = () => {
    if (!hold.current.timer) return
    window.clearTimeout(hold.current.timer)
    hold.current = {
      timer: 0,
      left: Math.max(400, hold.current.left - (Date.now() - hold.current.since)),
      since: 0,
    }
    setPaused(true)
  }
  const resumeWait = () => {
    if (!finished || reduced || hold.current.timer) return
    wait(hold.current.left)
    setPaused(false)
  }

  // Page keys never act while someone types (a note, a comment). Esc closes an open note first,
  // keeping what was written; only then does it go back to the Inbox. Right after a decision any
  // letter key (J most of all) skips the wait. "?" is the app's shortcut sheet, which lists these too.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageKey(e)) return
      if (
        finished &&
        e.key !== 'Escape' &&
        e.key !== '?' &&
        e.key !== 'k' &&
        (e.key.length === 1 || e.key === 'ArrowDown') &&
        e.key !== ' '
      )
        return moveOn()
      if (e.key === 'Escape') return returning ? setReturningState(false) : leave()
      if (e.key === 'j' && at < reviews.length - 1) go(reviews[at + 1]!.id)
      if (e.key === 'k' && at > 0) go(reviews[at - 1]!.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, go, leave, returning, finished, moveOn, reviews])

  if (!r) {
    // An old link: say why it is empty, and offer the next suggestion that still waits.
    const waiting = reviews.find((x) => !state.done[x.id])
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SiteHeader title="Review" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="font-medium">Nothing to review here</p>
          <p className="max-w-sm text-sm text-pretty text-muted-foreground">
            This suggestion was probably published, returned or withdrawn, or the link is from
            before it was.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {waiting && <Button onClick={() => go(waiting.id)}>Open the next suggestion</Button>}
            <Button variant="outline" onClick={() => navigate('/inbox')}>
              Back to the Inbox
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // A decision shows what it did in place for a moment, with Undo, then the next suggestion opens.
  const onDone = (f: Finished) => {
    focusChange()
    const next =
      reviews.find((x, i) => i > at && !state.done[x.id]) ??
      reviews.find((x) => x.id !== r.id && !state.done[x.id])
    setFinished({ ...f, next: next?.id })
    setPaused(false)
    window.clearTimeout(hold.current.timer)
    hold.current.timer = 0
    if (!reduced) wait(2600)
  }
  const undo = () => {
    window.clearTimeout(hold.current.timer)
    hold.current.timer = 0
    // Exactly this decision goes back: its outcome and the context items it changed, nothing else.
    if (finished) {
      void write('undo', { token: finished.undo })
      finished.afterUndo?.()
    }
    setFinished(null)
    setReturning(false)
  }
  const undoLast = () => {
    if (!allDone) return
    void write('undo', { token: allDone.undo })
    allDone.afterUndo?.()
    setAllDone(null)
    focusChange()
  }
  const onDraft = (d: JSONContent | null) =>
    setDrafts((all) => {
      const { [r.id]: _, ...rest } = all
      return d ? { ...rest, [r.id]: d } : rest
    })
  const decision = {
    r,
    onDone,
    finished,
    onUndo: undo,
    returning,
    setReturning,
    draft: drafts[r.id],
    onDraft,
    sender,
    paused,
    reduced,
    onNext: moveOn,
    onHold: (held: boolean) => (held ? pauseWait() : resumeWait()),
  }
  const queue = (
    <Queue current={r.id} onPick={(to) => (setQueueOpen(false), setQueuePeek(false), go(to))} />
  )
  // The owners of the domain: their comments say "Owner", since their word settles it.
  const owners = domains[state.cards.find((c) => c.id === r.id)?.domain ?? '']?.owners ?? []
  // A thread is on the source: from the preview, going to one shows the source first.
  const toThread = (threadId: string) => {
    if (view === 'source') return goToThread(threadId)
    setPreview(false)
    requestAnimationFrame(() => requestAnimationFrame(() => goToThread(threadId)))
  }
  const threadsSummary = (
    <SourceThreadsSummary
      key={`threads-${r.id}`}
      subject={`review:${r.id}`}
      versions={r.versions}
      onGo={toThread}
    />
  )
  const side = (
    <>
      {threadsSummary}
      <TryItPanel key={`try-${r.id}`} r={r} now={finished?.now} />
      <Decision key={`d-${r.id}`} {...decision} />
    </>
  )

  return (
    <RelationContext.Provider value={[answers, answer]}>
      {/* Under a finger every control is at least 40px; the phone bar's actions are 44px. */}
      <div key={r.id} className={cn('flex h-full min-h-0 flex-col bg-background', TOUCH)}>
        <SiteHeader
          title={
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap text-sm">
                <BreadcrumbItem className="max-sm:hidden">
                  <BreadcrumbLink
                    href={`/inbox?card=${r.id}`}
                    className="text-foreground/75 hover:text-foreground"
                  >
                    Inbox
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="max-sm:hidden" />
                <BreadcrumbItem className="max-sm:hidden">
                  <span className="text-foreground/75">Review</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="max-sm:hidden" />
                <BreadcrumbItem className="min-w-0">
                  <h1 className="flex min-w-0">
                    <BreadcrumbPage className="flex min-w-0 items-center gap-1.5 font-medium">
                      {r.agent && (
                        <BotIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{r.title}</span>
                    </BreadcrumbPage>
                  </h1>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        >
          {isMobile && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setQueueOpen(true)}
            >
              <ListIcon data-icon="inline-start" />
              Queue
            </Button>
          )}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums max-sm:hidden">
            {at + 1} of {reviews.length}
          </span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Keyboard shortcuts"
                    className="pointer-coarse:hidden"
                    onClick={() => openOverlay('shortcuts')}
                  />
                }
              >
                <KeyboardIcon />
              </TooltipTrigger>
              <TooltipContent>
                Keyboard shortcuts <Kbd>?</Kbd>
              </TooltipContent>
            </Tooltip>
            <ViewToggle
              pressed={view === 'preview'}
              onPressedChange={setPreview}
              icon={<EyeIcon />}
              // On a phone the header keeps room for the title: the icon alone, named for a screen reader.
              text={isMobile ? undefined : 'Preview'}
              on="Show the preview"
              off="Show the source"
            />
            {!isMobile && (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Previous suggestion"
                        disabled={at === 0}
                        onClick={() => go(reviews[at - 1]!.id)}
                      />
                    }
                  >
                    <ChevronUpIcon />
                  </TooltipTrigger>
                  <TooltipContent>
                    Previous <Kbd>K</Kbd>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Next suggestion"
                        disabled={at === reviews.length - 1}
                        onClick={() => go(reviews[at + 1]!.id)}
                      />
                    }
                  >
                    <ChevronDownIcon />
                  </TooltipTrigger>
                  <TooltipContent>
                    Next <Kbd>J</Kbd>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </SiteHeader>
        <div ref={paneRef} className="@container/main flex min-h-0 flex-1">
          {!isMobile && (
            <ResizableAside
              side="left"
              storageKey="review-queue"
              defaultWidth={264}
              min={220}
              max={360}
              label="Waiting suggestions"
              collapsed={!roomy && !queuePeek}
              onCollapsedChange={(c) => setQueuePeek(!c)}
              rail={<QueueRail count={reviews.length} onShow={() => setQueuePeek(true)} />}
              railWidth={48}
              className="border-r"
            >
              {queue}
            </ResizableAside>
          )}
          <main className="@container min-w-0 flex-1 overflow-y-auto">
            {allDone ? (
              <AllDone last={allDone} title={r.title} onUndo={undoLast} />
            ) : (
              <>
                {/* The next suggestion fades in after a decision or J and K, so the change is seen. */}
                <div className="mx-auto flex max-w-3xl animate-in flex-col gap-8 px-4 py-6 duration-(--dur-3) fade-in-0 sm:px-8 sm:py-10">
                  <Summary r={r} stats={view === 'source' ? <SourceStats r={r} /> : undefined} />
                  <div className="flex flex-col gap-4 border-t pt-6">
                    <TheChange r={r} view={view} me={me.name} owners={owners} />
                    <ReadMark r={r} />
                  </div>
                  <CommentBox
                    key={r.id}
                    subject={`review:${r.id}`}
                    versions={r.versions}
                    me={me.name}
                    owners={owners}
                    note={
                      r.agent
                        ? `Sent by ${r.agent}, with ${r.from}'s OK. ${r.from.split(' ')[0]} answers here; agents never read or write comments.`
                        : undefined
                    }
                    className="border-t pt-6"
                  />
                </div>
                {!wide && <div className="border-t">{side}</div>}
              </>
            )}
          </main>
          {/* Beside the change when there is room, under it when there isn't: once, never twice. */}
          {wide && !allDone && (
            <ResizableAside
              side="right"
              storageKey="review-side"
              defaultWidth={340}
              min={300}
              max={480}
              label="Try it and decide"
              className="border-l"
            >
              {/* The shared panel: Try it scrolls in the body; the decision stays in reach as the footer. */}
              <Panel
                title="Try it and decide"
                footer={<Decision key={`d-${r.id}`} {...decision} />}
              >
                {threadsSummary}
                <TryItPanel key={`try-${r.id}`} r={r} now={finished?.now} />
              </Panel>
            </ResizableAside>
          )}
        </div>
        {/* On a phone the decision stays in reach: a bar along the bottom edge. */}
        {isMobile && !allDone && (
          <Decision
            key={`bar-${r.id}`}
            {...decision}
            variant="bar"
            onStep={(d) => go(reviews[at + d]!.id)}
          />
        )}
        {/* Which suggestion is open, said once for a screen reader after J, K or a decision. */}
        <p role="status" aria-live="polite" className="sr-only">
          {allDone
            ? `All ${reviews.length} handled.`
            : `Suggestion ${at + 1} of ${reviews.length}: ${r.title}`}
        </p>
        <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
          <SheetContent side="left" className="w-popover-phone gap-0 bg-background p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Waiting for {me.name.split(' ')[0]}</SheetTitle>
            </SheetHeader>
            {queue}
          </SheetContent>
        </Sheet>
      </div>
    </RelationContext.Provider>
  )
}
