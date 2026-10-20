import { useState } from 'react'
import type { Area, ClaimLevel, RiskLevel } from '@domain/item'
import { claimLevels, riskLevels } from '@domain/item'
import { toApiError, type ProposalRecord, type ReviewProposal } from '@/api'
import { useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { DateField } from '@/components/form/date-field'
import {
  CalendarCheckIcon,
  HeedDomainIcon,
  HeedRiskIcon,
  PencilIcon,
  ScaleIcon,
  UserRoundIcon,
} from '@/components/icons'
import { ClaimBadge, RiskBadge } from '@/components/item/fact-badges'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { DomainBadge } from '@/components/item/item-marks'
import { PartCard } from '@/components/proposal/part-card'
import { BlockedButton } from '@/components/ui/blocked-button'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldItem,
  FieldItemContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatDay } from '@/lib/library'
import { refusedTextMessage } from '@/lib/proposals'
import {
  changedOwnerFields,
  reviewEditInput,
  reviewersOf,
  ownerEditEffects,
  ownerFieldProblems,
  ownerFieldsOf,
  type OwnerFields,
} from '@/lib/review'
import { showToast } from '@/lib/toast'

/*
  OwnerEdit (front end plan call 3; FR-105, FR-106, FR-123, FR-324; review.edit): what an owner
  decides around the content during review. The card lists the risk, the day it is
  checked again, the cause, the domain and the owner; Change opens one dialog for all of them,
  with what the change will do. Every change is a new version: every check runs again on it, and
  a raise to high risk needs the whole-domain tests and the approver. The content stays the
  writer's.
*/

const riskWords: Record<RiskLevel, string> = {
  low: 'An owner may accept their own.',
  normal: 'Needs the answer tests on the questions it could change.',
  high: 'Needs every check, the whole domain included, and the approver.',
}

const claimWords: Record<ClaimLevel, { title: string; hint: string }> = {
  fact_only: { title: 'Cause not proven', hint: 'It records what happened, not why.' },
  effect_stated: {
    title: 'Cause stated',
    hint: 'A named authority states the effect. Only an owner can set it.',
  },
}

export type OwnerEditBlock = { title: string; reason: string } | null

/** The current settings, and Change when the person may change them. */
export function OwnerEditCard({
  fields,
  areas,
  nameOf,
  ends,
  block,
  onChange,
}: {
  fields: OwnerFields
  areas: readonly Area[]
  nameOf: (id: string) => string | null
  /** The item has an end date, so it needs no review date. */
  ends: boolean
  /** Why Change is blocked, or null when the person may change the settings. */
  block: OwnerEditBlock
  onChange: () => void
}) {
  const area = areas.find((candidate) => candidate.id === fields.areaId)
  return (
    <PartCard
      title="Review settings"
      data-slot="owner-edit"
      aside={
        block ? (
          <BlockedButton size="sm" reason={block.reason} title={block.title}>
            <PencilIcon />
            Change
          </BlockedButton>
        ) : (
          <Button variant="outline" size="sm" onClick={onChange}>
            <PencilIcon />
            Change
          </Button>
        )
      }
    >
      <FieldTable label="Review settings">
        <FieldRow icon={HeedRiskIcon} label="Risk">
          <RiskBadge level={fields.riskLevel} form="bare" />
        </FieldRow>
        <FieldRow icon={CalendarCheckIcon} label="Check again">
          {fields.reviewDate ? (
            <span className="tabular-nums">{formatDay(fields.reviewDate)}</span>
          ) : (
            <span className="text-muted-foreground">
              {ends ? 'No date, because it ends' : 'Not set'}
            </span>
          )}
        </FieldRow>
        <FieldRow icon={ScaleIcon} label="Cause">
          <ClaimBadge level={fields.claimLevel} short />
        </FieldRow>
        <FieldRow icon={HeedDomainIcon} label="Domain">
          {area ? <DomainBadge name={area.name} label={area.label} /> : 'Unknown domain'}
        </FieldRow>
        <FieldRow icon={UserRoundIcon} label="Owner">
          {nameOf(fields.ownerId) ?? 'Nobody named'}
        </FieldRow>
      </FieldTable>
    </PartCard>
  )
}

