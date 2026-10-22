import { useState } from 'react'
import { toApiError } from '@/api'
import { useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { CheckCheckIcon, CircleXIcon, ListChecksIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { underReview } from '@/lib/review'
import { showToast } from '@/lib/toast'
import { reasonSuggestions } from './decision-bar'
import type { ReviewModel } from './review-model'

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** Why a batch decision did not go through, in words for the dialog. */
function batchFailure(error: unknown): string {
  const failure = toApiError(error)
  const named = failure.findings.find((finding) => finding.severity === 'error')
  if (named) return named.message
  if (failure.kind === 'forbidden' || failure.kind === 'conflict' || failure.kind === 'not-found')
    return failure.message
  return "We couldn't save your decision. Try again."
}

/**
 * A term an administrator proposed with others in one step (Propose terms, FR-125): how many of
 * them still wait, and Accept all or Reject all for whoever may decide this one. Each term still
 * gets its own decision; an accept publishes every term as one edition.
 */
export function ReviewTermBatch({
  model,
  headingLevel = 2,
}: {
  model: ReviewModel
  headingLevel?: 2 | 3
}) {
  const batch = model.review.termBatch
  const decide = useApiWrite('decideTermBatch')
  const [open, setOpen] = useState<'accept' | 'reject' | null>(null)
  if (model.change !== 'term' || !batch || batch.total < 2) return null
  const waiting = underReview(model.record.state) && batch.open > 1
  const allowed = waiting && model.bar.outcomes.accept?.allowed === true
  const others = batch.total - 1
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const run =
    (outcome: 'accept' | 'reject') =>
    async ({ reason }: { reason: string }) => {
      try {
        const result = await decide.mutateAsync({ batchId: batch.id, outcome, reason })
        showToast(
          `${count(result.proposals.length, 'name')} ${outcome === 'accept' ? 'accepted' : 'rejected'}`,
          outcome === 'reject'
            ? "Agents won't get them."
            : result.edition
              ? 'Agents get them within a minute.'
              : "Agents don't get them yet.",
        )
      } catch (error) {
        throw new Error(batchFailure(error), { cause: error })
      }
    }
  return (
    <section
      aria-labelledby="term-batch-heading"
      data-slot="review-term-batch"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <ListChecksIcon
          aria-hidden
          className="size-4 shrink-0 translate-y-px text-muted-foreground"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Heading id="term-batch-heading" className="text-body font-bold">
            Proposed with {count(others, 'other name')}
          </Heading>
          <p className="text-dense text-muted-foreground">
            {waiting
              ? `${batch.open === batch.total ? `All ${batch.total} wait` : `${batch.open} of the ${batch.total} you can see wait`} for a decision. ${allowed ? 'You can decide them together. Each still gets your decision.' : 'An admin can decide them together.'}`
              : `They were proposed together. ${batch.open ? `${count(batch.open, 'name')} still ${batch.open === 1 ? 'waits' : 'wait'} for a decision.` : 'Every one is decided.'}`}
          </p>
        </div>
      </div>
      {allowed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="destructive" onClick={() => setOpen('reject')}>
            <CircleXIcon aria-hidden />
            Reject all {batch.open}
          </Button>
          <Button onClick={() => setOpen('accept')}>
            <CheckCheckIcon aria-hidden />
            Accept all {batch.open}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={open === 'accept'}
        onOpenChange={(next) => setOpen(next ? 'accept' : null)}
        title={`Accept ${count(batch.open, 'name')}?`}
        effect={`Each gets your decision with this reason. People and agents can use all ${batch.open} within a minute.`}
        action={`Accept all ${batch.open}`}
        actionIcon={CheckCheckIcon}
        reason={{
          label: 'Why are you accepting them?',
          required: true,
          hint: 'Everyone who can see the proposals can read this.',
          suggestions: reasonSuggestions.accept.term,
        }}
        onConfirm={run('accept')}
      />
      <ConfirmDialog
        open={open === 'reject'}
        onOpenChange={(next) => setOpen(next ? 'reject' : null)}
        title={`Reject ${count(batch.open, 'name')}?`}
        effect={`Rejecting closes all ${batch.open}, and agents never get them. ${model.proposerName ?? 'The person who proposed them'} can propose them again.`}
        action={`Reject all ${batch.open}`}
        actionIcon={CircleXIcon}
        tone="destructive"
        reason={{
          label: 'Why are you rejecting them?',
          required: true,
          hint: 'Everyone who can see the proposals can read this.',
          suggestions: reasonSuggestions.reject.term,
        }}
        onConfirm={run('reject')}
      />
    </section>
  )
}
