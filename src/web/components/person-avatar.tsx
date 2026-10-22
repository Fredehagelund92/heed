import type { Person } from '@domain/item'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { avatarSlot } from '@/lib/avatar-colour'
import { cn } from '@/lib/utils'

/** The classes of each palette slot, written out in full so Tailwind can see every one. */
const slotClass = [
  'bg-avatar-1-bg text-avatar-1-fg',
  'bg-avatar-2-bg text-avatar-2-fg',
  'bg-avatar-3-bg text-avatar-3-fg',
  'bg-avatar-4-bg text-avatar-4-fg',
  'bg-avatar-5-bg text-avatar-5-fg',
  'bg-avatar-6-bg text-avatar-6-fg',
  'bg-avatar-7-bg text-avatar-7-fg',
  'bg-avatar-8-bg text-avatar-8-fg',
] as const

type AvatarSize = 'xs' | 'sm' | 'default' | 'md' | 'lg'

/**
 * A person as a circle of initials on a soft tint, the one way a person is drawn as an avatar.
 * The tint comes from the person's stable id (see `avatarSlot`), so it never changes with a
 * rename; without an id it comes from the name. Colour is never the only sign: the initials
 * and, unless `decorative`, the name sit with it. 28 in rows (`sm`), 32 in the assistant chat
 * (`default`), 36 on the sidebar card (`md`).
 */
export function PersonAvatar({
  person,
  size,
  decorative = false,
  className,
}: {
  person: Pick<Person, 'initials' | 'name'> & { id?: string | null }
  size?: AvatarSize
  /** Beside the person's name, so neither the initials nor a tooltip repeat it. */
  decorative?: boolean
  className?: string
}) {
  const key = person.id || person.name
  const slot = key ? avatarSlot(key) : null
  return (
    <Avatar
      size={size}
      title={decorative ? undefined : person.name}
      aria-hidden={decorative || undefined}
      data-colour={slot ?? undefined}
      className={cn('after:hidden', className)}
    >
      <AvatarFallback className={slot ? slotClass[slot - 1] : undefined}>
        {person.initials}
      </AvatarFallback>
    </Avatar>
  )
}
