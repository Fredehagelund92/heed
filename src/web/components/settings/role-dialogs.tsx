import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { AssignmentInput, GrantChange, PersonRow, RoleInput } from '@/api'
import { GRANT_BATCH_MAX, lastOwnerMessage } from '../../../contract/auth.ts'
import { areasQuery, grantsQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog, REASON_MAX_LENGTH } from '@/components/form/confirm-dialog'
import { keepOnEscape, PeoplePicker, type PickedPerson } from '@/components/form/person-picker'
import {
  CircleAlertIcon,
  LayersIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { DomainOptionText, domainOptionProps } from '@/components/item/domain-option'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldGroup,
  FieldHeader,
  FieldItem,
  FieldItemContent,
  FieldLabel,
} from '@/components/ui/field'
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import {
  areaRoleWords,
  giveChanges,
  globalRoleWords,
  heldRoleName,
  isAreaRole,
  leftWithoutOwner,
  removal,
  aRoleWord,
  roleWord,
  roleWords,
  rolesCount,
  stepCounts,
  type Role,
} from '@/lib/roles'
import { showToast } from '@/lib/toast'
import { useSession } from '@/lib/use-session'

import { usePeople } from './settings-parts'

const listFormat = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })

/*
  The role changes of People and roles and of a domain's Team tab (FR-804). Each dialog sends one
  step through `applyGrants`: every change of it applies, or none does, and each is its own
  history entry with the step's batch id and the optional reason.
*/

/** The most lines an outcome lists before it counts the rest. */
const OUTCOME_LINES = 8

/** Why, optional, kept with every history entry of the step. */
function ReasonField({
  id,
  value,
  onChange,
  disabled,
  problem,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
  problem?: string
}) {
  return (
    <Field name="reason" invalid={Boolean(problem)} disabled={disabled}>
      <FieldHeader>
        <FieldLabel icon={MessageSquareIcon} optional htmlFor={id}>
          Why
        </FieldLabel>
        <FieldDescription>Kept in the history log with each change.</FieldDescription>
      </FieldHeader>
      <FieldControl
        id={id}
        value={value}
        onValueChange={(next) => onChange(String(next))}
        render={<Textarea rows={2} className="resize-y text-body pointer-coarse:text-large" />}
      />
      <FieldFooter>
        <FieldError>{problem}</FieldError>
        <FieldCounter count={[...value].length} max={REASON_MAX_LENGTH} />
      </FieldFooter>
    </Field>
  )
}

const reasonProblem = (reason: string) =>
  [...reason].length > REASON_MAX_LENGTH
    ? `Shorten it by ${([...reason].length - REASON_MAX_LENGTH).toLocaleString('en')} characters.`
    : undefined

