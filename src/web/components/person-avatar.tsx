import type { Person } from '@domain/item'
import { BotIcon } from '@/components/icons'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

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

/**
 * The AI app mark (contract 7.2, `Owner` with an AI app): a small ink disc with the bot glyph on
 * the end of a person's avatar, when an AI app or the assistant drafted with them. The person
 * stays the author; the app is never an avatar of its own. The avatar's parent is `relative`.
 */
export function AiAppMark({ size = 'sm', className }: { size?: 'xs' | 'sm'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="ai-app-mark"
      className={cn(
        'absolute -right-0.5 -bottom-0.5 z-raised flex items-center justify-center rounded-full bg-foreground text-background ring-2 ring-background',
        size === 'xs' ? 'size-3' : 'size-4',
        className,
      )}
    >
      <BotIcon className={size === 'xs' ? 'size-2' : 'size-3'} />
    </span>
  )
}
