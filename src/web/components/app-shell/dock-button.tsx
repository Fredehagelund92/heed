import { HeaderActions } from './header-actions'
import { useShellActions } from './shell-actions'
import { Minimize2Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatHotkey } from '@/lib/commands'

/**
 * Dock, in the header of the assistant's pages (contract 9.8): the assistant leaves its page and
 * docks beside the page the person came from, with the same conversation, as Command or Control
 * backslash does. It is the opposite of the panel's Open page.
 */
export function DockButton() {
  const { toggleAssistant } = useShellActions()
  const keys = formatHotkey('mod+backslash').join('')
  return (
    <HeaderActions phone>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="toolbar"
              onClick={() => toggleAssistant()}
              className="max-md:size-control-touch max-md:px-0"
            />
          }
        >
          <Minimize2Icon />
          <span className="max-md:sr-only">Dock</span>
        </TooltipTrigger>
        <TooltipContent>Dock beside the page ({keys})</TooltipContent>
      </Tooltip>
    </HeaderActions>
  )
}
