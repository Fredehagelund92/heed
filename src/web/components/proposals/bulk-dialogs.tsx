import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { BulkPlan } from '@/api'
import { bulkPlanQuery } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import {
  CheckCheckIcon,
  CircleSlashIcon,
  CircleXIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  UserRoundCheckIcon,
} from '@/components/icons'
import { reasonSuggestions } from '@/components/review/decision-bar'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import type { BulkAction } from '@/lib/commands'
import type { QueueRow } from '@/lib/review'
import { cn } from '@/lib/utils'

/*
  The dialogs of the queue's bulk actions (FR-223). A decision first reads the plan from the
  service: which selected proposals it decides and what happens to each (published, waiting for
  the approver, or decided), and which it leaves out and why, each named. Then one reason for
  all. The confirm sends nothing yet: the queue holds the step for Undo (lib/held-action.ts).
*/

type Outcome = Exclude<BulkAction, 'assign'>

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

const verbs: Record<Outcome, { title: string; action: string; done: string; why: string }> = {
  accept: {
    title: 'Accept',
    action: 'Accept',
    done: 'accepted',
    why: 'Why are you accepting them?',
  },
  request_changes: {
    title: 'Ask for changes on',
    action: 'Ask for changes on',
    done: 'returned',
    why: 'Why are you asking for changes?',
  },
  reject: {
    title: 'Reject',
    action: 'Reject',
    done: 'rejected',
    why: 'Why are you rejecting them?',
  },
}

const effectWords: Record<BulkPlan['decided'][number]['effect'], string> = {
  publish: 'AI apps get it',
  wait: 'Waits for an approver',
  decide: 'Decided',
}

