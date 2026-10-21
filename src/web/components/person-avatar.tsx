import type { Person } from '@domain/item'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

/**
 * A person as a neutral circle with initials. People get no colour: colour belongs to kinds,
 * domains and statuses (design contract 6.1). The only way a person is shown as an avatar.
 */
export function PersonAvatar({
  person,
  size,
  decorative = false,
  strong = false,
}: {
  person: Pick<Person, 'initials' | 'name'>
  size?: 'sm' | 'default' | 'lg'
  /** Beside the person's name, so neither the initials nor a tooltip repeat it. */
  decorative?: boolean
  /** Initials in foreground ink inside a field-strength ring, to weigh against a filled mark. */
  strong?: boolean
}) {
  return (
    <Avatar
      size={size}
      title={decorative ? undefined : person.name}
      aria-hidden={decorative || undefined}
      className={strong ? 'after:border-input' : undefined}
    >
      <AvatarFallback className={strong ? 'text-foreground' : undefined}>
        {person.initials}
      </AvatarFallback>
    </Avatar>
  )
}
