import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toApiError, type ProposalRecord } from '@/api'
import { proposalQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { EllipsisIcon, PencilLineIcon, Trash2Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatHotkey } from '@/lib/commands'
import {
  discardedWords,
  discardFailureWords,
  discardWords,
  forgetDraftBackup,
  markDiscarding,
  type DiscardFailure,
} from '@/lib/discarding'
import { holdAction } from '@/lib/held-action'
import { isUnsubmittedDraft } from '@/lib/my-drafts'
import { editLinkOf, proposalTitle } from '@/lib/proposals'
import { showToast } from '@/lib/toast'
import { useSession } from '@/lib/use-session'

/*
  Discarding drafts from a list: Home's Your drafts and Proposals > Mine, one draft from its row's
  menu or many from the selection bar (Linear's row menu and floating bar, Gmail's Discard drafts
  with Undo). One confirmation names how many and the first few titles. The drafts then leave
  every list at once and a toast offers Undo for 8 seconds (lib/held-action.ts); only when it
  closes are they sent to the service, one after another, through the same discard the draft's
  own page uses. The service keeps no way back, so the hold is the Undo. A draft the service
  would not discard comes back, and the toast says which and why.
*/

/** Why one draft was not discarded, in the person's words. */
function failureMessage(error: unknown): string {
  const failure = toApiError(error)
  if (failure.kind === 'forbidden') return "You can't discard it"
  if (failure.kind === 'unavailable') return "We didn't get an answer. Try again"
  return failure.message || "It wasn't discarded"
}

/**
 * The discard step of a list: `ask` opens the confirmation for the drafts among `records`, and
 * `dialog` is the confirmation to render. `onHold` runs once they have left the list (to clear a
 * selection), `onUndo` once Undo brought them back (to select them again). `finalFocus` says where
 * the focus goes when the confirmation closes, since the row that opened it is gone.
 */
export function useDiscardDrafts({
  onHold,
  onUndo,
  finalFocus,
}: {
  onHold?: (ids: readonly string[]) => void
  onUndo?: (ids: readonly string[]) => void
  finalFocus?: (ids: readonly string[]) => HTMLElement | null
} = {}) {
  const { data: session } = useSession()
  const viewerId = session?.person.id ?? ''
  const queryClient = useQueryClient()
  const discard = useApiWrite('discardDraft')
  const [open, setOpen] = useState(false)
  // The drafts the open confirmation discards: the ones asked for when it opened.
  const [chosen, setChosen] = useState<readonly ProposalRecord[]>([])
  // The drafts the last confirmation sent on their way: the focus moves past their rows.
  const held = useRef<readonly string[]>([])

  /** Discards one draft, on its newest revision when it moved on meanwhile (an autosave). */
  const discardOne = async (record: ProposalRecord): Promise<DiscardFailure | null> => {
    const title = proposalTitle(record)
    try {
      await discard.mutateAsync({ id: record.id, revision: record.revision })
    } catch (error) {
      const failure = toApiError(error)
      // Gone already: discarded elsewhere, which is what was asked.
      if (failure.kind === 'not-found') return null
      if (failure.kind !== 'conflict') return { title, message: failureMessage(error) }
      const fresh =
        failure.current ??
        (await queryClient
          .fetchQuery({ ...proposalQuery(record.id), staleTime: 0 })
          .catch(() => null))
      if (!fresh) return null
      if (!isUnsubmittedDraft(fresh))
        return {
          title,
          message: 'It was sent for review in the meantime. Withdraw it from its page instead',
        }
      try {
        await discard.mutateAsync({ id: fresh.id, revision: fresh.revision })
      } catch (again) {
        if (toApiError(again).kind === 'not-found') return null
        return { title, message: failureMessage(again) }
      }
    }
    forgetDraftBackup(viewerId, record)
    return null
  }

  const hold = () => {
    const drafts = chosen
    const ids = drafts.map((record) => record.id)
    const release = markDiscarding(ids)
    held.current = ids
    onHold?.(ids)
    holdAction({
      title: discardedWords(drafts.length),
      undone: () => {
        release()
        onUndo?.(ids)
      },
      send: async () => {
        try {
          const failures: DiscardFailure[] = []
          for (const record of drafts) {
            const failure = await discardOne(record)
            if (failure) failures.push(failure)
          }
          const words = discardFailureWords(drafts.length, failures)
          if (words) showToast(words.title, words.description, { timeout: 10000 })
        } finally {
          // The lists hold the service's answer already: what was discarded is gone from them.
          release()
        }
      },
    })
  }

  const words = discardWords(chosen.map(proposalTitle))
  return {
    /** Opens the confirmation for the unsubmitted drafts among `records`; others are left out. */
    ask: (records: readonly ProposalRecord[]) => {
      const drafts = records.filter(isUnsubmittedDraft)
      if (!drafts.length) return
      setChosen(drafts)
      held.current = []
      setOpen(true)
    },
    dialog: (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={words.title}
        effect={words.effect}
        action={words.action}
        actionIcon={Trash2Icon}
        tone="destructive"
        finalFocus={() => (held.current.length ? finalFocus?.(held.current) : null) ?? true}
        onConfirm={hold}
      >
        {chosen.length > 1 ? (
          <ul
            aria-label="Drafts to discard"
            data-slot="discard-titles"
            className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-dense"
          >
            {words.shown.map((title, index) => (
              <li key={index} className="truncate">
                {title}
              </li>
            ))}
            {words.more ? (
              <li className="text-muted-foreground tabular-nums">
                And {words.more.toLocaleString('en')} more
              </li>
            ) : null}
          </ul>
        ) : chosen[0] ? (
          <p data-slot="discard-titles" className="rounded-md bg-muted px-3 py-2 text-dense">
            {proposalTitle(chosen[0])}
          </p>
        ) : null}
      </ConfirmDialog>
    ),
  }
}

/** The key that discards the focused draft, or the selected ones: Linear's delete. */
export const DISCARD_HOTKEY = 'mod+backspace'

/** Whether a key press is the discard key, Command or Control Backspace. */
export function isDiscardKey(event: { key: string; metaKey: boolean; ctrlKey: boolean }) {
  return event.key === 'Backspace' && (event.metaKey || event.ctrlKey)
}

/** The discard key as the menus show it: ⌘⌫, or Ctrl+Backspace. */
export function discardKeyHint() {
  const keys = formatHotkey(DISCARD_HOTKEY)
  return keys.join(keys.every((key) => key.length === 1) ? '' : '+')
}

/**
 * A draft row's own menu (contract 8.2, the row button): one quiet `...` button, shown while the
 * row is hovered or focused and always on a touch screen. Continue editing opens the draft's
 * form; Discard draft, last and apart, asks first. The key beside it does the same from the row.
 */
export function DraftRowMenu({
  record,
  onDiscard,
  className,
}: {
  record: ProposalRecord
  onDiscard: () => void
  className?: string
}) {
  const title = proposalTitle(record)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${title}`}
            data-slot="draft-row-menu"
            className={className}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-menu">
        <DropdownMenuItem render={<Link {...editLinkOf(record)} />}>
          <PencilLineIcon />
          Continue editing
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={onDiscard}
          aria-keyshortcuts="Meta+Backspace Control+Backspace"
        >
          <Trash2Icon />
          Discard draft
          {/* Named by aria-keyshortcuts: the item reads as Discard draft. */}
          <DropdownMenuShortcut aria-hidden="true">{discardKeyHint()}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
