import type { ComponentProps, ReactNode } from 'react'
import {
  ArrowRightLeftIcon,
  CircleCheckIcon,
  CircleXIcon,
  ListChecksIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  PencilIcon,
  PencilLineIcon,
  SendIcon,
  ShieldCheckIcon,
  Undo2Icon,
  UserRoundCheckIcon,
  type Icon,
} from '@/components/icons'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoment } from '@/lib/library'
import { cn } from '@/lib/utils'

/*
  A proposal's timeline (FR-114, contract 7.2): one list, oldest or newest first as the page
  decides, each event a 24 pixel round mark on a hairline, who did it in bold, what they did, when,
  and an optional detail line or the text of a comment. The marks are tinted only where an event
  asks for a look or closes the proposal; every mark has its own glyph, so the kind of event never
  relies on colour. Building the rows from events, decisions and comments is the screen's job.
*/

export type TimelineTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const timelineEventKinds = [
  'started',
  'submitted',
  'checked',
  'claimed',
  'handed_over',
  'edited',
  'commented',
  'changes_requested',
  'approved',
  'accepted',
  'rejected',
  'withdrawn',
] as const
export type TimelineEventKind = (typeof timelineEventKinds)[number]

export const timelineEventLook: Record<TimelineEventKind, { glyph: Icon; tone: TimelineTone }> = {
  started: { glyph: PencilIcon, tone: 'neutral' },
  submitted: { glyph: SendIcon, tone: 'neutral' },
  checked: { glyph: ListChecksIcon, tone: 'success' },
  claimed: { glyph: UserRoundCheckIcon, tone: 'info' },
  handed_over: { glyph: ArrowRightLeftIcon, tone: 'info' },
  edited: { glyph: PencilLineIcon, tone: 'info' },
  commented: { glyph: MessageCircleIcon, tone: 'neutral' },
  changes_requested: { glyph: MessageSquareIcon, tone: 'warning' },
  approved: { glyph: ShieldCheckIcon, tone: 'info' },
  accepted: { glyph: CircleCheckIcon, tone: 'success' },
  rejected: { glyph: CircleXIcon, tone: 'danger' },
  withdrawn: { glyph: Undo2Icon, tone: 'neutral' },
}

/** The list of events. Give it a name when the page has more than one list. */
export function Timeline({
  className,
  children,
  'aria-label': label = 'Activity',
  ...props
}: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="timeline"
      aria-label={label}
      className={cn('flex min-w-0 flex-col', className)}
      {...props}
    >
      {children}
    </ol>
  )
}

/** The round mark of an event: its glyph in a 24 pixel circle, tinted when the tone is not neutral. */
export function TimelineMark({ kind, tone }: { kind: TimelineEventKind; tone?: TimelineTone }) {
  const look = timelineEventLook[kind]
  const shown = tone ?? look.tone
  const Glyph = look.glyph
  return (
    <span
      aria-hidden="true"
      data-slot="timeline-mark"
      data-tone={shown}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full border',
        shown === 'neutral'
          ? 'border-border bg-background text-muted-foreground'
          : 'border-tone-line bg-tone-tint text-tone-ink',
      )}
    >
      <Glyph className="size-icon-sm" />
    </span>
  )
}

/**
 * One event. `actor` is the person in bold ("Jon Abara", "You"), `action` what they did ("asked
 * for changes"); together they are one sentence, followed by the time. `body` is a comment or a
 * reason, shown as written in a box (plain text, line breaks kept). `children` go under it, such
 * as the outcomes of a check run.
 */
export function TimelineEvent({
  kind,
  tone,
  actor,
  action,
  at,
  detail,
  body,
  children,
  className,
}: {
  kind: TimelineEventKind
  /** Overrides the kind's tone, such as a check run that failed (danger). */
  tone?: TimelineTone
  actor?: ReactNode
  action: string
  /** An ISO time; shown as "8 Oct, 09:12" with the whole moment in its tooltip. */
  at: string
  /** A muted line under the sentence: "Revision 3. Review time for Commercial is 2 working days." */
  detail?: ReactNode
  /** Text a person wrote, shown as written. */
  body?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <li
      data-slot="timeline-event"
      data-kind={kind}
      className={cn('group/event relative flex gap-3 pb-6 last:pb-0', className)}
    >
      {/* The hairline that joins this mark to the next one. */}
      <span
        aria-hidden="true"
        className="absolute top-6 bottom-0 left-3 w-px bg-border group-last/event:hidden"
      />
      <TimelineMark kind={kind} tone={tone} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <p className="flex min-h-6 flex-wrap content-center items-baseline gap-x-2 text-dense">
            <span className="min-w-0 break-words">
              {actor ? (
                <>
                  <span className="font-bold">{actor}</span>{' '}
                </>
              ) : null}
              {action}
            </span>
            <time
              dateTime={at}
              title={formatMoment(at, 'long')}
              className="text-caption text-muted-foreground tabular-nums"
            >
              {formatMoment(at)}
            </time>
          </p>
          {detail ? <div className="text-caption text-muted-foreground">{detail}</div> : null}
        </div>
        {body ? (
          <p
            data-slot="timeline-body"
            className="rounded-lg border bg-card px-4 py-3 text-dense break-words whitespace-pre-line"
          >
            {body}
          </p>
        ) : null}
        {children}
      </div>
    </li>
  )
}

/** Three placeholder events in the timeline's own shape, while the events load. */
export function TimelineSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div data-slot="timeline-skeleton" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading the activity</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-full max-w-popover" />
            {row === 0 ? <Skeleton className="h-12 w-full" /> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
