import type { Area, ItemKind } from '@domain/item'
import type { ProposalState } from '@domain/proposal-state'
import { asksForALook, type ItemDisplayStatus } from '@domain/status'
import {
  CheckIcon,
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  EyeIcon,
  FilePenIcon,
  HeedAcceptedIcon,
  HeedDomainIcon,
  HeedEditWaitingIcon,
  HeedEndedIcon,
  HeedIssueIcon,
  HeedRecheckDueIcon,
  HeedRetiredIcon,
  HeedSourceChangedIcon,
  HeedSourceMissingIcon,
  MessageSquareIcon,
  Undo2Icon,
  type Icon,
} from '@/components/icons'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { daysFrom, formatDay, kindNames, statusNames } from '@/lib/library'
import { proposalStateNames } from '@/lib/proposals'
import { cn } from '@/lib/utils'
import { KindIcon, kindGlyphs } from './kind-icon'

// The kind's icon and the count chip are apart, so the shell's sidebar carries them without the
// rest of the marks; every screen still finds them here.
export { CountBadge } from './count-badge'
export { KindIcon, kindGlyphs } from './kind-icon'

/*
  The product marks and badges (design contract 6.1, 6.2, 6.13, 7.2). Every one is a form of the
  badge (components/ui/badge.tsx): a domain is a soft badge with the Heed domain mark, a status a
  shaped glyph and words (tinted only when it asks for a look), a kind its bare muted icon in rows
  and an outline badge where there is room. Class names are written out in full so Tailwind can
  see every one of them.
*/

/**
 * A kind where there is room and the kind is the first thing to say: an outline badge with the
 * kind's icon, muted as everywhere else. `active` gives an issue that applies today its amber.
 */
export function KindBadge({
  kind,
  size = 'md',
  active = false,
  className,
}: {
  kind: ItemKind
  size?: 'md' | 'sm'
  active?: boolean
  className?: string
}) {
  const warns = active && kind === 'issue'
  return (
    <Badge
      form="outline"
      size={size}
      tone={warns ? 'warning' : 'neutral'}
      icon={kindGlyphs[kind]}
      data-slot="kind-badge"
      data-kind={kind}
      data-active={warns || undefined}
      className={cn(!warns && '[&>svg]:text-muted-foreground', className)}
    >
      {kindNames[kind]}
    </Badge>
  )
}

/**
 * A kind in running metadata: its icon and its name as plain words, the grammar of a status. No
 * box, so the domain badge stays the one accent.
 */
export function KindMark({
  kind,
  active = false,
  className,
}: {
  kind: ItemKind
  active?: boolean
  className?: string
}) {
  return (
    <span
      data-slot="kind-mark"
      data-kind={kind}
      className={cn('inline-flex min-w-0 items-center gap-2 text-muted-foreground', className)}
    >
      <KindIcon kind={kind} active={active} size="sm" decorative />
      <span className="truncate">{kindNames[kind]}</span>
    </span>
  )
}

/**
 * A domain: a soft badge with the Heed domain mark, both in the domain's hue from the ring
 * (contract 6.13). The name is always printed, so the colour is never the only cue. The room the
 * container gives decides how much of it shows: the badge shrinks inside its box, never past it,
 * and a name that does not fit ends in an ellipsis and keeps the whole name in its tooltip. A row
 * whose title is the point (the palette, an edition feed row) caps it at the Domain column's
 * width with `className="max-w-column-domain"`. `outline` is the quiet form (the hue in the mark
 * only), `bare` the mark and the name for a control that already draws a box.
 */
export function DomainBadge({
  name,
  label,
  form = 'soft',
  size = 'md',
  className,
}: {
  name: string
  label: Area['label']
  form?: 'soft' | 'outline' | 'bare'
  size?: 'md' | 'sm'
  className?: string
}) {
  return (
    <Badge
      form={form}
      size={size}
      tone={label}
      icon={HeedDomainIcon}
      fullText={name}
      data-slot="domain-badge"
      className={cn('shrink', form === 'bare' && 'text-foreground', className)}
    >
      {name}
    </Badge>
  )
}

/**
 * The glyph of each status, a Heed mark, shared by the status mark, the badge, the status column
 * and the item page. Seven statuses, seven shapes: a ring with its point for a state, the issue's
 * own warning for an active issue.
 */
export const statusGlyphs: Record<ItemDisplayStatus, Icon> = {
  accepted: HeedAcceptedIcon,
  stale: HeedRecheckDueIcon,
  needs_check: HeedSourceChangedIcon,
  source_missing: HeedSourceMissingIcon,
  active_issue: HeedIssueIcon,
  expired: HeedEndedIcon,
  retired: HeedRetiredIcon,
}