/** Several domains, as chips. */
function AreasPicker({
  id,
  areas,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string
  areas: readonly Area[]
  value: readonly string[]
  onChange: (ids: string[]) => void
  disabled: boolean
  invalid: boolean
}) {
  const anchor = useComboboxAnchor()
  const sorted = [...areas].sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const chosen = sorted.filter((area) => value.includes(area.id))
  return (
    <Combobox
      multiple
      items={sorted}
      value={chosen}
      onValueChange={(next: Area[]) => onChange(next.map((area) => area.id))}
      itemToStringLabel={(area: Area) => area.name}
      isItemEqualToValue={(a: Area, b: Area) => a.id === b.id}
      autoHighlight
      disabled={disabled}
    >
      <ComboboxChips ref={anchor} size="lg">
        <ComboboxValue>
          {(picked: Area[]) =>
            picked.map((area) => (
              <ComboboxChip key={area.id} label={area.name}>
                {area.name}
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput
          id={id}
          placeholder={chosen.length ? undefined : 'Type a domain'}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          onKeyDown={keepOnEscape}
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No domain has that name.</ComboboxEmpty>
        <ComboboxList>
          {(area: Area) => (
            <ComboboxItem key={area.id} value={area} {...domainOptionProps(area, 'role-domain')}>
              <DomainOptionText area={area} list="role-domain">
                <DomainBadge name={area.name} label={area.label} form="bare" size="sm" />
              </DomainOptionText>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/** The dialog's frame: a form with a scrolling body and the footer's two buttons. */
function StepDialog({
  open,
  onOpenChange,
  busy,
  title,
  description,
  failure,
  failureTitle,
  action,
  tooMany,
  onSubmit,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  title: string
  description: ReactNode
  failure: string | null
  failureTitle: string
  action: string
  /** Set when the step has more changes than one step may hold; it says how to split it. */
  tooMany?: string
  onSubmit: () => void
  children: ReactNode
}) {
  const spinning = usePendingIndicator(busy)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        aria-busy={busy || undefined}
        className="flex max-h-drawer flex-col gap-0 overflow-hidden p-0"
      >
        <form
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (!busy) onSubmit()
          }}
          aria-label={title}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 pointer-coarse:p-4">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            {failure ? (
              <Alert variant="danger" role="alert">
                <CircleAlertIcon aria-hidden />
                <AlertContent>
                  <AlertTitle>{failureTitle}</AlertTitle>
                  <AlertDescription>{failure}</AlertDescription>
                </AlertContent>
              </Alert>
            ) : null}
            {children}
            {tooMany ? (
              <Alert variant="danger" data-slot="too-many">
                <CircleAlertIcon aria-hidden />
                <AlertContent>
                  <AlertTitle>Too many changes for one step</AlertTitle>
                  <AlertDescription>{tooMany}</AlertDescription>
                </AlertContent>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="border-t px-6 py-4 pointer-coarse:px-4">
            <DialogClose render={<Button variant="outline" size="lg" disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              size="lg"
              disabled={Boolean(tooMany)}
              aria-disabled={busy || undefined}
              className="relative"
            >
              <span className={spinning ? 'opacity-0' : undefined}>{action}</span>
              {spinning ? (
                <LoaderCircleIcon
                  aria-hidden
                  className="absolute inset-0 m-auto motion-safe:animate-spin"
                />
              ) : null}
            </Button>
          </DialogFooter>
          <p role="status" className="sr-only">
            {spinning ? 'Saving' : ''}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Why a step of this many changes is not sent, with how to split it; nothing when it fits. */
function tooManyWords(count: number, what: string) {
  return count > GRANT_BATCH_MAX
    ? `That's ${count.toLocaleString('en')} changes, and one step can make at most ${GRANT_BATCH_MAX.toLocaleString('en')}. ${what}`
    : undefined
}

/** The service's refusal in its own words, which say what to do. */
function failureWords(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Try again.'
}

/**
 * Giving a role to one person or many: across Heed, or in one domain or several. A domain may have
 * several owners and approvers, so the role is added beside anyone who holds it, and the dialog
 * says what will happen before anything does.
 */
export function GiveRolesDialog({
  open,
  onOpenChange,
  initial,
  onGiven,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: { people?: readonly PickedPerson[]; role?: Role; areaIds?: readonly string[] }
  /** After the step went through. */
  onGiven?: () => void
}) {
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: grants } = useQuery(grantsQuery())
  const { nameOf: knownName } = usePeople()
  const apply = useApiWrite('applyGrants')
  const [chosen, setChosen] = useState<PickedPerson[]>([...(initial.people ?? [])])
  const people = chosen.map((person) => person.id)
  // A chosen person's name is the picker's; anyone else's, the list's.
  const nameOf = (id: string) => chosen.find((person) => person.id === id)?.name ?? knownName(id)
  const [role, setRole] = useState<Role>(initial.role ?? 'owner')
  const [areaIds, setAreaIds] = useState<string[]>([...(initial.areaIds ?? [])])
  const [reason, setReason] = useState('')
  const [shown, setShown] = useState<{ people?: string; areas?: string; reason?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inArea = isAreaRole(role)
  const areaName = (id: string) => areas.find((area) => area.id === id)?.name ?? id

  const problems = {
    people: people.length ? undefined : 'Choose a person.',
    areas: inArea && areaIds.length === 0 ? 'Choose a domain.' : undefined,
    reason: reasonProblem(reason),
  }
  const changes = giveChanges(people, role, inArea ? areaIds : [])
  const tooMany = tooManyWords(
    changes.length,
    'Choose fewer people or fewer domains, and give the role again for the rest.',
  )

  // What the step will do, in sentences, before anything happens.
  const holds = (change: GrantChange) =>
    'areaId' in change
      ? grants?.assignments.some(
          (grant) =>
            grant.areaId === change.areaId &&
            grant.role === change.role &&
            grant.personId === change.personId,
        )
      : grants?.roles.some(
          (grant) => grant.role === change.role && grant.personId === change.personId,
        )
  const outcome = changes
    .filter((change) => change.op === 'grant')
    .map((change) => {
      const where = 'areaId' in change ? ` of ${areaName(change.areaId)}` : ''
      const name = nameOf(change.personId)
      if (holds(change)) return `${name} is already ${aRoleWord(change.role)}${where}.`
      return `${name} becomes ${aRoleWord(change.role)}${where}.`
    })

  const submit = async () => {
    setShown(problems)
    const first = problems.people ? 'give-people' : problems.areas ? 'give-areas' : null
    if (tooMany) return
    if (first || problems.reason) {
      document.getElementById(first ?? 'give-reason')?.focus()
      return
    }
    setFailure(null)
    setBusy(true)
    try {
      const result = await apply.mutateAsync({
        changes,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      const { given, unchanged } = stepCounts(result)
      const only = result.changes.filter((change) => change.op === 'grant')
      const single = only.length === 1 ? only[0]! : null
      if (given === 0)
        showToast(
          single ? `${nameOf(single.personId)} already has this role` : 'Nothing changed',
          single ? 'Nothing changed.' : 'They already have these roles.',
        )
      else if (single)
        showToast(
          `${nameOf(single.personId)} is now ${aRoleWord(single.role)}${'areaId' in single ? ` of ${areaName(single.areaId)}` : ''}`,
          'It applies at once. The history log keeps the change.',
        )
      else
        showToast(
          `${rolesCount(given)} given`,
          unchanged
            ? `${unchanged.toLocaleString('en')} already held. It applies at once, and the history log keeps each change.`
            : 'It applies at once, and the history log keeps each change.',
        )
      onGiven?.()
      onOpenChange(false)
    } catch (error) {
      setFailure(failureWords(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title="Give a role"
      description="It applies at once, and the history log keeps who gave it."
      failure={failure}
      failureTitle="The role wasn't given"
      tooMany={tooMany}
      action={
        changes.filter((change) => change.op === 'grant').length > 1 ? 'Give roles' : 'Give role'
      }
      onSubmit={() => void submit()}
    >
      <FieldGroup>
        <Field name="people" invalid={Boolean(shown.people)} disabled={busy}>
          <FieldHeader>
            <FieldLabel icon={UsersIcon} htmlFor="give-people">
              People
            </FieldLabel>
            <FieldDescription>
              Find one or more people by name or email. People who have left aren&apos;t listed.
            </FieldDescription>
          </FieldHeader>
          <PeoplePicker
            id="give-people"
            value={chosen}
            onValueChange={(next) => {
              setChosen(next)
              if (shown.people) setShown({ ...shown, people: undefined })
            }}
            disabled={busy}
            invalid={Boolean(shown.people)}
          />
          <FieldError>{shown.people}</FieldError>
        </Field>
        <Field name="role" disabled={busy}>
          <FieldHeader>
            <FieldLabel icon={ShieldCheckIcon} htmlFor="give-role">
              Role
            </FieldLabel>
            <FieldDescription>{roleWords[role].about}</FieldDescription>
          </FieldHeader>
          <NativeSelect
            id="give-role"
            size="lg"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            <NativeSelectOptGroup label="In a domain">
              {Object.entries(areaRoleWords).map(([value, words]) => (
                <NativeSelectOption key={value} value={value}>
                  {words.name}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
            <NativeSelectOptGroup label="Everywhere">
              {Object.entries(globalRoleWords).map(([value, words]) => (
                <NativeSelectOption key={value} value={value}>
                  {words.name}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          </NativeSelect>
        </Field>
        {inArea ? (
          <Field name="areas" invalid={Boolean(shown.areas)} disabled={busy}>
            <FieldHeader>
              <FieldLabel icon={LayersIcon} htmlFor="give-areas">
                Domains
              </FieldLabel>
              <FieldDescription>
                The role applies in each domain you choose, beside anyone who already has it there.
              </FieldDescription>
            </FieldHeader>
            <AreasPicker
              id="give-areas"
              areas={areas}
              value={areaIds}
              onChange={(next) => {
                setAreaIds(next)
                if (shown.areas) setShown({ ...shown, areas: undefined })
              }}
              disabled={busy}
              invalid={Boolean(shown.areas)}
            />
            <FieldError>{shown.areas}</FieldError>
          </Field>
        ) : null}
        <ReasonField
          id="give-reason"
          value={reason}
          onChange={setReason}
          disabled={busy}
          problem={shown.reason ?? reasonProblem(reason)}
        />
      </FieldGroup>
      {outcome.length && !problems.people && !problems.areas ? (
        <div className="flex flex-col gap-2" data-slot="give-outcome">
          <h3 className="text-body font-bold">What happens</h3>
          <ul className="flex flex-col gap-1 text-dense">
            {outcome.slice(0, OUTCOME_LINES).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {outcome.length > OUTCOME_LINES ? (
              <li className="text-muted-foreground">
                And {(outcome.length - OUTCOME_LINES).toLocaleString('en')} more.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </StepDialog>
  )
}

type Held = RoleInput | AssignmentInput

/**
 * Removing one role or several in one step, with an optional reason. The last administrator is
 * never removed; the service refuses the whole step, and the dialog says why.
 */
export function RemoveRolesDialog({
  open,
  onOpenChange,
  grants,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  grants: readonly Held[]
  onRemoved?: () => void
}) {
  const { data: areas = [] } = useQuery(areasQuery())
  const { nameOf } = usePeople()
  const { data: session } = useSession()
  const apply = useApiWrite('applyGrants')
  const areaName = (id: string) => areas.find((area) => area.id === id)?.name ?? id
  const line = (grant: Held) =>
    `${nameOf(grant.personId)} as ${roleWord(grant.role)}${'areaId' in grant ? ` of ${areaName(grant.areaId)}` : ''}`
  const single = grants.length === 1 ? grants[0]! : null
  const unstaffed = leftWithoutOwner(grants, areas)
  const own = grants.some((grant) => !('areaId' in grant) && grant.personId === session?.person.id)
  // A domain keeps at least one owner (FR-804): say so, and offer the next step instead.
  if (unstaffed[0])
    return (
      <LastOwnerDialog
        open={open}
        onOpenChange={onOpenChange}
        area={unstaffed[0]}
        ownerName={single ? nameOf(single.personId) : null}
      />
    )
  const effect = own
    ? 'You lose this role at once, and with it the pages that need it.'
    : single && 'areaId' in single
      ? 'They stop deciding for the domain at once. The history log keeps who removed it.'
      : 'They lose what the role lets them do at once. The history log keeps who removed it.'
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={single ? `Remove ${line(single)}?` : `Remove ${rolesCount(grants.length)}?`}
      effect={effect}
      action={single ? 'Remove role' : 'Remove roles'}
      tone="destructive"
      reason={{ required: false, hint: 'Kept in the history log with each change.' }}
      onConfirm={async ({ reason }) => {
        await apply.mutateAsync({
          changes: grants.map(removal),
          ...(reason ? { reason } : {}),
        })
        showToast(
          single ? 'Role removed' : `${rolesCount(grants.length)} removed`,
          'The history log keeps each change.',
        )
        onRemoved?.()
      }}
    >
      {single ? null : (
        <ul
          className="flex max-h-list flex-col gap-1 overflow-y-auto text-dense"
          data-slot="removing"
        >
          {grants.map((grant) => (
            <li key={line(grant)}>{line(grant)}</li>
          ))}
        </ul>
      )}
    </ConfirmDialog>
  )
}

/**
 * What removing a domain's last owner says instead of removing them: a domain keeps at least
 * one owner (FR-804), so its proposals always have someone to decide them. The next step, giving
 * the role to someone else first, is one button away; after it the removal goes through.
 */
export function LastOwnerDialog({
  open,
  onOpenChange,
  area,
  ownerName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  area: Pick<Area, 'id' | 'name'>
  /** Who would have been removed, when it is one person. */
  ownerName: string | null
}) {
  const [giving, setGiving] = useState(false)
  if (giving)
    return (
      <GiveRolesDialog
        open
        onOpenChange={(next) => {
          if (!next) onOpenChange(false)
        }}
        initial={{ role: 'owner', areaIds: [area.id] }}
      />
    )
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-slot="last-owner">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {ownerName
              ? `${ownerName} is the last owner of ${area.name}`
              : `${area.name} would have no owner`}
          </AlertDialogTitle>
          <AlertDialogDescription>{lastOwnerMessage(area.name)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <Button size="lg" onClick={() => setGiving(true)}>
            <PlusIcon aria-hidden />
            Give the role to someone else
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** A role some of the selected people hold, and which of them hold it. */
type HeldBy = { key: string; role: Role; areaId: string | null; people: PersonRow[] }

/**
 * Removing a role from several people at once, from the People page's selection: the roles any
 * of them hold are listed with how many hold each, and every role ticked is removed from each
 * person who holds it, in one step with an optional reason.
 */
export function RemoveFromPeopleDialog({
  open,
  onOpenChange,
  people,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  people: readonly PersonRow[]
  onRemoved?: () => void
}) {
  const { data: areas = [] } = useQuery(areasQuery())
  const apply = useApiWrite('applyGrants')
  const areaName = (id: string) => areas.find((area) => area.id === id)?.name
  const held = new Map<string, HeldBy>()
  for (const person of people)
    for (const role of person.roles) {
      const key = `${role.areaId ?? ''}.${role.role}`
      const entry = held.get(key) ?? { key, ...role, people: [] }
      entry.people.push(person)
      held.set(key, entry)
    }
  const roles = [...held.values()].sort((a, b) =>
    heldRoleName(a, areaName).localeCompare(heldRoleName(b, areaName), 'en'),
  )
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(roles.length === 1 ? [roles[0]!.key] : []),
  )
  const [reason, setReason] = useState('')
  const [shown, setShown] = useState<{ roles?: string; reason?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const chosen = roles.filter((entry) => ticked.has(entry.key))
  const changes: GrantChange[] = chosen.flatMap((entry) =>
    entry.people.map(
      (person) =>
        (entry.areaId
          ? { op: 'revoke', personId: person.id, areaId: entry.areaId, role: entry.role }
          : { op: 'revoke', personId: person.id, role: entry.role }) as GrantChange,
    ),
  )
  const tooMany = tooManyWords(
    changes.length,
    'Select fewer people, or tick fewer roles, and remove the rest in another step.',
  )
  const unstaffed = leftWithoutOwner(
    changes.map(({ op: _op, ...grant }) => grant),
    areas,
  ).map((area) => area.name)

  const submit = async () => {
    const problems = {
      roles: !chosen.length
        ? 'Choose a role to remove.'
        : unstaffed.length
          ? lastOwnerMessage(listFormat.format(unstaffed))
          : undefined,
      reason: reasonProblem(reason),
    }
    setShown(problems)
    if (tooMany || problems.roles || problems.reason) return
    setFailure(null)
    setBusy(true)
    try {
      const result = await apply.mutateAsync({
        changes,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      const { removed } = stepCounts(result)
      showToast(`${rolesCount(removed)} removed`, 'The history log keeps each change.')
      onRemoved?.()
      onOpenChange(false)
    } catch (error) {
      setFailure(failureWords(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={`Remove a role from ${people.length.toLocaleString('en')} ${people.length === 1 ? 'person' : 'people'}`}
      description="Each role you tick is removed at once from everyone selected who has it."
      failure={failure}
      failureTitle="No role was removed"
      tooMany={tooMany}
      action={changes.length > 1 ? `Remove ${rolesCount(changes.length)}` : 'Remove role'}
      onSubmit={() => void submit()}
    >
      {roles.length === 0 ? (
        <p className="text-body text-muted-foreground">
          Nobody selected has a role. Like everyone signed in, they can read facts and suggest
          changes.
        </p>
      ) : (
        <FieldGroup>
          <Field name="roles" invalid={Boolean(shown.roles)} disabled={busy}>
            <FieldHeader>
              <FieldLabel icon={ShieldCheckIcon}>Roles they hold</FieldLabel>
              <FieldDescription>How many of those selected hold each.</FieldDescription>
            </FieldHeader>
            <ul className="flex flex-col gap-3" data-slot="remove-roles">
              {roles.map((entry) => {
                const name = heldRoleName(entry, areaName)
                return (
                  <li key={entry.key}>
                    <FieldItem>
                      <Checkbox
                        id={`remove-${entry.key}`}
                        checked={ticked.has(entry.key)}
                        onCheckedChange={(on) => {
                          const next = new Set(ticked)
                          if (on) next.add(entry.key)
                          else next.delete(entry.key)
                          setTicked(next)
                          if (shown.roles) setShown({ ...shown, roles: undefined })
                        }}
                      />
                      <FieldItemContent>
                        <FieldLabel htmlFor={`remove-${entry.key}`} className="font-normal">
                          {name}
                        </FieldLabel>
                        <FieldDescription>
                          {entry.people.length === people.length
                            ? people.length === 1
                              ? entry.people[0]!.name
                              : `All ${people.length.toLocaleString('en')}`
                            : `${entry.people.length.toLocaleString('en')} of ${people.length.toLocaleString('en')}: ${entry.people.map((person) => person.name).join(', ')}`}
                        </FieldDescription>
                      </FieldItemContent>
                    </FieldItem>
                  </li>
                )
              })}
            </ul>
            <FieldError>{shown.roles}</FieldError>
          </Field>
          <ReasonField
            id="remove-reason"
            value={reason}
            onChange={setReason}
            disabled={busy}
            problem={shown.reason ?? reasonProblem(reason)}
          />
        </FieldGroup>
      )}
    </StepDialog>
  )
}
