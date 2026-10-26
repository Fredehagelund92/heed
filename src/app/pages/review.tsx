import { ArrowRightIcon, CircleDashedIcon, TriangleAlertIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { DockFrame, DockMissing } from '@/components/dock'
import { AgentAvatar, PersonAvatar } from '@/components/heed/bits'
import { ChangeBlock, KindLabel } from '@/components/heed/review-parts'
import { ToolLogo } from '@/components/heed/tool-logo'
import { connectorById } from '@/model/integrations'
import { Button } from '@/components/ui/button'
import { careLine, type Review } from '@/model/review'
import { navigate } from '@/lib/router'
import { useInbox, useReviews } from '@/api/queries'

// Reviewing a suggestion, in two places. The quick view (in the Inbox pane and the dock) says what
// changes and opens the review; it never publishes. The full-screen review is where you work: the
// queue of waiting suggestions on the left, the change in the middle, Try it and the decision on
// the right. Every change sits in its own block under a quiet kind label, with hairlines between.

/* ---------- the summary, shared by both ---------- */

export function Sender({ r, when }: { r: Review; when?: string }) {
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
        <ToolLogo c={connectorById('google-drive')!} size="sm" />
        <span>
          From <span className="font-medium text-foreground">{r.synced.tool}</span>,{' '}
          {r.synced.folder}, read {(when ?? r.synced.read).toLowerCase()}. Created by the read, not
          by a person.
        </span>
      </p>
    )
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {r.agent ? <AgentAvatar /> : <PersonAvatar name={r.from} />}
      <span>
        {r.agent ? (
          <>
            An agent, with <span className="font-medium text-foreground">{r.from}</span>'s OK,{' '}
            {when ?? r.on}
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

export function Summary({ r, size = 'lg' }: { r: Review; size?: 'lg' | 'md' }) {
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

/**
 * What the Inbox pane and the dock show: the change, the note and Review. One title (the pane's),
 * one author line, the values that moved, the note and the first change. No counts row and no
 * reach line: those belong to the review and its Try it.
 */
export function QuickReview({ r, sender = true }: { r: Review; sender?: boolean }) {
  const first = r.blocks[0]
  const care = careLine(r)
  return (
    <div className="flex flex-col gap-4">
      {sender && <Sender r={r} />}
      {/* What needs care shows before Review, never only inside it. */}
      {care && (
        <p className="flex items-center gap-2 text-sm font-medium">
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-caution-icon" />
          {care}
          <span className="font-normal text-muted-foreground">
            {r.claims ? 'before publishing' : r.clash ? `: ${r.clash.title}` : ''}
          </span>
        </p>
      )}
      <p className="text-reading leading-relaxed text-pretty">{r.summary}</p>
      {r.formattingOnly && (
        <p className="rounded-frame border border-dashed bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Formatting only. The words are the same.</span>
        </p>
      )}
      <Moved r={r} />
      {r.note && (
        <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">
          “{r.note}”
        </blockquote>
      )}
      <div className="border-t pt-1">
        {first ? (
          <ChangeBlock block={first} index={0} total={r.blocks.length} />
        ) : r.rewrite ? (
          <p className="py-4 text-sm text-muted-foreground">
            {r.rewrite.changes} changes across the text. The review shows them side by side.
          </p>
        ) : r.retire ? (
          <p className="py-4 text-sm text-muted-foreground">{r.retire.reason}</p>
        ) : null}
      </div>
    </div>
  )
}

/** The review in the dock: the quick view, and Review to open the full screen. No publishing here. */
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
  return (
    <DockFrame
      title={r.title}
      footer={
        done ? (
          <p className="text-sm text-muted-foreground">{done.label}.</p>
        ) : (
          <Button size="sm" onClick={() => navigate(`/inbox/${r.id}/review`)}>
            Review
          </Button>
        )
      }
    >
      <div className="@container p-4 md:p-5">
        <QuickReview r={r} />
      </div>
    </DockFrame>
  )
}