/** The icon colour per status. A healthy item is never green (contract 1): accepted is neutral. */
export const statusTone: Record<ItemDisplayStatus, string> = {
  accepted: 'text-muted-foreground',
  stale: 'text-status-warning-icon',
  needs_check: 'text-status-warning-icon',
  source_missing: 'text-status-warning-icon',
  active_issue: 'text-status-warning-icon',
  expired: 'text-muted-foreground',
  retired: 'text-muted-foreground',
}

/**
 * Words are plain text; a warning status reads in the foreground so it stands out from neutral
 * ones. A neutral status's muted mark keeps its point in the foreground (`heed-ink`).
 */
const statusWords: Record<ItemDisplayStatus, string> = {
  accepted: 'text-muted-foreground heed-ink',
  stale: 'text-foreground',
  needs_check: 'text-foreground',
  source_missing: 'text-foreground',
  active_issue: 'text-foreground',
  expired: 'text-muted-foreground heed-ink',
  retired: 'text-muted-foreground heed-ink',
}

/**
 * A status: a 14 pixel shaped icon and its words (contract 1 and 7.2). The shape carries the
 * meaning, the hue only reinforces it, so colour is never the only sign (NFR-111).
 */
export function StatusMark({
  status,
  iconOnly = false,
  className,
}: {
  status: ItemDisplayStatus
  iconOnly?: boolean
  className?: string
}) {
  const Glyph = statusGlyphs[status]
  if (iconOnly) {
    return (
      <span role="img" aria-label={statusNames[status]} className={cn('inline-flex', className)}>
        <Glyph aria-hidden="true" className={cn('size-icon-sm', statusTone[status])} />
      </span>
    )
  }
  return (
    <span
      data-slot="status-mark"
      data-status={status}
      className={cn('inline-flex min-w-0 items-center gap-2', statusWords[status], className)}
    >
      <Glyph aria-hidden="true" className={cn('size-icon-sm shrink-0', statusTone[status])} />
      <span className="truncate">{statusNames[status]}</span>
    </span>
  )
}

/**
 * A library status as a badge (contract 6.13): soft in the warning tone when it asks for a look
 * (re-check due, source changed, source missing, an active issue), bare and muted when it is
 * quiet (accepted, ended, retired). Each status has its own glyph, so state never relies on
 * colour.
 */
export function StatusBadge({
  status,
  size = 'md',
  label,
  className,
}: {
  status: ItemDisplayStatus
  size?: 'md' | 'sm'
  /** Shorter words in place of the status's name, where something nearby names it in full. */
  label?: string
  className?: string
}) {
  const asks = asksForALook(status)
  return (
    <Badge
      form={asks ? 'soft' : 'bare'}
      // A bare badge is cell text: it keeps the 13 pixel label in compact rows too.
      size={asks ? size : 'md'}
      tone={asks ? 'warning' : 'neutral'}
      quiet={!asks}
      icon={statusGlyphs[status]}
      data-slot="status-badge"
      data-status={status}
      className={className}
    >
      {label ?? statusNames[status]}
    </Badge>
  )
}

/** "Needs checking", the umbrella for the three warning statuses (a filter, a count, a summary). */
export function NeedsALookBadge({ size = 'md' }: { size?: 'md' | 'sm' }) {
  return (
    <Badge form="soft" size={size} tone="warning" icon={EyeIcon}>
      Needs checking
    </Badge>
  )
}

/**
 * A live item with an edit waiting for review. The info tone and its own mark, a ring with a
 * pencil, never one of the seven status glyphs.
 */
export function EditWaitingBadge({ size = 'sm' }: { size?: 'md' | 'sm' }) {
  return (
    <Badge form="soft" size={size} tone="info" icon={HeedEditWaitingIcon}>
      Edit waiting
    </Badge>
  )
}

export const proposalStateLook: Record<ProposalState, { glyph: Icon; tone: BadgeTone | null }> = {
  draft: { glyph: FilePenIcon, tone: null },
  submitted: { glyph: CircleDotIcon, tone: 'info' },
  in_review: { glyph: EyeIcon, tone: 'info' },
  changes_requested: { glyph: MessageSquareIcon, tone: 'warning' },
  accepted: { glyph: CheckIcon, tone: null },
  rejected: { glyph: CircleXIcon, tone: 'danger' },
  withdrawn: { glyph: Undo2Icon, tone: null },
}

