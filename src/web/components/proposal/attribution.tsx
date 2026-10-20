import type { ReactNode } from 'react'
import type { Provenance } from '@domain/provenance'
import { BotIcon } from '@/components/icons'
import { AiAppMark } from '@/components/person-avatar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { writerOf, type MarkCounts, attributionWords } from '@/lib/provenance'
import { cn } from '@/lib/utils'
import './ai-mark.css'

/*
  Quiet attribution (contract 6.13, "Field provenance"; 7.2, `Owner`): a draft an AI app or the
  assistant wrote for a person is the person's, so the person is the author and the app is a
  mark on their avatar, never an avatar of its own (Notion's AI mark, Linear's avatar badge).
  One summary line says who drafted it with what and what each one wrote; each field carries its
  muted glyph, and each field the app wrote also carries one quiet line at its start edge
  (`ai-mark`), always on, as a change bar sits in a margin. The summary's legend says what it means.
*/

/** The initials of a name, as the neutral avatar shows them: "Priya Nair" is "PN". */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')

/**
 * The person's neutral initials avatar, with the AI app mark when `by` says an AI app or the
 * assistant drafted it with them. Decorative: the words beside it name the person and the app.
 */
export function DraftedAvatar({
  name,
  by,
  size = 'sm',
}: {
  name: string
  by: Provenance['by'] | null
  size?: 'xs' | 'sm' | 'default'
}) {
  return (
    <span className="relative inline-flex shrink-0" data-slot="drafted-avatar">
      <Avatar size={size} aria-hidden="true">
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      {/* Two initials fill the circle, so the mark stands 4 out from its edge, clear of them. */}
      {by ? (
        <AiAppMark size={size === 'default' ? 'sm' : 'xs'} className="-right-1 -bottom-1" />
      ) : null}
    </span>
  )
}

/**
 * A list row's quiet sign that an AI app or the assistant drafted it: the bot glyph, muted, its
 * words in the tooltip and to a screen reader. Not focusable, as it sits in a row's link.
 */
export function DraftedMark({ by, className }: { by: Provenance['by']; className?: string }) {
  const words = `Drafted with ${writerOf(by)}`
  return (
    <span
      data-slot="drafted-mark"
      data-by={by}
      title={words}
      className={cn('inline-flex shrink-0 items-center text-muted-foreground', className)}
    >
      <BotIcon aria-hidden="true" className="size-icon-sm" />
      <span className="sr-only">{words}</span>
    </span>
  )
}

/**
 * The legend of the line that marks what an AI app or the assistant wrote: the line itself, small,
 * and its meaning in words. The swatch is decoration; the words carry it.
 */
export function AiMarkLegend({ by, className }: { by: Provenance['by']; className?: string }) {
  return (
    <span
      data-slot="ai-mark-legend"
      className={cn('inline-flex items-center gap-2 text-caption text-muted-foreground', className)}
    >
      <span aria-hidden="true" className="ai-mark-swatch" />
      {by === 'agent' ? 'A line marks what the app wrote' : 'A line marks what the assistant wrote'}
    </span>
  )
}

/**
 * The one provenance summary line above a drafted proposal's fields: the proposer's avatar with
 * the AI app mark, who drafted it with what, and how many fields each one wrote; the legend of
 * the line at its end when `marked` says a field shown carries it.
 */
export function ProvenanceSummary({
  provenance,
  person,
  you,
  counts,
  submitted,
  marked = false,
  children,
}: {
  provenance: Provenance
  /** The proposer's name, for the avatar and, when someone else reads it, the words. */
  person: string
  /** The reader is the proposer: the words say "You". */
  you: boolean
  /** The counts per mark of the rows shown; left out, the line says only who drafted it. */
  counts?: MarkCounts
  submitted: boolean
  /** A field shown carries the line of what the app wrote: the line's legend ends the summary. */
  marked?: boolean
  /** More lines under the summary, such as the external sources and their warnings. */
  children?: ReactNode
}) {
  const words = attributionWords({
    provenance,
    proposer: you ? null : person,
    counts: counts ?? { wrote: 0, confirmed: 0, filled: 0, left: 0 },
    submitted,
  })
  return (
    <div
      data-slot="review-provenance"
      data-by={provenance.by}
      className="flex flex-col gap-2 text-caption text-muted-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="flex min-w-0 items-center gap-3">
          <DraftedAvatar name={person} by={provenance.by} />
          <span className="min-w-0">
            <span className="text-foreground">{words.lead}</span> {words.tally}
          </span>
        </p>
        {marked ? <AiMarkLegend by={provenance.by} className="shrink-0" /> : null}
      </div>
      {children}
    </div>
  )
}
