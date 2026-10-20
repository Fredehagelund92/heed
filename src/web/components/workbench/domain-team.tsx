import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { AssignmentInput } from '@/api'
import { grantsQuery } from '@/api/queries'
import { LoadError } from '@/components/editions/load-error'
import { PlusIcon, XIcon } from '@/components/icons'
import { Owner } from '@/components/item/item-marks'
import { GiveRolesDialog, RemoveRolesDialog } from '@/components/settings/role-dialogs'
import { usePeople } from '@/components/settings/settings-parts'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { areaRoleWords } from '@/lib/roles'
import { usePermissions } from '@/lib/use-session'

/*
  A domain's Team tab in Health (FR-804): who looks after it. A domain may have several owners,
  who each decide its proposals, and several high-risk approvers; an administrator adds people to
  either list in one step and removes one at a time, and removing the last owner says the
  domain's proposals then wait. Everyone who opens the record sees the owners; the approvers and
  the changes are an administrator's, as the roles are.
*/

type ListedRole = 'owner' | 'approver'

function RoleList({
  area,
  role,
  people,
  onAdd,
  onRemove,
  empty,
}: {
  area: Area
  role: ListedRole
  people: readonly string[]
  onAdd?: () => void
  onRemove?: (personId: string) => void
  empty: string
}) {
  const { person, nameOf } = usePeople()
  const words = areaRoleWords[role].name
  const plural = role === 'owner' ? 'Owners' : 'High-risk approvers'
  const id = `team-${role}s`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={id} className="text-body font-bold">
          {plural}
        </h3>
        {onAdd ? (
          <Button variant="outline" size="sm" onClick={onAdd}>
            <PlusIcon aria-hidden />
            {role === 'owner' ? 'Add owners' : 'Add approvers'}
          </Button>
        ) : null}
      </div>
      {people.length === 0 ? (
        <p className="text-dense text-muted-foreground">{empty}</p>
      ) : (
        <ul
          aria-label={`${plural} of ${area.name}`}
          className="flex flex-col divide-y rounded-lg border"
        >
          {people.map((personId) => (
            <li key={personId} className="flex min-h-row-comfortable items-center gap-3 px-4 py-2">
              <div className="flex min-w-0 flex-1 items-center">
                <Owner name={nameOf(personId)} initials={person(personId)?.initials} />
              </div>
              {onRemove ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${nameOf(personId)} as ${words.toLowerCase()}`}
                  title={`Remove ${nameOf(personId)} as ${words.toLowerCase()}`}
                  onClick={() => onRemove(personId)}
                >
                  <XIcon aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function DomainTeam({ area }: { area: Area }) {
  const { isAdmin } = usePermissions()
  const grants = useQuery({ ...grantsQuery(), enabled: isAdmin })
  const { nameOf } = usePeople()
  const [adding, setAdding] = useState<ListedRole | null>(null)
  const [removing, setRemoving] = useState<AssignmentInput | null>(null)
  const approvers = (grants.data?.assignments ?? [])
    .filter((grant) => grant.areaId === area.id && grant.role === 'approver')
    .map((grant) => grant.personId)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'en'))
  const manage = (role: ListedRole) =>
    isAdmin
      ? {
          onAdd: () => setAdding(role),
          onRemove: (personId: string) => setRemoving({ areaId: area.id, personId, role }),
        }
      : {}

  return (
    <div data-slot="domain-team" className="flex flex-col gap-6">
      <p className="max-w-reading text-dense text-muted-foreground">
        {isAdmin
          ? `Who looks after ${area.name}. Every owner decides its proposals. The history log keeps every change.`
          : `Who looks after ${area.name}. Every owner decides its proposals. An admin changes the team.`}
      </p>
      <RoleList
        area={area}
        role="owner"
        people={area.ownerIds}
        empty={`No owner yet, so proposals for ${area.name} wait.${isAdmin ? '' : ' An admin adds one.'}`}
        {...manage('owner')}
      />
      {isAdmin ? (
        grants.isPending ? (
          <div role="status" aria-label="Loading the approvers" className="flex flex-col gap-2">
            <Skeleton className="h-row-comfortable w-full" />
          </div>
        ) : grants.isError ? (
          <LoadError what="approvers" onRetry={() => void grants.refetch()} />
        ) : (
          <RoleList
            area={area}
            role="approver"
            people={approvers}
            empty="Nobody yet. A high-risk proposal needs an approver's yes as well as an owner's."
            {...manage('approver')}
          />
        )
      ) : null}
      {adding ? (
        <GiveRolesDialog
          open
          onOpenChange={(open) => {
            if (!open) setAdding(null)
          }}
          initial={{ role: adding, areaIds: [area.id] }}
        />
      ) : null}
      {removing ? (
        <RemoveRolesDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(null)
          }}
          grants={[removing]}
        />
      ) : null}
    </div>
  )
}
