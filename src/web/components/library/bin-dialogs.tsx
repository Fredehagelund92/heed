import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Area, ItemKind } from '@domain/item'
import type { BinRescuePreview } from '@/api'
import { areasQuery, binPreviewQuery, binRescueQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import {
  CircleAlertIcon,
  HeedDomainIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from '@/components/icons'
import { DomainOptionText, domainOptionProps } from '@/components/item/domain-option'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { rescueChangeLine, restoredWords } from '@/lib/bin'
import { showToast } from '@/lib/toast'

/*
  The Bin's two actions (an administrator's), each in the one ConfirmDialog (contract 9.4).
  Moving to the Bin retires what agents get, in one edition for the whole action, so it asks for
  one reason; the toast offers Undo, which restores the same items. Restoring serves the items
  again the same way and needs no reason: the move's is kept. An item whose domain was deleted
  has no domain to go back to, so the administrator chooses another one (FR-814): it comes back
  retired, with a proposal there for its owners, and the dialog names every change that domain
  needs before Restore can be pressed.
*/

type Controlled = { open: boolean; onOpenChange: (open: boolean) => void }

/** What a Bin action is about: an item's kind and title, and its domain's name if deleted. */
export type BinSubject = {
  id: string
  kind: ItemKind
  title: string
  /** Its domain's name when that domain is deleted: it is restored into another domain. */
  deletedDomain?: string | null
}

/** How many titles a dialog lists before it counts the rest. */
const LISTED = 5

const facts = (count: number) => `${count.toLocaleString('en')} ${count === 1 ? 'fact' : 'facts'}`

/** The items of the action: their kind icons and titles, the first few and a count of the rest. */
function Subjects({ subjects }: { subjects: readonly BinSubject[] }) {
  const more = subjects.length - LISTED
  return (
    <ul className="flex flex-col gap-2" data-slot="bin-subjects">
      {subjects.slice(0, LISTED).map((subject) => (
        <li key={subject.id} className="flex items-center gap-3 text-body font-bold">
          <KindIcon kind={subject.kind} decorative />
          <span className="min-w-0 truncate">{subject.title}</span>
        </li>
      ))}
      {more > 0 ? (
        <li className="text-dense text-muted-foreground">and {more.toLocaleString('en')} more</li>
      ) : null}
    </ul>
  )
}

/** Restores items from the Bin and says what came back; the Bin view and Undo both use it. */
export function useRestoreFromBin() {
  const restore = useApiWrite('restoreFromBin')
  return async (ids: readonly string[]) => {
    try {
      const result = await restore.mutateAsync({ ids: [...ids] })
      const { title, description } = restoredWords(result)
      showToast(title, description)
      return true
    } catch (error) {
      showToast('Nothing was restored', error instanceof Error ? error.message : 'Try again.')
      return false
    }
  }
}

/**
 * An administrator moves items to the Bin. The dialog reads what it would do first: how many
 * items agents get now, and which have open proposals, which cannot be accepted while the item
 * is in the Bin.
 */
export function MoveToBinDialog({
  subjects,
  open,
  onOpenChange,
  onMoved,
}: Controlled & {
  subjects: readonly BinSubject[]
  /** Runs once the items are in the Bin: the list clears its selection. */
  onMoved?: () => void
}) {
  const move = useApiWrite('moveToBin')
  const restore = useRestoreFromBin()
  const ids = subjects.map((subject) => subject.id)
  const { data: preview } = useQuery({ ...binPreviewQuery(ids), enabled: open && ids.length > 0 })
  const one = subjects.length === 1
  const withProposals = preview?.items.filter((item) => item.openProposals > 0) ?? []
  const proposals = withProposals.reduce((sum, item) => sum + item.openProposals, 0)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={one ? 'Move this fact to the Bin?' : `Move ${facts(subjects.length)} to the Bin?`}
      effect={
        one
          ? 'It leaves the library, and AI apps stop getting it at once. An admin can restore it from the Bin.'
          : 'They leave the library, and AI apps stop getting them at once. An admin can restore them from the Bin.'
      }
      action="Move to Bin"
      actionIcon={Trash2Icon}
      tone="destructive"
      reason={{
        required: true,
        hint: 'We keep it with the fact, in the Bin and in the history log.',
      }}
      onConfirm={async ({ reason }) => {
        const result = await move.mutateAsync({ ids, reason })
        onMoved?.()
        showToast(
          one ? 'Moved to the Bin' : `${facts(subjects.length)} moved to the Bin`,
          result.edition
            ? `AI apps no longer get ${one ? 'it' : 'them'}.`
            : `${one ? 'It was' : 'They were'} already archived.`,
          { action: { label: 'Undo', onClick: () => void restore(ids) } },
        )
      }}
    >
      <Subjects subjects={subjects} />
      {proposals > 0 ? (
        <Alert variant="warning" data-slot="bin-open-proposals">
          <TriangleAlertIcon aria-hidden />
          <AlertContent>
            <AlertDescription>
              {withProposals.length === 1 && one
                ? `It has ${proposals === 1 ? 'an open proposal' : `${proposals} open proposals`}.`
                : `${facts(withProposals.length)} ${withProposals.length === 1 ? 'has' : 'have'} open proposals.`}{' '}
              {proposals === 1 ? 'It stays' : 'They stay'} open, but nobody can accept{' '}
              {proposals === 1 ? 'it' : 'them'} while the {one ? 'fact is' : 'facts are'} in the
              Bin.
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
    </ConfirmDialog>
  )
}

/**
 * An administrator restores items from the Bin: the ones agents got are served again. The items
 * of a deleted domain go to the domain the administrator chooses, retired, each with a proposal
 * there; the dialog reads what each needs in that domain, and Restore waits until every one fits.
 */
export function RestoreFromBinDialog({
  subjects,
  open,
  onOpenChange,
  onRestored,
}: Controlled & {
  subjects: readonly BinSubject[]
  onRestored?: () => void
}) {
  const restore = useApiWrite('restoreFromBin')
  const navigate = useNavigate()
  const [areaId, setAreaId] = useState<string | null>(null)
  const orphans = subjects.filter((subject) => subject.deletedDomain)
  const rescuing = orphans.length > 0
  const { data: areas = [] } = useQuery({ ...areasQuery(), enabled: open && rescuing })
  const chosen = areas.find((area) => area.id === areaId)
  const rescue = useQuery({
    ...binRescueQuery(
      orphans.map((subject) => subject.id),
      areaId ?? '',
    ),
    enabled: open && rescuing && areaId !== null,
  })
  const fits = rescue.data ? rescue.data.items.every((item) => !item.problem) : false
  const one = subjects.length === 1
  const deleted = [...new Set(orphans.map((subject) => subject.deletedDomain!))]
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setAreaId(null)
        onOpenChange(next)
      }}
      title={
        one
          ? rescuing
            ? 'Restore this fact into another domain?'
            : 'Restore this fact?'
          : `Restore ${facts(subjects.length)}?`
      }
      effect={restoreEffect(subjects.length, orphans.length, deleted)}
      action="Restore"
      actionIcon={RotateCcwIcon}
      wide={rescuing}
      hold={rescuing && !fits ? 'waiting' : undefined}
      onConfirm={async () => {
        const result = await restore.mutateAsync({
          ids: subjects.map((subject) => subject.id),
          ...(rescuing && areaId ? { areaId } : {}),
        })
        onRestored?.()
        const { title, description } = restoredWords(result, chosen?.name)
        const [opened, ...more] = result.proposals
        showToast(
          title,
          description,
          opened && !more.length
            ? {
                action: {
                  label: 'Open proposal',
                  onClick: () =>
                    void navigate({
                      to: '/proposals/$proposalId',
                      params: { proposalId: opened.id },
                    }),
                },
              }
            : {},
        )
      }}
    >
      <Subjects subjects={subjects} />
      {rescuing ? (
        <div className="flex flex-col gap-4" data-slot="bin-rescue">
          <DomainChoice
            areas={areas}
            value={areaId}
            onChange={setAreaId}
            hint={`Or restore ${deleted.length === 1 ? deleted[0] : 'the deleted domain'} first, from Administration, Domains, to bring ${orphans.length === 1 ? 'it' : 'them'} back as ${orphans.length === 1 ? 'it was' : 'they were'}.`}
          />
          {areaId === null ? null : rescue.isError ? (
            <Alert variant="danger" role="alert">
              <CircleAlertIcon aria-hidden />
              <AlertContent>
                <AlertTitle>We couldn't work out what changes</AlertTitle>
                <AlertDescription>
                  {rescue.error instanceof Error && rescue.error.message
                    ? rescue.error.message
                    : 'Try again, or choose another domain.'}
                </AlertDescription>
              </AlertContent>
            </Alert>
          ) : rescue.data ? (
            <RescueChanges
              preview={rescue.data}
              subjects={orphans}
              domain={chosen?.name ?? 'the domain'}
            />
          ) : (
            <p className="text-body text-muted-foreground" role="status">
              Reading what changes in {chosen?.name ?? 'the domain'}
            </p>
          )}
        </div>
      ) : null}
    </ConfirmDialog>
  )
}

