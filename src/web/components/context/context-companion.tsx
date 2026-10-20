import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isEvidenceFinding } from '@domain/draft'
import type { Scope } from '@domain/item'
import { previewItemId } from '@domain/served-review'
import type { ProposalRecord } from '@/api'
import { areasQuery, libraryQuery, proposalOverlapQuery, proposalPreviewQuery } from '@/api/queries'
import { AgentPreview } from '@/components/proposal/agent-preview'
import { OverlapList } from '@/components/proposal/overlap-list'
import { PartCard } from '@/components/proposal/part-card'
import { ScopeInput } from '@/components/mentions/scope-input'
import { DateField } from '@/components/form/date-field'
import { Field, FieldLabel } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import {
  CalendarIcon,
  CheckIcon,
  CircleDashedIcon,
  LinkIcon,
  TargetIcon,
  TriangleAlertIcon,
} from '@/components/icons'
import { draftScope, formValues, previewInput } from '@/lib/context-form'
import { sourceWords } from '@/lib/context-help'
import { formatDay } from '@/lib/library'
import { anyValueWords } from '@/lib/library-core'
import { scopeKeys, targetsByKey } from '@/lib/mention-targets'
import { useMentionTargets } from '@/lib/use-mention-targets'

/** The chips under "For a question about": the scope's names, then the day asked about. */
export function useQuestionAbout() {
  const lookup = targetsByKey(useMentionTargets().targets)
  return (scope: Scope | undefined, day: string | null | undefined) => [
    ...(scope
      ? scopeKeys(scope).map((key) => {
          const name = lookup.get(key)?.name ?? key
          // A dimension named without a value: the question is about any of its values.
          return key.startsWith('dim:') ? anyValueWords(name) : name
        })
      : []),
    ...(day ? [formatDay(day)] : []),
  ]
}

/**
 * The domain of a delivered item, from the library index. The draft itself is not in the index
 * yet, so an item the index does not know takes the draft's domain.
 */
export function useDomainOf(proposal: ProposalRecord | undefined) {
  const areas = useQuery(areasQuery()).data ?? []
  const library = useQuery(libraryQuery()).data
  return (itemId: string) => {
    const areaId =
      library?.items.find((item) => item.id === itemId)?.areaId ?? proposal?.draft.areaId
    return areas.find((area) => area.id === areaId) ?? null
  }
}

/**
 * The preview of the saved draft. It needs a saved draft that passes the format check, apart from
 * where it comes from: the evidence does not change what an agent is told (FR-108).
 */
function useDraftPreview(proposal: ProposalRecord | undefined, unsaved: boolean) {
  const ready = Boolean(
    proposal &&
    !unsaved &&
    !proposal.findings.some(
      (finding) => finding.severity === 'error' && !isEvidenceFinding(finding),
    ),
  )
  const input = proposal ? previewInput(proposal) : { id: '', question: '' }
  const preview = useQuery({
    ...proposalPreviewQuery(input, proposal?.revision ?? 0),
    enabled: ready,
  })
  return { ready, preview }
}

/**
 * The rail's Agent view (the editor design, section 1): the reply an agent would get for the
 * saved draft, another question to try, and what is already in the library. A long overlap list
 * folds to two with a count, so the rail stays short.
 */
