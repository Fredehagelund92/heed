import type * as React from 'react'
import { ArrowRightIcon, CircleDashedIcon, TriangleAlertIcon } from '@/components/icons'
import { cn, midSentence } from '@/lib/utils'
import { DockFrame, DockMissing } from '@/components/dock'
import { AgentAvatar, PersonAvatar } from '@/components/heed/bits'
import { ChangeBlock, KindLabel } from '@/components/heed/review-parts'
import { ToolLogo } from '@/components/heed/tool-logo'
import { lookOf } from '@/model/integrations'
import { careLine, type Review } from '@/model/review'
import { Mark } from '@/components/heed/mark'
import { navigate } from '@/lib/router'
import { useInbox, useReviews } from '@/api/queries'
import {
  AgentAnswers,
  AskedAbout,
  Fold,
  PaneFoot,
  PaneHead,
  PrimaryAction,
} from '@/components/heed/inbox-pane'
import {
  answersOf,
  paneState,
  reviewAction,
  reviewFollows,
  type PaneState,
} from '@/model/inbox-pane'
import type { DomainId } from '@/model/items'

// Reviewing a suggestion, in two places. The quick view (in the Inbox pane and the dock) says what
// changes and opens the review; it never publishes. The full-screen review is where you work: the
// queue of waiting suggestions on the left, the change in the middle, Try it and the decision on
// the right. Every change sits in its own block under a quiet kind label, with hairlines between.

/* ---------- the summary, shared by both ---------- */

/**
 * Who sent a suggestion, and when. `short` is the quick view's line under the summary: who and
 * where it came from, without the review's longer account of a draft or a read.
 */
export function Sender({ r, when, short }: { r: Review; when?: string; short?: boolean }) {
  if (r.drafted && short)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleDashedIcon aria-hidden className="size-4 shrink-0" />
        <span>A draft from what agents asked and {r.drafted.from}</span>
      </p>
    )
  if (r.drafted)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60"
        >
          <CircleDashedIcon className="size-3.5" />
        </span>
        <span>
          <span className="font-medium text-foreground">A draft</span> from {r.drafted.questions}{' '}
          questions agents asked this week and {r.drafted.from}. Nobody has checked it yet.
        </span>
      </p>
    )
  if (r.synced)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ToolLogo c={lookOf(r.synced.connector)} size="sm" />
        <span>
          From <span className="font-medium text-foreground">{r.synced.tool}</span>,{' '}
          {r.synced.folder}, read {midSentence(when ?? r.synced.read)}
          {short ? '' : '. Created by the read, not by a person.'}
        </span>
      </p>
    )
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {r.agent ? <AgentAvatar /> : <PersonAvatar name={r.from} />}
      <span>
        {r.agent ? (
          <>
            <span className="font-medium text-foreground">{r.agent}</span>, with{' '}
            <span className="font-medium text-foreground">{r.from}</span>'s OK, {when ?? r.on}
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">{r.from}</span>,{' '}
            {r.via === 'editor' ? 'in the editor' : `from ${r.via}`}, {when ?? r.on}
          </>
        )}
      </span>
    </p>
  )
}

/** "Number 312 to 340": the values that moved, pulled out of the text. */
function Moved({ r }: { r: Review }) {
  if (!r.moved.length) return null
  return (
    <ul aria-label="What moved" className="flex flex-wrap gap-2">
      {r.moved.map((m) => (
        <li
          key={m.label}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-sm"
        >
          <span className="text-xs text-muted-foreground">{m.label}</span>
          {m.before && (
            <>
              <del className="text-muted-foreground decoration-[var(--mark-del-line)]">
                {m.before}
              </del>
              <ArrowRightIcon aria-label="to" className="size-3 text-muted-foreground" />
            </>
          )}
          <span className="font-medium">{m.after}</span>
        </li>
      ))}
    </ul>
  )
}

export function Summary({
  r,
  size = 'lg',
  stats,
}: {
  r: Review
  size?: 'lg' | 'md'
  /** What the change counts, in place of the counts by kind: the review's source says lines and fields. */
  stats?: React.ReactNode
}) {
  const changed = r.counts.reduce((n, c) => n + c.n, 0)
  return (
    <div className="flex flex-col gap-4">
      <Sender r={r} />
      {/* The full review moves focus here after J, K or a decision, so the next Tab starts at the change. */}
      <h2
        id={size === 'lg' ? 'change-heading' : undefined}
        tabIndex={size === 'lg' ? -1 : undefined}
        className={cn(
          'leading-snug font-semibold tracking-tight text-balance outline-none',
          size === 'lg' ? 'text-xl sm:text-2xl' : 'text-lg',
        )}
      >
        {r.summary}
      </h2>
      {stats ?? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {r.counts.map((c) => (
            <KindLabel key={c.kind} kind={c.kind} n={c.n} />
          ))}
          {r.unchanged.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {r.unchanged.length} fields unchanged
            </span>
          )}
          <span className="sr-only">{changed} changed</span>
        </div>
      )}
      {r.formattingOnly && (
        <p className="rounded-frame border border-dashed bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Formatting only. The words are the same.</span>{' '}
          <span className="text-muted-foreground">
            {r.counts[0]!.n} formatting changes, no words or links changed.
          </span>
        </p>
      )}
      {/* The values that moved are not repeated here: the change blocks below mark each one. */}
      {r.note && (
        <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">
          “{r.note}”
        </blockquote>
      )}
    </div>
  )
}

