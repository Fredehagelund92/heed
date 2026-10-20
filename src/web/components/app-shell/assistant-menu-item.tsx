import { BotIcon } from '@/components/icons'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useShellActions } from './shell-actions'

/**
 * The launcher folded into a phone bar's More menu (`PagePhoneActions holdsAssistant`): the
 * same assistant, docked as the launcher docks it. A module of its own: the launcher is in the
 * first load, and Base UI's menu is not.
 */
export function AssistantMenuItem() {
  const { toggleAssistant } = useShellActions()
  return (
    <DropdownMenuItem onClick={() => toggleAssistant()}>
      <BotIcon />
      Ask the assistant
    </DropdownMenuItem>
  )
}