export function AgentView({
  proposal,
  unsaved,
  onShowEvidence,
}: {
  proposal?: ProposalRecord
  unsaved: boolean
  /** Goes to "Where this comes from" in the details. */
  onShowEvidence: () => void
}) {
  const { ready, preview } = useDraftPreview(proposal, unsaved)
  const evidenceMissing = Boolean(proposal?.findings.some(isEvidenceFinding))
  const overlap = useQuery({
    ...proposalOverlapQuery(proposal?.id ?? '', proposal?.revision ?? 0),
    enabled: Boolean(proposal && !unsaved),
  })
  const about = useQuestionAbout()
  const domainOf = useDomainOf(proposal)
  return (
    <>
      <AgentPreview
        {...(proposal ? { draftItemId: previewItemId(proposal) } : {})}
        state={ready ? (preview.isPending ? 'loading' : 'ready') : 'waiting'}
        result={preview.data?.result}
        about={ready ? about(proposal?.draft.scope, proposal?.draft.validity?.start) : []}
        domainOf={domainOf}
        waitingFor={proposal && unsaved ? 'This updates once your changes are saved.' : undefined}
      />
      {ready && evidenceMissing ? (
        <div data-slot="evidence-notice" className="flex items-start gap-2 text-dense">
          <LinkIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col items-start gap-1">
            <p>
              {`Fill in ${sourceWords.title} before you send it. It doesn't change what AI apps get.`}
            </p>
            <Button variant="link" size="sm" className="px-0" onClick={onShowEvidence}>
              Complete it
            </Button>
          </div>
        </div>
      ) : null}
      {preview.isError && ready ? (
        <p role="alert" className="text-dense text-status-danger-fg">
          We couldn't load the preview.{' '}
          <Button variant="link" onClick={() => void preview.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}
      {proposal && ready ? (
        <TryAnotherQuestion key={proposal.revision} proposal={proposal} />
      ) : null}
      {proposal ? (
        overlap.isError ? (
          <PartCard title="Already in the library">
            <p>We couldn't check for overlaps.</p>
            <Button variant="outline" onClick={() => void overlap.refetch()}>
              Try again
            </Button>
          </PartCard>
        ) : (
          <OverlapList
            title="Already in the library"
            overlap={overlap.data}
            loading={unsaved || overlap.isPending}
            limit={2}
          />
        )
      ) : (
        <PartCard title="Already in the library">
          <p className="text-dense text-muted-foreground">
            Choose where and when it applies to check for overlaps.
          </p>
        </PartCard>
      )}
    </>
  )
}

/**
 * The checks under the rail: the format check, which runs as the person types, and the matching
 * and delivery tests, which run on submit. `held` is the text check's reason when it stops the
 * draft from saving.
 */
export function DraftChecks({
  proposal,
  unsaved,
  held,
}: {
  proposal?: ProposalRecord
  unsaved: boolean
  held?: string
}) {
  const ready = Boolean(
    proposal && !unsaved && !proposal.findings.some((finding) => finding.severity === 'error'),
  )
  return (
    <PartCard title="Checks">
      <p className="flex items-start gap-2 text-dense">
        {held ? (
          <TriangleAlertIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-status-danger-icon"
          />
        ) : ready ? (
          <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <CircleDashedIcon aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span>
          <b className="font-bold">Complete</b>
          <br />
          {held ? (
            <span className="text-status-danger-fg">{held}</span>
          ) : ready ? (
            'Every field is filled in.'
          ) : (
            'Fill in the fields, and we check them as you go.'
          )}
        </span>
      </p>
      <p className="flex items-start gap-2 border-t pt-3 text-dense">
        <CircleDashedIcon aria-hidden="true" className="size-4 shrink-0" />
        <span>
          <b className="font-bold">More checks</b>
          <br />
          When you send it, we test that it finds the right questions and reaches AI apps.
        </span>
      </p>
    </PartCard>
  )
}

function TryAnotherQuestion({ proposal }: { proposal: ProposalRecord }) {
  const [scope, setScope] = useState(formValues(proposal).scope)
  const [day, setDay] = useState(proposal.draft.validity?.start ?? null)
  const [input, setInput] = useState<ReturnType<typeof previewInput> | null>(null)
  const [asked, setAsked] = useState<string[]>([])
  const about = useQuestionAbout()
  const domainOf = useDomainOf(proposal)
  const result = useQuery({
    ...proposalPreviewQuery(input ?? previewInput(proposal), proposal.revision),
    enabled: input !== null,
  })
  return (
    <PartCard title="Try another question">
      <Field>
        <FieldLabel icon={TargetIcon} htmlFor="try-scope">
          Where
        </FieldLabel>
        <ScopeInput
          id="try-scope"
          value={scope}
          onChange={setScope}
          aria-label="Try another metric or market"
        />
      </Field>
      <Field>
        <FieldLabel icon={CalendarIcon}>On which day</FieldLabel>
        <DateField value={day} onValueChange={setDay} />
      </Field>
      <Button
        variant="outline"
        disabled={!day || result.isFetching}
        onClick={() => {
          setInput(previewInput(proposal, draftScope(scope), day ?? undefined))
          setAsked(about(draftScope(scope), day))
        }}
      >
        Try this question
      </Button>
      {input ? (
        <AgentPreview
          draftItemId={proposal ? previewItemId(proposal) : undefined}
          headingLevel={3}
          state={result.isPending ? 'loading' : 'ready'}
          result={result.data?.result}
          about={asked}
          domainOf={domainOf}
        />
      ) : null}
    </PartCard>
  )
}
