import type { ReactNode } from 'react'
import { BotIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/person-avatar'
import { Avatar } from '@/components/ui/avatar'
import { useSession } from '@/lib/use-session'
import { cn } from '@/lib/utils'

/*
  Who wrote each turn of the Ask conversation, at a glance: the assistant's turns start with its
  mark, the launcher's ink circle with the bot, and its name; the person's own turns sit on the
  right under "You" and their initials. The initials stay neutral (people get no colour), but in
  foreground ink inside a field-strength ring, so the two marks weigh about the same.
*/

/** The assistant's mark: the launcher's ink circle and bot, at avatar size 24. */
export function AssistantMark() {
  return (
    <Avatar
      size="sm"
      aria-hidden="true"
      data-slot="assistant-mark"
      className="items-center justify-center bg-ink text-ink-foreground after:hidden"
    >
      <BotIcon className="size-icon-sm" />
    </Avatar>
  )
}

/** The head of an assistant turn: its mark and name, then whatever follows (the edition). */
export function AssistantLabel({ children }: { children?: ReactNode }) {
  return (
    <div
      data-slot="ask-turn-label"
      data-role="assistant"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="flex items-center gap-2 text-dense font-bold">
        <AssistantMark />
        Assistant
      </span>
      {children}
    </div>
  )
}

/**
 * The head of the person's own turn, on the right: "You" and their initials. Hidden from a screen
 * reader, which hears "You asked" with the question itself.
 */
export function YouLabel({ className }: { className?: string }) {
  const person = useSession().data?.person
  return (
    <div
      data-slot="ask-turn-label"
      data-role="user"
      aria-hidden="true"
      className={cn('flex items-center justify-end gap-2 text-dense font-bold', className)}
    >
      You
      {person ? <PersonAvatar person={person} size="sm" decorative strong /> : null}
    </div>
  )
}
