import { useState, type ReactNode } from 'react'
import type { Area } from '@domain/item'
import { toApiError, type BulkDecision, type BulkPlan, type BulkSkip } from '@/api'
import { useApiWrite } from '@/api/queries'
import {
  CheckCheckIcon,
  CircleXIcon,
  MessageSquareIcon,
  UserRoundCheckIcon,
} from '@/components/icons'
import { SelectionBar, SelectionBarButton } from '@/components/page/selection-bar'
import type { BulkAction } from '@/lib/commands'
import { markDeciding } from '@/lib/deciding'
import { holdAction } from '@/lib/held-action'
import type { QueueRow } from '@/lib/review'
import { showToast } from '@/lib/toast'
import { BulkAssignDialog, BulkDecisionDialog } from './bulk-dialogs'

/*
  The review queue's bulk steps (FR-223, Linear's triage): the floating bar over the selection,
  the dialogs, and the held send. A confirmed step takes its proposals out of the queue and its
  counts at once (lib/deciding.ts) and offers Undo for 8 seconds; only then is it sent, and the
  toast that follows names what was decided, what was published and what was left out. A step
  the service refuses brings its proposals back.
*/

type Outcome = Exclude<BulkAction, 'assign'>

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

const doneWords: Record<Outcome, string> = {
  accept: 'accepted',
  request_changes: 'sent back for changes',
  reject: 'rejected',
}

/** One proposal left out, in the result toast: "#12 Norway closure: You proposed it." */
const skipLine = (skip: BulkSkip) =>
  `${skip.number !== null ? `#${skip.number} ` : ''}${skip.title ?? 'A proposal'}: ${skip.message}`

/** What a bulk decision did, in a toast: how many, the editions, and the first left out. */
function resultWords(outcome: Outcome, result: BulkDecision) {
  const decided = result.proposals.length
  const waiting = result.proposals.filter((p) => p.state !== 'accepted').length
  const title = decided
    ? `${count(decided, 'proposal')} ${doneWords[outcome]}`
    : 'Nothing was decided'
  const parts = [
    outcome === 'accept' && result.editions.length
      ? `AI apps get ${decided - waiting === 1 ? 'it' : 'them'} within a minute.`
      : '',
    outcome === 'accept' && waiting
      ? `${count(waiting, 'proposal')} ${waiting === 1 ? 'waits' : 'wait'} for an approver.`
      : '',
    result.skipped.length
      ? `${count(result.skipped.length, 'proposal')} left out. ${skipLine(result.skipped[0]!)}${result.skipped.length > 1 ? ` And ${result.skipped.length - 1} more.` : ''}`
      : '',
  ].filter(Boolean)
  return { title, description: parts.join(' ') }
}

