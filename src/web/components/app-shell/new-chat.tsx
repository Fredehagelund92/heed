import { SquarePenIcon } from '@/components/icons'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  requestNewChat,
  startNewChat,
  useAskChat,
  useAskDraft,
  useNewChatConfirm,
} from '@/lib/assistant-chat'
import { draftText } from '@/lib/ask-draft'
import { cn } from '@/lib/utils'

/*
  New chat (Assistant board, A): starts the conversation afresh, with nothing of the old one
  kept, in the header of the assistant's page and in the panel's bar, and as a command. It asks
  first only when a question is typed and not sent, which it would lose; the chat so far is not
  saved anywhere, so there is nothing else to warn about.
*/

/** The composer takes the focus, so the next question can be typed at once. */
function focusComposer() {
  document.querySelector<HTMLElement>('[data-question]')?.focus()
}

/** New chat, with its words: there is a conversation or a typed question to start over from. */
export function NewChatButton({ className }: { className?: string }) {
  const { messages } = useAskChat()
  const [draft] = useAskDraft()
  const empty = messages.length === 0 && !draftText(draft).trim()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="toolbar"
            disabled={empty}
            data-slot="ask-new-chat"
            onClick={() => {
              requestNewChat()
              focusComposer()
            }}
            className={cn('max-md:size-control-touch max-md:px-0', className)}
          />
        }
      >
        <SquarePenIcon />
        <span className="max-md:sr-only">New chat</span>
      </TooltipTrigger>
      <TooltipContent>
        {empty ? 'This chat is empty' : "Start a new chat; this one isn't kept"}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The question New chat asks before it drops a typed question. The panel and the page each mount
 * it (never both at once), so the command asks it too, on either tab.
 */
export function NewChatConfirm() {
  const [open, setOpen] = useNewChatConfirm()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Start a new chat?"
      effect="The question you typed hasn't been sent, and it goes with the chat so far. Neither is saved."
      action="Start new chat"
      actionIcon={SquarePenIcon}
      cancelLabel="Keep typing"
      tone="destructive"
      onConfirm={() => {
        startNewChat()
        // After the dialog gives the focus back, so it lands in the empty composer.
        requestAnimationFrame(focusComposer)
      }}
    />
  )
}
