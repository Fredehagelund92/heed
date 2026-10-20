import { useQuery } from '@tanstack/react-query'
import type { ContextItem } from '@domain/item'
import { itemDisplayStatus } from '@domain/status'
import { areasQuery, itemLinksQuery, libraryQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { ArchiveIcon, CheckIcon, SendIcon, TriangleAlertIcon } from '@/components/icons'
import { KindIcon, StatusBadge } from '@/components/item/item-marks'
import { Alert, AlertContent, AlertDescription } from '@/components/ui/alert'
import { rememberCheckReason, useCheckReason } from '@/lib/check-reason'
import { showToast } from '@/lib/toast'
import { useSession } from '@/lib/use-session'

/*
  The governed actions on one item (FR-112, FR-218, CON-211), each in the one ConfirmDialog
  (contract 9.4): what it is about, its effect in one sentence, and the reason. Retiring and a
  check publish an edition at once; a proposal waits for an owner.
*/

type Controlled = { open: boolean; onOpenChange: (open: boolean) => void }

/** The item the dialog is about: its kind icon and title (plan frame D2). */
function Subject({ item }: { item: Pick<ContextItem, 'kind' | 'title'> }) {
  return (
    <p className="flex items-center gap-3 text-body font-bold">
      <KindIcon kind={item.kind} decorative />
      <span className="min-w-0">{item.title}</span>
    </p>
  )
}

const mentionCount = (total: number) =>
  total === 1 ? '1 fact mentions it' : `${total.toLocaleString('en')} facts mention it`

/**
 * An owner, deputy or administrator retires an item at once (FR-218). It says how many items
 * mention it, since their links will show it as retired.
 */
export function RetireItemDialog({ item, open, onOpenChange }: Controlled & { item: ContextItem }) {
  const retire = useApiWrite('retireItem')
  const { data: links } = useQuery({ ...itemLinksQuery(item.id), enabled: open })
  const mentions = links?.mentionedBy.total ?? 0
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Archive this fact?"
      effect={
        <>
          AI apps stop getting it at once. You can still read it and its history.
          {mentions > 0 ? (
            <>
              {' '}
              <strong className="font-bold">{mentionCount(mentions)}</strong>, and those links will
              show &quot;Archived&quot;.
            </>
          ) : null}
        </>
      }
      action="Archive fact"
      actionIcon={ArchiveIcon}
      tone="destructive"
      reason={{
        required: true,
        label: 'Why are you archiving it?',
        hint: "It stays in the fact's history.",
      }}
      onConfirm={async ({ reason }) => {
        await retire.mutateAsync({ id: item.id, reason })
        showToast('Fact archived', 'AI apps no longer get it.')
      }}
    >
      <Subject item={item} />
    </ConfirmDialog>
  )
}

/** Anyone proposes that an item is retired (FR-112); an owner of its domain decides. */
export function ProposeRetirementDialog({
  item,
  open,
  onOpenChange,
}: Controlled & { item: ContextItem }) {
  const propose = useApiWrite('proposeRetirement')
  const { data: areas } = useQuery(areasQuery())
  const domain = areas?.find((area) => area.id === item.areaId)?.name
  const decider = domain ? `An owner of ${domain}` : 'An owner of its domain'
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Suggest archiving this fact?"
      effect={`${decider} decides. AI apps keep getting the fact until then.`}
      action="Suggest archiving"
      actionIcon={SendIcon}
      reason={{
        required: true,
        label: 'Why should it be archived?',
        hint: 'The owner reads this before deciding.',
      }}
      onConfirm={async ({ reason }) => {
        await propose.mutateAsync({ id: item.id, reason })
        showToast('Proposal sent', `${decider} decides whether to archive it.`)
      }}
    >
      <Subject item={item} />
    </ConfirmDialog>
  )
}

/**
 * The owner's check (CON-211): "checked, still correct", or for an open issue past its review
 * date, "yes, still going on". The item stays as written and a new edition is made; a high-risk
 * item waits for its answer tests and the approver first. A definition that is missing cannot
 * be checked against, so the dialog says so before the service does.
 */
export function RecheckItemDialog({
  item,
  stillGoingOn,
  open,
  onOpenChange,
  onChecked,
}: Controlled & {
  item: ContextItem
  stillGoingOn: boolean
  /** Runs once the check is recorded: the upkeep run's next item. */
  onChecked?: () => void
}) {
  const recheck = useApiWrite('recheckItem')
  const kind = stillGoingOn ? 'still_going_on' : 'checked'
  const personId = useSession().data?.person.id ?? ''
  const lastReason = useCheckReason(personId, kind)
  const { data: library } = useQuery(libraryQuery())
  const today = library?.today ?? new Date().toISOString().slice(0, 10)
  const status = itemDisplayStatus(item, today)
  const high = item.riskLevel === 'high'
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={stillGoingOn ? 'Is this still going on?' : 'Checked, still correct?'}
      effect={
        stillGoingOn
          ? `The fact stays as written, and AI apps get it as current again.${high ? " Because it's high risk, an approver confirms it first." : ''}`
          : `You checked the fact against its source. It stays as written, and AI apps are no longer told it may be out of date.${high ? " Because it's high risk, an approver confirms it first." : ''}`
      }
      action={stillGoingOn ? 'Yes, still going on' : 'Checked, still correct'}
      actionIcon={CheckIcon}
      reason={{
        required: true,
        label: 'What you checked',
        defaultValue: lastReason,
        note: lastReason ? 'From your last check. Edit it if this one was different.' : undefined,
      }}
      onConfirm={async ({ reason }) => {
        const result = await recheck.mutateAsync({ id: item.id, reason })
        rememberCheckReason(personId, kind, reason)
        if (result.edition) showToast('Check recorded', 'AI apps get the checked fact now.')
        else
          showToast(
            'Check recorded',
            'AI apps get it once its answer tests pass and an approver accepts it.',
          )
        onChecked?.()
      }}
    >
      <Subject item={item} />
      {stillGoingOn ? null : (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-caption font-bold text-muted-foreground">Why it needs checking</p>
          <StatusBadge status={status} className="w-fit" />
          {item.references.length ? (
            <ul className="flex flex-col gap-1">
              {item.references.map((reference) => (
                <li
                  key={reference}
                  className="truncate font-mono text-caption text-foreground"
                  translate="no"
                >
                  {reference}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {item.checkFlag === 'source_missing' ? (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertContent>
            <AlertDescription>
              A definition this fact uses is gone from its source, so the check may not go through.
              Suggest a change to the fact instead.
            </AlertDescription>
          </AlertContent>
        </Alert>
      ) : null}
    </ConfirmDialog>
  )
}