/** The effect, in one sentence, from the plan. */
function effectOf(outcome: Outcome, plan: BulkPlan | undefined, rows: readonly QueueRow[]) {
  if (!plan) return 'Checking what this does to each proposal.'
  const decided = plan.decided.length
  if (!decided) return 'None of the selected proposals can be decided this way. Each says why.'
  if (outcome === 'reject')
    return `Each of the ${count(decided, 'proposal')} gets your decision with this reason and closes. AI apps never get them.`
  if (outcome === 'request_changes')
    return `Each of the ${count(decided, 'proposal')} goes back to its proposer with this reason.`
  const published = plan.decided.filter((entry) => entry.effect === 'publish').length
  const waiting = decided - published
  // Terms and retirements have no checks; an item's run again before it is accepted.
  const checked = rows.some(
    (row) =>
      plan.decided.some((entry) => entry.id === row.id) &&
      row.change !== 'term' &&
      row.change !== 'retire',
  )
  return [
    checked
      ? 'Each gets your decision with this reason. We run the checks again on each fact first.'
      : 'Each gets your decision with this reason.',
    published
      ? `AI apps get ${published === decided ? (decided === 1 ? 'it' : 'them') : `${published.toLocaleString('en')} of them`} within a minute.`
      : '',
    waiting
      ? `${count(waiting, 'high-risk proposal')} ${waiting === 1 ? 'waits' : 'wait'} for an approver.`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** What the step does to each proposal, then what it leaves out and why. */
export function BulkPlanList({ plan }: { plan: BulkPlan }) {
  return (
    <div className="flex max-h-list flex-col gap-4 overflow-y-auto" data-slot="bulk-plan">
      {plan.decided.length ? (
        <section aria-label="Decided" className="flex flex-col gap-2">
          <h3 className="text-caption font-bold text-muted-foreground">
            {count(plan.decided.length, 'proposal')} decided
          </h3>
          <ul className="flex flex-col gap-1">
            {plan.decided.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 text-dense">
                <span className="min-w-0 flex-1 break-words">
                  <span className="text-muted-foreground tabular-nums">#{entry.number} </span>
                  {entry.title}
                </span>
                <Badge
                  size="sm"
                  form="bare"
                  quiet={entry.effect !== 'wait'}
                  tone={entry.effect === 'wait' ? 'warning' : 'neutral'}
                  icon={entry.effect === 'wait' ? ShieldCheckIcon : undefined}
                  className="shrink-0"
                >
                  {effectWords[entry.effect]}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {plan.skipped.length ? (
        <section aria-label="Left out" className="flex flex-col gap-2">
          <h3 className="text-caption font-bold text-muted-foreground">
            {count(plan.skipped.length, 'proposal')} left out
          </h3>
          <ul className="flex flex-col gap-2">
            {plan.skipped.map((entry) => (
              <li
                key={entry.id}
                data-code={entry.code}
                className="flex items-start gap-2 text-dense"
              >
                <CircleSlashIcon
                  aria-hidden="true"
                  className={cn(
                    'size-icon-sm shrink-0 translate-y-0.5',
                    entry.code === 'checks_failed'
                      ? 'text-status-danger-fg'
                      : 'text-muted-foreground',
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words">
                    {entry.number !== null ? (
                      <span className="text-muted-foreground tabular-nums">#{entry.number} </span>
                    ) : null}
                    {entry.title ?? 'A proposal you can no longer see'}
                  </span>
                  <span className="text-caption text-muted-foreground">{entry.message}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/** One of the three decisions for the selected proposals, with the plan before the reason. */
export function BulkDecisionDialog({
  outcome,
  rows,
  onOpenChange,
  onConfirm,
}: {
  /** The decision, while its dialog is open. */
  outcome: Outcome | null
  rows: readonly QueueRow[]
  onOpenChange: (open: boolean) => void
  /** Holds the step for Undo; the plan names what it decides. */
  onConfirm: (input: { outcome: Outcome; reason: string; plan: BulkPlan }) => void
}) {
  const shown = outcome ?? 'accept'
  const plan = useQuery({
    ...bulkPlanQuery({
      proposals: rows.map(({ id, revision }) => ({ id, revision })),
      outcome: shown,
    }),
    enabled: outcome !== null && rows.length > 0,
  })
  const decided = plan.data?.decided.length ?? 0
  const subject: 'create' | 'term' = rows.every((row) => row.change === 'term') ? 'term' : 'create'
  return (
    <ConfirmDialog
      key={shown}
      open={outcome !== null}
      onOpenChange={onOpenChange}
      title={`${verbs[shown].title} ${count(rows.length, 'selected proposal')}?`}
      effect={effectOf(shown, plan.data, rows)}
      action={
        plan.data ? `${verbs[shown].action} ${decided.toLocaleString('en')}` : verbs[shown].action
      }
      actionIcon={
        shown === 'accept' ? CheckCheckIcon : shown === 'reject' ? CircleXIcon : MessageSquareIcon
      }
      tone={shown === 'reject' ? 'destructive' : 'default'}
      reason={{
        label: verbs[shown].why,
        required: true,
        hint: 'One reason for every proposal decided. Everyone who can see a proposal reads it.',
        suggestions: reasonSuggestions[shown][subject],
      }}
      onConfirm={({ reason }) => {
        if (!plan.data) throw new Error('Wait until the dialog says what this does to each.')
        if (!plan.data.decided.length)
          throw new Error('None of the selected proposals can be decided this way.')
        onConfirm({ outcome: shown, reason, plan: plan.data })
      }}
    >
      {plan.isError ? (
        <Alert variant="danger" role="alert">
          <CircleXIcon aria-hidden />
          <AlertContent>
            <AlertTitle>We couldn&apos;t check the selected proposals</AlertTitle>
            <AlertDescription>Nothing was decided. Close this and try again.</AlertDescription>
          </AlertContent>
        </Alert>
      ) : plan.data ? (
        <BulkPlanList plan={plan.data} />
      ) : (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Checking the selected proposals</span>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
    </ConfirmDialog>
  )
}

/** The reviewers who may take the selected proposals: the owners of their domains. */
export function bulkReviewers(
  rows: readonly QueueRow[],
  areas: readonly Area[],
  nameOf: (id: string) => string | null,
  viewerId: string,
) {
  const reviewers = new Map<string, { id: string; name: string; domains: string[] }>()
  for (const area of areas) {
    if (!rows.some((row) => row.areaId === area.id)) continue
    for (const id of area.ownerIds) {
      const entry = reviewers.get(id) ?? { id, name: nameOf(id) ?? 'An owner', domains: [] }
      entry.domains.push(area.name)
      reviewers.set(id, entry)
    }
  }
  return [...reviewers.values()].sort(
    (a, b) => Number(b.id === viewerId) - Number(a.id === viewerId) || a.name.localeCompare(b.name),
  )
}

/** Assign the selected proposals: claim them, or hand them to another reviewer of their domain. */
export function BulkAssignDialog({
  open,
  onOpenChange,
  rows,
  areas,
  nameOf,
  viewerId,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: readonly QueueRow[]
  areas: readonly Area[]
  nameOf: (id: string) => string | null
  viewerId: string
  onConfirm: (personId: string) => void
}) {
  const reviewers = bulkReviewers(rows, areas, nameOf, viewerId)
  const [chosen, setChosen] = useState<string | null>(null)
  const person = chosen ?? reviewers[0]?.id ?? null
  const claimable = rows.filter((row) => row.change === 'create' || row.change === 'change').length
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setChosen(null)
        onOpenChange(next)
      }}
      title={`Assign ${count(rows.length, 'selected proposal')}?`}
      effect={
        claimable === rows.length
          ? 'The owner you choose reviews them and gets a notification.'
          : `The owner you choose reviews the ${count(claimable, 'new fact or change', 'new facts and changes')}. Proposals to add names or archive facts aren't assigned.`
      }
      action="Assign"
      actionIcon={UserRoundCheckIcon}
      onConfirm={() => {
        if (!person) throw new Error('Choose who takes them.')
        onConfirm(person)
      }}
    >
      {reviewers.length ? (
        <RadioGroup
          aria-label="Who takes them"
          value={person ?? ''}
          onValueChange={(value) => setChosen(String(value))}
          className="flex flex-col gap-2"
        >
          {reviewers.map((reviewer) => (
            <label key={reviewer.id} className="flex items-start gap-3 text-dense">
              <RadioGroupItem value={reviewer.id} className="translate-y-0.5" />
              <span className="flex min-w-0 flex-col">
                <span className="font-bold">
                  {reviewer.id === viewerId ? `You (${reviewer.name})` : reviewer.name}
                </span>
                <span className="text-caption text-muted-foreground">
                  Owns {reviewer.domains.join(', ')}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      ) : (
        <p className="text-dense text-muted-foreground">
          The selected proposals have no owner to take them.
        </p>
      )}
    </ConfirmDialog>
  )
}