/* ---------- the quick view ---------- */

/** The live items a suggestion overlaps, in a few words: the first by its title, then how many more. */
const overlapsWords = (items: { title: string }[]) =>
  `${items[0]?.title ?? ''}${items.length > 1 ? ` and ${items.length - 1} more` : ''}`

/**
 * What the Inbox pane and the dock show under the card's head: what agents answer today and after
 * the decision, what needs care, then the evidence folded until it is wanted (what changes, and
 * the sender's note). `asked` takes the question's place for a Not found card: what agents asked
 * about, never their words.
 */
export function QuickReview({ r, asked }: { r: Review; asked?: React.ReactNode }) {
  const first = r.blocks[0]
  const care = careLine(r)
  const answers = answersOf(r)
  return (
    <div className="flex flex-col gap-5">
      {answers && <AgentAnswers answers={answers} asked={asked} />}
      {/* What needs care shows before Review, never only inside it, and never folded. */}
      {care && (
        <p className="flex items-start gap-2 text-sm">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-caution-icon" />
          {/* One span keeps the colon against the words: the row's gap would put a space before it. */}
          <span>
            <Mark role="needs" icon={false}>
              {care}
            </Mark>
            <span className="text-muted-foreground">
              {r.claims ? ' before publishing' : r.clash ? `: ${overlapsWords(r.clash.items)}` : ''}
            </span>
          </span>
        </p>
      )}
      <div className="border-b">
        <Fold title="What changes" defaultOpen={!answers}>
          {r.formattingOnly && (
            <p className="rounded-frame border border-dashed bg-muted/40 px-3 py-2">
              <span className="font-medium">Formatting only. The words are the same.</span>
            </p>
          )}
          <Moved r={r} />
          {first ? (
            <ChangeBlock block={first} index={0} total={r.blocks.length} />
          ) : r.rewrite ? (
            <p className="text-muted-foreground">
              {r.rewrite.changes} changes across the text. The review shows them side by side.
            </p>
          ) : r.retire ? (
            <p className="text-muted-foreground">{r.retire.reason}</p>
          ) : null}
        </Fold>
        {r.note && (
          <Fold title={r.drafted ? 'About the draft' : `Why ${r.from} suggested it`}>
            <blockquote className="border-l-2 pl-3 text-muted-foreground italic">
              “{r.note}”
            </blockquote>
          </Fold>
        )}
      </div>
    </div>
  )
}

/** The head of a suggestion's quick view: its state, title, summary and a short line on who sent it. */
export function QuickHead({
  r,
  state = paneState({ type: r.drafted ? 'gap' : 'suggestion' }, r),
  title = r.title,
  domain,
  when,
}: {
  r: Review
  /** The card's state, when the card is known; otherwise the review's own. */
  state?: PaneState
  /** The card's title, which names what agents asked for a draft; otherwise the review's own. */
  title?: string
  domain?: DomainId
  when?: string
}) {
  return (
    <PaneHead
      state={state}
      domain={domain}
      title={title}
      summary={r.summary}
      from={<Sender r={r} when={when} short />}
    />
  )
}

/** The review in the dock: the quick view, and the decision it opens. No publishing here. */
export function ReviewSheet({ cardId }: { cardId: string }) {
  const r = useReviews().find((x) => x.id === cardId)
  const state = useInbox()
  if (!r)
    return (
      <DockFrame title="Review">
        <DockMissing>Nothing to review here. Someone may have handled it already.</DockMissing>
      </DockFrame>
    )
  const done = state.done[r.id]
  const card = state.cards.find((c) => c.id === r.id)
  return (
    // The bar names what it is, quietly, as a peek's does; the title is in the head, once.
    <DockFrame
      title="Review"
      quietTitle
      foot={
        done ? (
          <p className="flex h-bar items-center px-4 text-sm text-muted-foreground @md:px-7">
            {done.label}.
          </p>
        ) : (
          <PaneFoot follows={reviewFollows(r)}>
            <PrimaryAction keyHint={false} onClick={() => navigate(`/inbox/${r.id}/review`)}>
              {reviewAction(r)}
            </PrimaryAction>
          </PaneFoot>
        )
      }
    >
      <QuickHead r={r} title={card?.title} domain={card?.domain} />
      <div className="px-4 pb-6 @md:px-7">
        <QuickReview
          r={r}
          asked={card?.gap && <AskedAbout scope={card.gap.scope} times={card.gap.times} />}
        />
      </div>
    </DockFrame>
  )
}