/**
 * A proposal state: soft while it waits for someone (waiting for review, in review, changes
 * requested, rejected), bare for a draft or a closed proposal. "Waiting for review" has its own
 * glyph, so it is never confused with an item's pending edit.
 */
export function ProposalStatusBadge({
  state,
  size = 'md',
  iconOnly = false,
}: {
  state: ProposalState
  size?: 'md' | 'sm'
  iconOnly?: boolean
}) {
  const { glyph, tone } = proposalStateLook[state]
  return (
    <Badge
      iconOnly={iconOnly}
      form={tone ? 'soft' : 'bare'}
      size={tone ? size : 'md'}
      tone={tone ?? 'neutral'}
      quiet={!tone}
      icon={glyph}
      data-slot="proposal-status-badge"
    >
      {proposalStateNames[state]}
    </Badge>
  )
}

/**
 * A date as a badge (contract 6.13). Colour is time pressure only: soft amber when the date is
 * within 30 days, soft red when a deadline (a re-check, a review) has passed, otherwise plain
 * text. "Ongoing" is muted. The absolute date is always in the tooltip.
 */
export function DateBadge({
  date,
  today,
  deadline = false,
  empty = 'Ongoing',
  size = 'md',
  className,
}: {
  date: string | null
  /** The service's day; without it the date reads as plain text. */
  today: string | null
  /** True for a date something must happen by: once passed it turns red. */
  deadline?: boolean
  empty?: string
  size?: 'md' | 'sm'
  className?: string
}) {
  if (date === null) {
    return (
      <Badge form="bare" quiet data-slot="date-badge" className={className}>
        {empty}
      </Badge>
    )
  }
  const days = today === null ? null : daysFrom(today, date)
  const plain = (
    <Badge
      form="bare"
      title={formatDay(date, 'long')}
      data-slot="date-badge"
      className={cn(
        'text-foreground tabular-nums',
        days !== null && days < 0 && 'text-muted-foreground',
        className,
      )}
    >
      {formatDay(date)}
    </Badge>
  )
  if (days === null || days > 30) return plain
  if (days < 0 && !deadline) return plain
  const overdue = days < 0
  return (
    <Badge
      form="soft"
      size={size}
      tone={overdue ? 'danger' : 'warning'}
      icon={ClockIcon}
      title={formatDay(date, 'long')}
      data-slot="date-badge"
      className={cn('tabular-nums', className)}
    >
      {overdue
        ? `${-days} ${days === -1 ? 'day' : 'days'} overdue`
        : days === 0
          ? 'Today'
          : `in ${days} ${days === 1 ? 'day' : 'days'}`}
    </Badge>
  )
}

const avatarSize = { sm: 'xs', md: 'sm', lg: 'default' } as const

/**
 * A person as a neutral initials avatar with the name, or the avatar alone (contract 7.2,
 * "Owner"). Avatars stay neutral so colour never competes with a domain. Bare in cells (20 in
 * compact rows, 24 in comfortable ones); `chip` is the outline chip for headers and filters.
 * `role` is a muted line under the name ("Owner of Paid media"): the name and the role stack
 * beside the avatar, which centres on the two, so both lines start at the name.
 */
export function Owner({
  name,
  initials,
  size = 'sm',
  showName = true,
  chip = false,
  role,
  empty = 'No owner',
  className,
}: {
  name: string | null
  /** What a missing person is called: "No deputy" where the column is the deputy. */
  empty?: string
  initials?: string
  size?: 'sm' | 'md' | 'lg'
  showName?: boolean
  chip?: boolean
  role?: string
  className?: string
}) {
  const nameText = (
    <span className={cn('truncate', name ? '' : 'text-muted-foreground')}>{name ?? empty}</span>
  )
  const avatar = (
    <Avatar size={chip ? 'xs' : avatarSize[size]} aria-hidden="true">
      <AvatarFallback>{name ? (initials ?? name.slice(0, 1)).slice(0, 1) : '?'}</AvatarFallback>
    </Avatar>
  )
  return (
    <span
      data-slot="owner"
      className={cn(
        'inline-flex min-w-0 items-center gap-2',
        chip && 'h-6 rounded-full border bg-background pr-2 text-dense',
        className,
      )}
      title={showName ? undefined : (name ?? empty)}
    >
      {avatar}
      {showName && role ? (
        <span className="flex min-w-0 flex-col gap-1">
          {nameText}
          <span className="truncate text-caption text-muted-foreground">{role}</span>
        </span>
      ) : showName ? (
        nameText
      ) : (
        <span className="sr-only">{name ?? empty}</span>
      )}
    </span>
  )
}
