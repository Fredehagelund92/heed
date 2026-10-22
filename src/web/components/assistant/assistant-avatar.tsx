import type { ComponentProps } from 'react'
import { BotIcon } from '@/components/icons'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

/**
 * The assistant's avatar: the pale Heed blue with the bot in the deeper blue, sized like a
 * person's. Decorative: "Assistant" is written beside it.
 */
export function AssistantAvatar({ size }: { size?: ComponentProps<typeof Avatar>['size'] }) {
  return (
    <Avatar size={size} aria-hidden="true" data-slot="assistant-mark" className="after:hidden">
      <AvatarFallback className="bg-assistant-avatar-bg text-assistant-avatar-fg">
        <BotIcon className="size-4 group-data-[size=xs]/avatar:size-3" />
      </AvatarFallback>
    </Avatar>
  )
}
