import type { ReactNode } from 'react'
import type { EvalRunDetail, Gate, Review } from '@/api'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { LinkedMentionChip } from '@/components/mentions/mention-text'
import { PartCard } from '@/components/proposal/part-card'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { mentionTypeWords, targetType } from '@/lib/mention-names'
import type { MentionOption } from '@/lib/mention-targets'
import { timeOfDay } from '@/lib/review'
import { cn } from '@/lib/utils'

/*
  The parts of the review screen beside the field diff (frame C2): the mentions added and removed
  with the narrower-audience warning (3), who has accepted and who is still needed (6), and the
  test questions the change affects (the impact of the answer run, FR-209).
*/

// ---- mentions (FR-209) ----

const statusWords: Record<MentionOption['status'], string> = {
  current: 'current',
  retired: 'archived',
  source_changed: 'source changed',
  source_missing: 'source missing',
}

const fieldWords = { summary: 'what happened', body: 'longer explanation' } as const

/**
 * The mentions a proposal adds and removes, with their target type, field and status, and the
 * narrower-audience warning, which never blocks a decision. Audience groups are parked, so the
 * warning cannot appear yet; the state is drawn so nothing changes when they return.
 */
export function MentionChanges({
  mentions,
  warnings,
  targets,
  headingLevel = 2,
}: {
  mentions: Review['mentions']
  warnings: Review['warnings']
  targets: ReadonlyMap<string, MentionOption>
  /** h3 inside a docked panel, under the panel's title. */
  headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const rows = [
    ...mentions.added.map((mention) => ({ mention, kind: 'added' as const })),
    ...mentions.removed.map((mention) => ({ mention, kind: 'removed' as const })),
  ]
  return (
    <section aria-labelledby="review-mentions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id="review-mentions" className="text-large font-bold tracking-large">
          Mentions
        </Heading>
        <div className="flex items-center gap-2">
          <Badge
            form={mentions.added.length ? 'soft' : 'outline'}
            tone={mentions.added.length ? 'success' : 'neutral'}
            className="tabular-nums"
          >
            {mentions.added.length} added
          </Badge>
          <Badge
            form={mentions.removed.length ? 'soft' : 'outline'}
            tone={mentions.removed.length ? 'danger' : 'neutral'}
            className="tabular-nums"
          >
            {mentions.removed.length} removed
          </Badge>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        {rows.length ? (
          <ul aria-label="Mentions added and removed" className="flex flex-col gap-2">
            {rows.map(({ mention, kind }) => {
              const option = targets.get(mention.target)
              const type = targetType(mention.target)
              return (
                <li
                  key={`${kind}-${mention.field}-${mention.position}-${mention.target}`}
                  data-slot="mention-change"
                  data-diff={kind}
                  className="flex flex-wrap items-center gap-2 text-dense"
                >
                  <Badge
                    form="soft"
                    size="sm"
                    tone={kind === 'added' ? 'success' : 'danger'}
                    icon={kind === 'added' ? PlusIcon : MinusIcon}
                  >
                    {kind === 'added' ? 'Added' : 'Removed'}
                  </Badge>
                  <LinkedMentionChip
                    targetKey={mention.target}
                    label={mention.label}
                    option={option}
                  />
                  <span className="text-caption text-muted-foreground">
                    {[
                      type ? mentionTypeWords[type].replace(/^./, (c) => c.toUpperCase()) : null,
                      fieldWords[mention.field],
                      option ? statusWords[option.status] : 'not in the library',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-dense text-muted-foreground">No mentions added or removed.</p>
        )}
        {warnings.map((warning) => {
          const option = targets.get(warning.target)
          return (
            <Alert key={warning.target} variant="warning" data-slot="audience-warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertContent>
                <AlertTitle>Fewer people can see “{warning.label}” than this fact</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <p>
                    Everyone who reads this fact still sees the words of the mention. You can still
                    decide.
                  </p>
                  <span>
                    <LinkedMentionChip
                      targetKey={warning.target}
                      label={warning.label}
                      option={option}
                    />
                  </span>
                </AlertDescription>
              </AlertContent>
            </Alert>
          )
        })}
        {!warnings.length ? (
          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <InfoIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
            Everyone who can see this fact can also see the facts it mentions.
          </p>
        ) : null}
      </div>
    </section>
  )
}

// ---- approvals (FR-206, FR-207) ----

function ApprovalRow({
  done,
  title,
  children,
}: {
  done: boolean
  title: string
  children: ReactNode
}) {
  const Glyph = done ? CircleCheckIcon : CircleDashedIcon
  return (
    <li className="flex gap-3" data-slot="approval" data-done={done || undefined}>
      <span
        role="img"
        aria-label={done ? 'Accepted' : 'Not accepted yet'}
        data-tone={done ? 'success' : 'neutral'}
        className="inline-flex h-5 shrink-0 items-center text-tone-dot"
      >
        <Glyph aria-hidden="true" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-dense font-bold">{title}</span>
        <span className="text-caption text-muted-foreground">{children}</span>
      </div>
    </li>
  )
}

/**
 * Who has accepted this version and who is still needed, with names (frame C2, 6): the owner or
 * deputy always, the high-risk approver as well for high risk.
 */
export function ApprovalsCard({
  gate,
  decisions,
  reviewerId,
  viewerId,
  nameOf,
  risk,
  headingLevel = 2,
}: {
  gate: Pick<Gate, 'approvals'> | null
  decisions: Review['decisions']
  /** Who reviews it: whoever claimed it, else the domain's owner. */
  reviewerId: string | null
  viewerId: string
  nameOf: (id: string) => string | null
  risk: 'low' | 'normal' | 'high' | null
  headingLevel?: 2 | 3
}) {
  const accept = (capacities: string[]) =>
    decisions
      .filter((decision) => decision.outcome === 'accept' && capacities.includes(decision.capacity))
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0]
  const person = (id: string | null) =>
    !id ? null : id === viewerId ? `${nameOf(id) ?? 'You'} (you)` : nameOf(id)
  // The first accept is an owner's of the domain or an administrator's (FR-202).
  const owner = gate?.approvals.owner ? accept(['owner', 'deputy', 'administrator']) : undefined
  const approver = gate?.approvals.approver ? accept(['approver']) : undefined
  const needsApprover = risk === 'high' || gate?.approvals.approver !== null
  return (
    <PartCard title="Approvals needed" headingLevel={headingLevel} data-slot="approvals-card">
      <ul className="flex flex-col gap-3">
        <ApprovalRow done={Boolean(gate?.approvals.owner)} title="Owner or admin">
          {owner
            ? `${person(owner.decidedBy) ?? 'An owner'} accepted at ${timeOfDay(owner.decidedAt)}.`
            : `${person(reviewerId) ?? 'The owner'}. Not accepted yet.`}
        </ApprovalRow>
        {needsApprover && gate?.approvals.approver !== null ? (
          <ApprovalRow done={Boolean(gate?.approvals.approver)} title="High-risk approver">
            {approver
              ? `${person(approver.decidedBy) ?? 'The approver'} accepted at ${timeOfDay(approver.decidedAt)}.`
              : 'Needed because the risk is high. Not accepted yet.'}
          </ApprovalRow>
        ) : null}
      </ul>
      {!needsApprover || gate?.approvals.approver === null ? (
        <p className="text-caption text-muted-foreground">
          Only a high-risk fact needs an approver.
        </p>
      ) : null}
    </PartCard>
  )
}

// ---- impact on test questions (FR-509, FR-510) ----

const verdictWords = { pass: 'pass', fail: 'fail', no_answer: 'no answer' } as const

/**
 * The test questions the change affects, from its answer run: how many, how many get fixed and
 * how many get worse, then each affected question with its before and after. A held-out
 * question is counted but never named (FR-503).
 */
export function ImpactDelta({
  run,
  loading,
  message,
  questionText,
  headingLevel = 2,
}: {
  run: EvalRunDetail | null
  loading: boolean
  /** The answer level's own sentence, while there is no run to read. */
  message: string | null
  questionText: (id: string) => string | null
  headingLevel?: 2 | 3
}) {
  if (loading)
    return (
      <PartCard title="Test questions it could change" headingLevel={headingLevel}>
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading the answer tests</span>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </PartCard>
    )
  if (!run)
    return (
      <PartCard
        title="Test questions it could change"
        headingLevel={headingLevel}
        data-slot="impact-delta"
      >
        <p className="text-dense text-muted-foreground">
          {message ?? "The answer tests haven't run yet. They start with the checks."}
        </p>
      </PartCard>
    )
  const affected = run.results.filter((result) => result.impact)
  const fixed = run.flips.filter((flip) => flip.flip === 'fail_to_pass').length
  const worse = run.flips.filter((flip) => flip.flip === 'pass_to_fail').length
  const shown = affected.length ? affected : run.results.filter((result) => result.flip !== null)
  const cost = `$${(run.run.actualCostMicros / 1_000_000).toFixed(2)}`
  return (
    <PartCard
      title="Test questions it could change"
      headingLevel={headingLevel}
      data-slot="impact-delta"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge form="outline" className="tabular-nums">
          {affected.length} could change
        </Badge>
        <Badge
          form={fixed ? 'soft' : 'outline'}
          tone={fixed ? 'success' : 'neutral'}
          icon={ArrowUpIcon}
          className="tabular-nums"
        >
          {fixed} got better
        </Badge>
        <Badge
          form={worse ? 'soft' : 'outline'}
          tone={worse ? 'danger' : 'neutral'}
          icon={worse ? ArrowDownIcon : MinusIcon}
          className="tabular-nums"
        >
          {worse} got worse
        </Badge>
      </div>
      {shown.length ? (
        <ul aria-label="Test questions it could change" className="flex flex-col gap-2">
          {shown.map((result) => {
            const flip = result.flip
            return (
              <li
                key={result.id}
                className="flex items-start justify-between gap-3 text-caption"
                data-flip={flip ?? undefined}
              >
                <span className="min-w-0">
                  {questionText(result.id) ?? 'A hidden test question'}
                </span>
                <Badge
                  form={flip ? 'soft' : 'outline'}
                  size="sm"
                  tone={
                    flip === 'fail_to_pass'
                      ? 'success'
                      : flip === 'pass_to_fail'
                        ? 'danger'
                        : 'neutral'
                  }
                  className={cn('shrink-0', !flip && 'text-muted-foreground')}
                >
                  {result.baseline === result.candidate || !result.baseline
                    ? verdictWords[result.candidate ?? 'no_answer']
                    : `${verdictWords[result.baseline]} → ${verdictWords[result.candidate ?? 'no_answer']}`}
                </Badge>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-dense text-muted-foreground">None of the test questions could change.</p>
      )}
      <p className="text-caption text-muted-foreground tabular-nums">
        {run.run.questions} {run.run.questions === 1 ? 'question' : 'questions'} asked
        {run.run.state === 'finished' ? `, run cost ${cost}` : ''}.{' '}
        <HelpLink to="glossary#test-question">What's a test question?</HelpLink>
      </p>
    </PartCard>
  )
}