/** The bulk steps of the queue: open a dialog, hold the confirmed step, send it, say what it did. */
export function useBulkSteps({
  rows,
  nameOf,
  onHold,
  onUndo,
}: {
  /** The selected rows, in the queue's order. */
  rows: readonly QueueRow[]
  nameOf: (id: string) => string | null
  /** The step is held: its proposals have left the queue, and leave the selection. */
  onHold: (ids: readonly string[]) => void
  /** The step was undone: its proposals are back in the queue, to select again. */
  onUndo: (ids: readonly string[]) => void
}) {
  const decideMany = useApiWrite('decideMany')
  const assign = useApiWrite('assignProposals')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [assigning, setAssigning] = useState(false)
  // The rows the open dialog decides: the selection when it opened.
  const [chosen, setChosen] = useState<readonly QueueRow[]>([])

  const open = (action: BulkAction) => {
    if (!rows.length) return
    setChosen(rows)
    if (action === 'assign') setAssigning(true)
    else setOutcome(action)
  }

  const holdDecision = ({
    outcome: decision,
    reason,
    plan,
  }: {
    outcome: Outcome
    reason: string
    plan: BulkPlan
  }) => {
    const ids = plan.decided.map((entry) => entry.id)
    const targets = chosen
      .filter((row) => ids.includes(row.id))
      .map(({ id, revision }) => ({ id, revision }))
    setOutcome(null)
    const release = markDeciding(ids, decision)
    onHold(ids)
    holdAction({
      title: `${count(ids.length, 'proposal')} ${doneWords[decision]}`,
      description: plan.skipped.length
        ? `${count(plan.skipped.length, 'proposal')} left out ${plan.skipped.length === 1 ? 'stays' : 'stay'} selected. Undo takes the step back before it's sent.`
        : "Undo takes it back before it's sent.",
      undone: () => {
        release()
        onUndo(ids)
      },
      send: async () => {
        try {
          const result = await decideMany.mutateAsync({
            proposals: targets,
            outcome: decision,
            reason,
          })
          const { title, description } = resultWords(decision, result)
          showToast(title, description, { timeout: result.skipped.length ? 10000 : 5000 })
        } catch (error) {
          showToast(
            'Nothing was decided',
            `${toApiError(error).message.replace(/\.?$/, '.')} The proposals are back in To review.`,
          )
        } finally {
          // The queue holds the service's answer already: what was decided is gone from it.
          release()
        }
      },
    })
  }

  const holdAssignment = (personId: string) => {
    const claimable = chosen.filter((row) => row.change === 'create' || row.change === 'change')
    const ids = claimable.map((row) => row.id)
    setAssigning(false)
    if (!ids.length) {
      showToast('Nothing to assign', "Proposals to add names or archive facts aren't assigned.")
      return
    }
    const who = nameOf(personId) ?? 'the owner'
    // Assigning keeps the proposals in the queue: they only change hands.
    holdAction({
      title: `${count(ids.length, 'proposal')} assigned to ${who}`,
      description: "Undo takes it back before it's sent.",
      // Nothing left the queue, so nothing comes back.
      undone: () => undefined,
      send: async () => {
        try {
          const result = await assign.mutateAsync({
            proposals: claimable.map(({ id, revision }) => ({ id, revision })),
            personId,
          })
          showToast(
            `${count(result.proposals.length, 'proposal')} assigned to ${who}`,
            result.skipped.length
              ? `${count(result.skipped.length, 'proposal')} left out. ${skipLine(result.skipped[0]!)}`
              : `${who} is told in the app.`,
          )
        } catch (error) {
          showToast('Nothing was assigned', toApiError(error).message)
        }
      },
    })
  }

  return {
    open,
    dialogs: ({ areas, viewerId }: { areas: readonly Area[]; viewerId: string }): ReactNode => (
      <>
        <BulkDecisionDialog
          outcome={outcome}
          rows={chosen}
          onOpenChange={(next) => {
            if (!next) setOutcome(null)
          }}
          onConfirm={holdDecision}
        />
        <BulkAssignDialog
          open={assigning}
          onOpenChange={setAssigning}
          rows={chosen}
          areas={areas}
          nameOf={nameOf}
          viewerId={viewerId}
          onConfirm={holdAssignment}
        />
      </>
    ),
  }
}

/**
 * The floating bar over the selected proposals (contract 8.7): how many, how many of them have a
 * failed required check, the three decisions and Assign, and Clear. Each opens its dialog, which
 * says what will happen to each before anything is sent.
 */
export function QueueSelectionBar({
  rows,
  onRun,
  onClear,
}: {
  rows: readonly QueueRow[]
  onRun: (action: BulkAction) => void
  onClear: () => void
}) {
  return (
    <SelectionBar count={rows.length} label="Selected proposals" onClear={onClear}>
      <QueueBulkButtons rows={rows} onRun={onRun} />
    </SelectionBar>
  )
}

/**
 * The queue's steps on the selection bar: how many of the rows have a failed required check, the
 * three decisions and Assign. Proposals > Mine puts them beside Discard when it holds both.
 */
export function QueueBulkButtons({
  rows,
  onRun,
}: {
  rows: readonly QueueRow[]
  onRun: (action: BulkAction) => void
}) {
  const failing = rows.filter((row) => row.checks?.failed.length).length
  return (
    <>
      {failing ? (
        <span
          data-slot="selection-failing"
          className="flex items-center gap-1 px-2 whitespace-nowrap text-ink-foreground"
        >
          <CircleXIcon aria-hidden="true" className="size-icon-sm" />
          {failing} with a failed check
        </span>
      ) : null}
      <SelectionBarButton onClick={() => onRun('accept')}>
        <CheckCheckIcon />
        Accept
      </SelectionBarButton>
      <SelectionBarButton onClick={() => onRun('request_changes')}>
        <MessageSquareIcon />
        Ask for changes
      </SelectionBarButton>
      <SelectionBarButton onClick={() => onRun('reject')}>
        <CircleXIcon />
        Reject
      </SelectionBarButton>
      <SelectionBarButton onClick={() => onRun('assign')}>
        <UserRoundCheckIcon />
        Assign
      </SelectionBarButton>
    </>
  )
}
