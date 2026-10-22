import type { ReactNode } from 'react'
import { AssistantAvatar } from '@/components/assistant/assistant-avatar'
import { PersonAvatar } from '@/components/person-avatar'
import { useSession } from '@/lib/use-session'
import { cn } from '@/lib/utils'

/*
  Who wrote each turn of the Ask conversation, at a glance: the assistant's turns start with its
  mark, a pale blue circle with the bot in the deeper Heed blue, and its name; the person's own
  turns sit on the right under "You" and their initials on their own soft tint. Both are 32.
*/

/** The assistant's mark: its pale blue avatar and bot, sized like the person's (32). */
export function AssistantMark() {
  return <AssistantAvatar />
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
      {person ? <PersonAvatar person={person} decorative /> : null}
    </div>
  )
}