/** The Restore dialog's sentence: what comes back, and how the items of a deleted domain do. */
function restoreEffect(count: number, orphans: number, deleted: readonly string[]) {
  const served =
    count === 1
      ? 'It comes back to the library. If AI apps got it before, they get it again.'
      : 'They come back to the library. AI apps get the ones they got before again.'
  if (!orphans) return served
  const whose =
    deleted.length === 1
      ? `${orphans === 1 ? 'Its' : 'Their'} domain, ${deleted[0]}, is deleted.`
      : 'Their domains are deleted.'
  const rescued =
    orphans === 1
      ? 'It comes back archived, with a proposal in the domain you choose for its owners to review. AI apps get it again only once they accept it.'
      : 'They come back archived, each with a proposal in the domain you choose for its owners to review. AI apps get them again only once they accept them.'
  if (orphans === count) return `${whose} ${rescued}`
  return `${served} ${facts(orphans)} of a deleted domain come back archived instead, each with a proposal in the domain you choose for its owners to review.`
}

/** The domain the items of a deleted domain go to: one that exists, chosen by name. */
function DomainChoice({
  areas,
  value,
  onChange,
  hint,
}: {
  areas: readonly Area[]
  value: string | null
  onChange: (id: string) => void
  hint: string
}) {
  const sorted = [...areas].sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const area = sorted.find((candidate) => candidate.id === value)
  return (
    <Field>
      <FieldLabel icon={HeedDomainIcon}>Restore into</FieldLabel>
      <Select value={value} onValueChange={(next: string | null) => next && onChange(next)}>
        <SelectTrigger size="lg" className="w-full">
          <SelectValue placeholder="Choose a domain">
            {area ? <DomainBadge name={area.name} label={area.label} size="sm" /> : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent empty="No domains are available." className="w-popover">
          {sorted.map((candidate) => (
            <SelectItem
              key={candidate.id}
              value={candidate.id}
              {...domainOptionProps(candidate, 'rescue-domain')}
            >
              <DomainOptionText area={candidate} list="rescue-domain">
                <SelectItemText>
                  <DomainBadge name={candidate.name} label={candidate.label} size="sm" />
                </SelectItemText>
              </DomainOptionText>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>{hint}</FieldDescription>
    </Field>
  )
}

/**
 * What the chosen domain needs of each item, one line a change, and why one cannot go there. The
 * rest of its content stays as it was, and the proposal's reviewers see every change again.
 */
function RescueChanges({
  preview,
  subjects,
  domain,
}: {
  preview: BinRescuePreview
  subjects: readonly BinSubject[]
  domain: string
}) {
  const several = preview.items.length > 1
  const kindOf = (id: string) => subjects.find((subject) => subject.id === id)?.kind
  return (
    <div className="flex flex-col gap-3" data-slot="rescue-changes">
      <p className="text-body font-bold">What changes in {domain}</p>
      {preview.items.map((item) => (
        <section
          key={item.itemId}
          aria-label={several ? item.title : `What changes in ${domain}`}
          className="flex flex-col gap-2"
        >
          {several ? (
            <h3 className="flex items-center gap-3 text-body font-bold">
              {kindOf(item.itemId) ? <KindIcon kind={kindOf(item.itemId)!} decorative /> : null}
              <span className="min-w-0">{item.title}</span>
            </h3>
          ) : null}
          {item.problem ? (
            <Alert variant="warning" data-slot="rescue-problem">
              <TriangleAlertIcon aria-hidden />
              <AlertContent>
                <AlertTitle>It can't go to {domain}</AlertTitle>
                <AlertDescription>{item.problem}</AlertDescription>
              </AlertContent>
            </Alert>
          ) : null}
          <ul className="flex flex-col gap-1 text-body">
            {item.changes.map((change, index) => {
              const line = rescueChangeLine(change)
              return (
                <li key={`${change.field}-${index}`}>
                  <span className="font-bold">{line.label}:</span> {line.words}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <p className="text-dense text-muted-foreground">
        Everything else stays as it was: the title, the text, the source and the dates. The owners
        see each change again in the proposal.
      </p>
    </div>
  )
}