/** What the service answered, in words for the dialog's error. */
function editFailure(error: unknown): string {
  const failure = toApiError(error)
  const refused = refusedTextMessage(failure.findings)
  if (refused) return refused
  if (failure.kind === 'conflict')
    return 'Someone decided, claimed or changed it while you were editing. Close this and open it again.'
  if (failure.kind === 'invalid')
    return (
      failure.findings.map((finding) => finding.message).join(' ') ||
      "We couldn't save some settings. Check them and try again."
    )
  if (failure.kind === 'forbidden') return failure.message
  return "We couldn't save the change. Try again."
}

/** One dialog for the risk, the review date, the cause, the domain and the owner. */
export function OwnerEditDialog({
  open,
  onOpenChange,
  proposal,
  draft,
  areas,
  nameOf,
  ends,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  proposal: Pick<ReviewProposal, 'id' | 'revision' | 'riskLevel' | 'areaId'>
  draft: ProposalRecord['draft']
  areas: readonly Area[]
  nameOf: (id: string) => string | null
  ends: boolean
}) {
  const edit = useApiWrite('editReview')
  const area = areas.find((candidate) => candidate.id === proposal.areaId)
  const current = ownerFieldsOf(draft, proposal, area)
  const [next, setNext] = useState<OwnerFields>(current)
  const [attempted, setAttempted] = useState(false)
  const set = (patch: Partial<OwnerFields>) => setNext((previous) => ({ ...previous, ...patch }))
  const problems = ownerFieldProblems(next, { ends })
  const shown = attempted ? problems : {}
  const target = areas.find((candidate) => candidate.id === next.areaId)
  const reviewers = reviewersOf(target)
  const effects = ownerEditEffects(current, next, {
    areaName: (id) => areas.find((candidate) => candidate.id === id)?.name ?? 'another domain',
    ownerName: nameOf(next.ownerId),
  })
  const changed = changedOwnerFields(current, next).length > 0
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value)
        if (!value) {
          setNext(current)
          setAttempted(false)
        }
      }}
      title="Change the review settings"
      effect="The text stays as the writer wrote it. You change how it's reviewed."
      action="Save and check again"
      actionIcon={PencilIcon}
      reason={{
        label: 'Why are you changing them?',
        hint: 'Shown in its history and in the history log. Plain text only.',
      }}
      onConfirm={async ({ reason }) => {
        setAttempted(true)
        if (Object.keys(problems).length) throw new Error('Fix the settings marked below.')
        const input = reviewEditInput(proposal, current, next, reason)
        if (!input) throw new Error('Nothing has changed yet. Change a setting first.')
        try {
          await edit.mutateAsync(input)
        } catch (error) {
          throw new Error(editFailure(error), { cause: error })
        }
        showToast('Review settings changed', 'Every check runs again on the changed version.')
      }}
    >
      <div className="flex flex-col gap-4">
        <Field>
          <FieldSet
            render={
              <RadioGroup
                value={next.riskLevel}
                onValueChange={(value) => set({ riskLevel: value as RiskLevel })}
              />
            }
          >
            <FieldLegend>Risk</FieldLegend>
            {riskLevels.map((level) => (
              <FieldItem key={level}>
                <RadioGroupItem value={level} />
                <FieldItemContent>
                  <FieldLabel>
                    <RiskBadge level={level} form="bare" />
                  </FieldLabel>
                  <FieldDescription>{riskWords[level]}</FieldDescription>
                </FieldItemContent>
              </FieldItem>
            ))}
          </FieldSet>
        </Field>
        <Field invalid={Boolean(shown.reviewDate)}>
          <FieldLabel optional={ends}>Check again by</FieldLabel>
          <FieldDescription>
            {ends
              ? 'It ends, so it needs no date. An owner can still set one.'
              : "It has no end date, so an owner checks by then that it's still right."}
          </FieldDescription>
          <DateField
            value={next.reviewDate}
            onValueChange={(value) => set({ reviewDate: value })}
            clearLabel={ends ? 'Remove the date' : undefined}
            calendarLabel="Choose the day to check it again"
          />
          <FieldError>{shown.reviewDate}</FieldError>
        </Field>
        <Field>
          <FieldSet
            render={
              <RadioGroup
                value={next.claimLevel}
                onValueChange={(value) => set({ claimLevel: value as ClaimLevel })}
              />
            }
          >
            <FieldLegend>Cause</FieldLegend>
            {claimLevels.map((level) => (
              <FieldItem key={level}>
                <RadioGroupItem value={level} />
                <FieldItemContent>
                  <FieldLabel>{claimWords[level].title}</FieldLabel>
                  <FieldDescription>{claimWords[level].hint}</FieldDescription>
                </FieldItemContent>
              </FieldItem>
            ))}
          </FieldSet>
        </Field>
        {next.claimLevel === 'effect_stated' ? (
          <>
            <Field invalid={Boolean(shown.claimAuthority)}>
              <FieldLabel>Who states it</FieldLabel>
              <Input
                size="lg"
                value={next.claimAuthority}
                onChange={(event) => set({ claimAuthority: event.target.value })}
                placeholder="For example the United States customs office"
              />
              <FieldFooter>
                <FieldError>{shown.claimAuthority}</FieldError>
                <FieldCounter count={[...next.claimAuthority].length} max={200} />
              </FieldFooter>
            </Field>
            <Field invalid={Boolean(shown.claimQuote)}>
              <FieldLabel>What they said</FieldLabel>
              <Textarea
                rows={3}
                value={next.claimQuote}
                onChange={(event) => set({ claimQuote: event.target.value })}
                className="resize-y text-body pointer-coarse:text-large"
              />
              <FieldFooter>
                <FieldError>{shown.claimQuote}</FieldError>
                <FieldCounter count={[...next.claimQuote].length} max={500} />
              </FieldFooter>
            </Field>
          </>
        ) : null}
        <Field>
          <FieldLabel>Domain</FieldLabel>
          <FieldDescription>Moving it sends it to the owners of that domain.</FieldDescription>
          <Select
            value={next.areaId}
            onValueChange={(value) => {
              if (!value) return
              const moved = areas.find((candidate) => candidate.id === value)
              set({
                areaId: value,
                ownerId: value === current.areaId ? current.ownerId : (moved?.ownerIds[0] ?? ''),
              })
            }}
          >
            <SelectTrigger size="lg">
              <SelectValue>
                {target ? (
                  <DomainBadge name={target.name} label={target.label} />
                ) : (
                  'Choose a domain'
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {areas.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  <SelectItemText>
                    <DomainBadge name={candidate.name} label={candidate.label} />
                  </SelectItemText>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field invalid={Boolean(shown.ownerId)}>
          <FieldLabel>Owner</FieldLabel>
          <Select
            value={next.ownerId || null}
            onValueChange={(value) => {
              if (value) set({ ownerId: value })
            }}
          >
            <SelectTrigger size="lg">
              <SelectValue>{nameOf(next.ownerId) ?? 'Choose who reviews it'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {reviewers.map((id) => (
                <SelectItem key={id} value={id}>
                  <SelectItemText>
                    {nameOf(id) ?? 'Someone'}
                    <span className="text-muted-foreground"> · owner</span>
                  </SelectItemText>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{shown.ownerId}</FieldError>
        </Field>
        {changed ? (
          <ul
            aria-label="What the change does"
            data-slot="edit-effects"
            className="flex list-disc flex-col gap-1 rounded-md border bg-muted px-4 py-3 pl-8 text-dense"
          >
            {effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </ConfirmDialog>
  )
}
