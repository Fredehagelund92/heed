import {
  ShieldCheckIcon,
  UserRoundCheckIcon,
  UserRoundIcon,
  UserRoundPenIcon,
  type Icon,
} from '@/components/icons'
import { previewRender } from '@/components/preview/preview-link'
import { Badge } from '@/components/ui/badge'
import { formatDay } from '@/lib/library'
import { cn } from '@/lib/utils'

/*
  A person in their part of a proposal, as an outline chip in the proposal's header (contract
  6.13, "Owner": an outline chip in headers): "Proposed by Maria Lindqvist, 7 Oct 2026",
  "Reviewer Jon Abara", "Claimed by you". The glyph says the part, the words say it again, and
  the viewer is always "you", so a person finds themselves at a glance.
*/

export const personRoles = ['proposer', 'reviewer', 'claimed', 'approver', 'owner'] as const
export type PersonRole = (typeof personRoles)[number]

const roleLook: Record<PersonRole, { glyph: Icon; other: (name: string) => string; you: string }> =
  {
    proposer: {
      glyph: UserRoundPenIcon,
      other: (name) => `Proposed by ${name}`,
      you: 'Proposed by you',
    },
    reviewer: {
      glyph: UserRoundCheckIcon,
      other: (name) => `${name} reviews this`,
      you: 'You review this',
    },
    claimed: {
      glyph: UserRoundCheckIcon,
      other: (name) => `Claimed by ${name}`,
      you: 'Claimed by you',
    },
    approver: {
      glyph: ShieldCheckIcon,
      other: (name) => `${name} approves this`,
      you: 'You approve this',
    },
    owner: {
      glyph: UserRoundIcon,
      other: (name) => `${name} owns the domain`,
      you: 'You own the domain',
    },
  }

/** The words of a person chip, for a test or a menu that lists the same facts. */
export function personChipText(role: PersonRole, name: string, you: boolean, date?: string | null) {
  const look = roleLook[role]
  const words = you ? look.you : look.other(name)
  return date ? `${words}, ${formatDay(date)}` : words
}

/**
 * Outline by default. `soft` (the info tone) is for the one chip that asks for a look in a header,
 * such as "Claimed by you" on the review screen.
 */
export function PersonChip({
  role,
  name,
  you = false,
  date = null,
  form = 'outline',
  size = 'md',
  personId,
  className,
}: {
  role: PersonRole
  name: string
  /** Who it is, so the chip previews them (their name and the domains they look after). */
  personId?: string | null
  /** True when the person is the viewer: the chip says "you". */
  you?: boolean
  /** A day that belongs to the part, such as the day it was proposed. */
  date?: string | null
  form?: 'outline' | 'soft'
  size?: 'md' | 'sm'
  className?: string
}) {
  const text = personChipText(role, name, you, date)
  return (
    <Badge
      form={form}
      size={size}
      tone={form === 'soft' ? 'info' : 'neutral'}
      icon={roleLook[role].glyph}
      title={personId ? undefined : you ? `${text} (${name})` : text}
      render={personId ? previewRender({ type: 'person', id: personId }) : undefined}
      data-slot="person-chip"
      data-role={role}
      className={cn(personId && 'focus-visible:outline-2 focus-visible:outline-ring', className)}
    >
      {text}
    </Badge>
  )
}
