import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { PersonGrant, PersonRow } from '@/api'
import { areasQuery, personSheetQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { DetailsList } from '@/components/page/details-list'
import { DockPanel } from '@/components/page/dock-panel'
import { HistoryIcon, PlusIcon, ShieldCheckIcon, XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { formatDay, formatMoment } from '@/lib/library'
import {
  heldRoleName,
  isAreaRole,
  lastSignInWords,
  leftWithoutOwner,
  personStatusWords,
  roleInSentence,
} from '@/lib/roles'
import { showToast } from '@/lib/toast'
import { useSession } from '@/lib/use-session'
import { GiveRolesDialog, LastOwnerDialog } from './role-dialogs'
import { usePeople } from './settings-parts'
import { productName } from '@/lib/brand'

/**
 * A person's sheet in the docked panel (people and roles decision, slice 1): who they are, when
 * they last signed in, every role they hold with since when and who gave it, and every change to
 * their roles from the history log, newest first. An administrator gives a role from here, with
 * the person already chosen, and removes one; the last administrator is never removed, and the
 * service says so. A person who has left holds nothing new.
 */
export function PersonPanel({
  id,
  loaded,
  position,
  onPrevious,
  onNext,
  onClose,
}: {
  id: string
  /** The person's row when a loaded page holds it, so the panel names them at once. */
  loaded: PersonRow | undefined
  position: { index: number; total: number } | null
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
}) {
  const sheet = useQuery(personSheetQuery(id))
  const { data: areas = [] } = useQuery(areasQuery())
  const { nameOf } = usePeople()
  const { data: session } = useSession()
  const [giving, setGiving] = useState(false)
  const [removing, setRemoving] = useState<PersonGrant | null>(null)
  const apply = useApiWrite('applyGrants')
  const areaName = (areaId: string) => areas.find((area) => area.id === areaId)?.name
  const person = sheet.data?.person ?? loaded
  const shared = {
    meta: (
      <>
        <span className="truncate">Person</span>
        {position ? (
          <span className="shrink-0">
            · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
          </span>
        ) : null}
      </>
    ),
    onPrevious,
    onNext,
    onClose,
  }

  if (sheet.data === null || (!person && sheet.isError))
    return (
      <DockPanel
        title={sheet.isError ? "We couldn't load this person" : "We couldn't find this person"}
        {...shared}
      >
        <p className="text-body text-muted-foreground">
          Close this and choose a person from the list.
        </p>
      </DockPanel>
    )
  if (!person) return <DockPanel title={null} {...shared} />

  const readAt = sheet.data?.readAt ?? new Date().toISOString()
  const active = person.status === 'active'
  // Their last ownership of a domain stays: the domain keeps at least one owner (FR-804).
  const lastOf =
    removing?.role === 'owner' && removing.areaId
      ? leftWithoutOwner(
          [{ personId: person.id, areaId: removing.areaId, role: 'owner' }],
          areas,
        )[0]
      : undefined
  const removal = removing
    ? {
        title: `Remove ${person.name} as ${roleInSentence(removing, areaName)}?`,
        effect:
          removing.role === 'owner'
            ? 'They stop accepting proposals for the domain at once. Its other owners carry on, and the other domains they own stay theirs.'
            : removing.areaId
              ? 'They stop giving the second yes for the domain at once.'
              : person.id === session?.person.id
                ? 'You lose this role at once, and with it the pages that need it.'
                : 'They lose what the role lets them do at once. The history log keeps who removed it.',
      }
    : null

  return (
    <DockPanel
      title={person.name}
      contentKey={person.id}
      note={
        <p className="text-body text-muted-foreground" data-slot="person-note">
          {person.email ?? 'No email address. It was erased.'}
          {active ? '' : ` · ${personStatusWords[person.status]}`}
        </p>
      }
      footer={
        active ? (
          <Button variant="outline" onClick={() => setGiving(true)}>
            <PlusIcon aria-hidden />
            Give a role
          </Button>
        ) : undefined
      }
      {...shared}
    >
      <div className="flex flex-col gap-6" data-slot="person-sheet">
        <DetailsList
          label="About them"
          rows={[
            { label: 'Status', value: personStatusWords[person.status] },
            {
              label: 'Last sign-in',
              value: person.lastSignedInAt
                ? `${lastSignInWords(person.lastSignedInAt, readAt)} · ${formatMoment(person.lastSignedInAt, 'long')}`
                : 'Never signed in',
            },
            ...(sheet.data
              ? [{ label: 'Known since', value: formatDay(sheet.data.person.createdAt, 'long') }]
              : []),
          ]}
        />
        <section className="flex flex-col gap-3" aria-labelledby={`${person.id}-roles`}>
          <h3 id={`${person.id}-roles`} className="text-body font-bold">
            Roles
          </h3>
          {!sheet.data ? (
            <p className="text-body text-muted-foreground">Loading their roles…</p>
          ) : sheet.data.grants.length === 0 ? (
            <p className="text-body text-muted-foreground" data-slot="person-no-roles">
              No role. Like everyone signed in, they {active ? 'can' : 'could'} read facts and
              suggest changes.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border" data-slot="person-roles">
              {sheet.data.grants.map((grant) => {
                const name = heldRoleName(grant, areaName)
                return (
                  <li
                    key={`${grant.role}.${grant.areaId ?? ''}`}
                    data-grant={`${grant.areaId ? `${grant.areaId}.` : ''}${grant.role}`}
                    className="flex min-h-row items-center gap-3 py-2 pr-1 pl-3"
                  >
                    <ShieldCheckIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-body">{name}</span>
                      <span className="text-caption text-muted-foreground">
                        Since {formatDay(grant.since, 'long')} ·{' '}
                        {grant.grantedBy ? `given by ${nameOf(grant.grantedBy)}` : 'given at setup'}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${person.name} as ${roleInSentence(grant, areaName)}`}
                      title="Remove this role"
                      onClick={() => setRemoving(grant)}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-3" aria-labelledby={`${person.id}-history`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${person.id}-history`} className="text-body font-bold">
              Role history
            </h3>
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/admin" search={{ section: 'audit', actor: person.id }} />}
            >
              <HistoryIcon aria-hidden />
              What they changed
            </Button>
          </div>
          {!sheet.data ? null : sheet.data.history.length === 0 ? (
            <p className="text-body text-muted-foreground" data-slot="person-no-history">
              No role changes yet. Roles given at setup have no history.
            </p>
          ) : (
            <ol className="flex flex-col gap-3" data-slot="person-history">
              {sheet.data.history.map((change) => (
                <li key={change.seq} className="flex flex-col gap-1">
                  <span className="text-body">
                    {change.change === 'granted' ? 'Given' : 'Removed'}:{' '}
                    {roleInSentence(change, areaName)}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {formatMoment(change.at, 'long')} · by{' '}
                    {change.actorName ?? (change.actorId ? nameOf(change.actorId) : productName)}
                  </span>
                  {change.reason ? (
                    <span className="text-dense break-words" data-slot="person-history-reason">
                      {change.reason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      {giving ? (
        <GiveRolesDialog
          initial={{
            people: [
              {
                id: person.id,
                name: person.name,
                initials: person.initials,
                email: person.email,
                status: person.status,
              },
            ],
          }}
          open
          onOpenChange={setGiving}
        />
      ) : null}
      {lastOf ? (
        <LastOwnerDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(null)
          }}
          area={lastOf}
          ownerName={person.name}
        />
      ) : removing && removal ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(null)
          }}
          title={removal.title}
          effect={removal.effect}
          action="Remove role"
          tone="destructive"
          reason={{ required: false, hint: 'Kept in the history log with the change.' }}
          onConfirm={async ({ reason }) => {
            const role = removing.role
            const change =
              isAreaRole(role) && removing.areaId
                ? { op: 'revoke' as const, personId: person.id, areaId: removing.areaId, role }
                : !isAreaRole(role)
                  ? { op: 'revoke' as const, personId: person.id, role }
                  : null
            if (change)
              await apply.mutateAsync({ changes: [change], ...(reason ? { reason } : {}) })
            showToast('Role removed', 'The history log keeps the change.')
            setRemoving(null)
          }}
        />
      ) : null}
    </DockPanel>
  )
}
