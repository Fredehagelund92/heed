import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { domainHues, type DomainHue } from '@domain/item'
import type { AreaDetail } from '@/api'
import { areasQuery, useApiWrite } from '@/api/queries'
import { PeoplePicker, type PickedPerson } from '@/components/form/person-picker'
import { DomainBadge } from '@/components/item/item-marks'
import {
  CalendarClockIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  HashIcon,
  LayersIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  TagIcon,
  UserRoundCheckIcon,
  UsersIcon,
} from '@/components/icons'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { DomainAboutFields } from '@/components/workbench/domain-about'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { domainAbout } from '@/lib/areas'
import { areaFormProblems, areaIdFrom, hueNames, type AreaFormValues } from '@/lib/settings'
import { showToast } from '@/lib/toast'

const REASON_MAX = 500
const listFormat = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })
/** "Jon Abara and Sofia Brandt". */
const ownerNames = (people: readonly PickedPerson[]) =>
  listFormat.format(people.map((person) => person.name))

/** What a new domain may leave for later: under More details, and on Edit afterwards. */
const laterFields = new Set<keyof AreaFormValues>([
  'label',
  'reviewDays',
  'chatChannel',
  'ownerTeam',
  'summary',
  'description',
])

/** The fields in the order they show, so the first problem takes focus. */
const fieldOrder = [
  'name',
  'id',
  'label',
  'reviewDays',
  'chatChannel',
  'ownerTeam',
  'summary',
  'description',
  'reason',
] as const

/**
 * Creating a domain (the specification's area), or changing one (FR-801): its name, the id that
 * stays for good, its hue on the domain ring, the review time owners have, its chat channel and
 * owner team, what it is (FR-813), and, for a change, why. A new domain needs only its name and
 * the id suggested from it: the rest has a default or can wait, under More details, and creating
 * it is its own record in the history log. It may be created with its team: its owners and
 * approvers hold their roles from the same step. Later they change on the domain's Team tab
 * in Health. Save is never disabled: pressing it says what is missing, next to the field.
 */
export function AreaEditor({
  area,
  open,
  onOpenChange,
}: {
  /** The area to change, with the revision read; null to create one. */
  area: AreaDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isNew = area === null
  const { data: areas = [] } = useQuery(areasQuery())
  const create = useApiWrite('createArea')
  const update = useApiWrite('updateArea')
  // A new domain's team: optional, given in the same step as the domain.
  const [team, setTeam] = useState<{ owners: PickedPerson[]; approvers: PickedPerson[] }>({
    owners: [],
    approvers: [],
  })
  const [values, setValues] = useState<AreaFormValues>(() =>
    area
      ? {
          id: area.id,
          name: area.name,
          label: area.label,
          reviewDays: String(area.reviewDays),
          chatChannel: area.chatChannel ?? '',
          ownerTeam: area.ownerTeam ?? '',
          summary: area.summary,
          description: area.description,
          reason: '',
        }
      : {
          id: '',
          name: '',
          label: domainHues.find((hue) => !areas.some((a) => a.label === hue)) ?? 'teal',
          reviewDays: '5',
          chatChannel: '',
          ownerTeam: '',
          summary: '',
          description: '',
          reason: '',
        },
  )
  // A new area's id follows its name until the person types one of their own.
  const [idTouched, setIdTouched] = useState(false)
  const [shown, setShown] = useState<Partial<Record<keyof AreaFormValues, string>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(false)
  const spinning = usePendingIndicator(busy)
  const taken = areas.filter((candidate) => candidate.id !== area?.id)

  const set = (name: keyof AreaFormValues, value: string) => {
    const next = { ...values, [name]: value }
    if (isNew && name === 'name' && !idTouched) next.id = areaIdFrom(value)
    setValues(next)
    // A field already marked wrong is checked again as it is corrected.
    const marked = (Object.keys(shown) as (keyof AreaFormValues)[]).filter((key) => shown[key])
    if (marked.length) {
      const problems = areaFormProblems(next, isNew, taken)
      setShown(Object.fromEntries(marked.map((key) => [key, problems[key]])))
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const problems = areaFormProblems(values, isNew, taken)
    setShown(problems)
    const first = fieldOrder.find((name) => problems[name])
    if (first) {
      const focus = () =>
        (
          document.getElementById(`area-${first}`) ??
          document.querySelector<HTMLElement>(`textarea[name=${first}]`)
        )?.focus()
      // A problem under More details opens it first, so the field can take focus.
      if (isNew && laterFields.has(first) && !details) {
        setDetails(true)
        requestAnimationFrame(focus)
      } else focus()
      return
    }
    setFailure(null)
    setBusy(true)
    const fields = {
      id: values.id,
      name: values.name.trim(),
      label: values.label as DomainHue,
      reviewDays: Number(values.reviewDays),
      chatChannel: values.chatChannel.trim() || null,
      ownerTeam: values.ownerTeam.trim() || null,
      ...domainAbout(values),
    }
    const staffed = Boolean(team.owners.length || team.approvers.length)
    try {
      const saved = area
        ? await update.mutateAsync({
            ...fields,
            revision: area.revision,
            reason: values.reason.trim(),
          })
        : await create.mutateAsync({
            ...fields,
            ...(staffed
              ? {
                  team: {
                    ownerIds: team.owners.map((person) => person.id),
                    approverIds: team.approvers.map((person) => person.id),
                  },
                }
              : {}),
          })
      showToast(
        isNew ? `${saved.name} created` : `${saved.name} saved`,
        isNew
          ? team.owners.length
            ? `${ownerNames(team.owners)} ${team.owners.length === 1 ? 'is its owner' : 'are its owners'}. Agents get its facts as soon as they're accepted.`
            : 'Give it an owner on its Team tab in Health.'
          : 'The history log keeps what changed and why.',
      )
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Try again.'
      setFailure(
        /changed (since|after) you (read|opened) it/.test(message)
          ? 'Someone changed this domain after you opened it. Close this, then open it again to see their change.'
          : message,
      )
    } finally {
      setBusy(false)
    }
  }

  const textField = (
    name: 'name' | 'id' | 'chatChannel' | 'ownerTeam' | 'reviewDays',
    label: string,
    icon: typeof TagIcon,
    description: string,
    options: { optional?: boolean; mono?: boolean; numeric?: boolean; placeholder?: string } = {},
  ) => (
    <Field name={name} invalid={Boolean(shown[name])} disabled={busy}>
      <FieldHeader>
        <FieldLabel icon={icon} optional={options.optional}>
          {label}
        </FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldHeader>
      <FieldControl
        value={values[name]}
        onValueChange={(next) => {
          if (name === 'id') setIdTouched(true)
          set(name, String(next))
        }}
        render={
          <Input
            id={`area-${name}`}
            size="lg"
            autoComplete="off"
            spellCheck={options.mono ? false : undefined}
            autoCapitalize={options.mono ? 'off' : undefined}
            inputMode={options.numeric ? 'numeric' : undefined}
            placeholder={options.placeholder}
            className={
              options.numeric
                ? 'w-number-field tabular-nums'
                : options.mono
                  ? 'font-mono'
                  : undefined
            }
          />
        }
      />
      <FieldError>{shown[name]}</FieldError>
    </Field>
  )

  // What a new domain may leave for later, and an edit shows in full.
  const settings = (
    <>
      <Field name="label" invalid={Boolean(shown.label)} disabled={busy}>
        <FieldHeader>
          <FieldLabel icon={TagIcon}>Colour</FieldLabel>
          <FieldDescription>
            The domain&apos;s colour on the domain ring. Two domains can share a colour, because the
            name always shows beside it.
          </FieldDescription>
        </FieldHeader>
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect
            id="area-label"
            size="lg"
            value={values.label}
            onChange={(event) => set('label', event.target.value)}
            className="w-column-owner"
          >
            {domainHues.map((hue) => (
              <NativeSelectOption key={hue} value={hue}>
                {hueNames[hue]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <DomainBadge
            name={values.name.trim() || 'New domain'}
            label={values.label as DomainHue}
          />
        </div>
      </Field>
      {textField(
        'reviewDays',
        'Review time, in working days',
        CalendarClockIcon,
        'How long an owner has to decide on a proposal, from 1 to 30.',
        { numeric: true },
      )}
      {textField(
        'chatChannel',
        'Chat channel',
        MessageSquareIcon,
        "The channel where the domain's team talks, as your chat tool names it.",
        {
          optional: true,
          placeholder: '#retention-data',
        },
      )}
      {textField(
        'ownerTeam',
        'Business team',
        UsersIcon,
        'The team responsible for the domain’s numbers. Agents get its name with the domain.',
        {
          optional: true,
        },
      )}
      <DomainAboutFields
        values={{ summary: values.summary, description: values.description }}
        problems={{ summary: shown.summary, description: shown.description }}
        disabled={busy}
        onChange={(about) =>
          about.summary !== values.summary
            ? set('summary', about.summary)
            : set('description', about.description)
        }
      />
    </>
  )

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
        className="flex max-h-drawer max-w-dialog-wide flex-col gap-0 overflow-hidden p-0"
      >
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex min-h-0 flex-1 flex-col"
          aria-label={isNew ? 'Create a domain' : `Edit ${area.name}`}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 pointer-coarse:p-4">
            <DialogHeader>
              <DialogTitle>{isNew ? 'Create a domain' : `Edit ${area.name}`}</DialogTitle>
              <DialogDescription>
                {isNew
                  ? 'A domain is a part of the business, such as Traffic or Payments. Its owners check the facts written about its metrics. A name is all it needs now, and the rest can wait.'
                  : 'Changes apply at once. The history log keeps them.'}
              </DialogDescription>
            </DialogHeader>
            {failure ? (
              <Alert variant="danger" role="alert">
                <CircleAlertIcon aria-hidden />
                <AlertContent>
                  <AlertTitle>We couldn&apos;t save the domain</AlertTitle>
                  <AlertDescription>{failure}</AlertDescription>
                </AlertContent>
              </Alert>
            ) : null}
            <FieldGroup>
              {textField(
                'name',
                'Name',
                LayersIcon,
                'The name people see. Each domain needs a name of its own.',
                {
                  placeholder: 'For example: Retention',
                },
              )}
              {isNew ? (
                textField(
                  'id',
                  'Id',
                  HashIcon,
                  'We suggest it from the name. It can’t change once the domain exists, because facts and a source’s view-to-domain file use it. Use lowercase letters, digits and underscores.',
                  { mono: true },
                )
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="flex items-center gap-2 text-body font-bold heed-ink">
                    <HashIcon aria-hidden className="size-4 text-muted-foreground" />
                    Id
                  </p>
                  <p className="text-body">
                    <span className="font-mono" translate="no">
                      {area.id}
                    </span>
                    <span className="text-muted-foreground"> · fixed once a domain is created</span>
                  </p>
                </div>
              )}
              {isNew ? (
                <Collapsible
                  open={details}
                  onOpenChange={setDetails}
                  className="flex flex-col gap-4"
                  data-slot="area-details"
                >
                  <CollapsibleTrigger className="group/details flex w-fit items-center gap-2 rounded-sm text-body font-bold heed-ink">
                    <ChevronDownIcon
                      aria-hidden
                      className="size-4 -rotate-90 text-muted-foreground transition-transform group-data-panel-open/details:rotate-0"
                    />
                    More details
                    <span className="font-normal text-muted-foreground">
                      (optional: colour, review time, what it is, team)
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex flex-col gap-6">
                    <p className="text-dense text-muted-foreground">
                      Each has a default or can stay empty. Change them later with Edit, and the
                      team on the domain&apos;s Team tab in Health.
                    </p>
                    {settings}
                    <FieldSet data-slot="area-team">
                      <FieldHeader>
                        <FieldLegend icon={UsersIcon}>
                          Team <span className="font-normal text-muted-foreground">(optional)</span>
                        </FieldLegend>
                        <FieldDescription>
                          They hold their roles as soon as the domain is created. Change them later
                          on its Team tab in Health.
                        </FieldDescription>
                      </FieldHeader>
                      <Field name="owners" disabled={busy}>
                        <FieldLabel icon={UserRoundCheckIcon} htmlFor="area-owners">
                          Owners
                        </FieldLabel>
                        <FieldDescription>
                          Each one decides on the domain&apos;s proposals.
                        </FieldDescription>
                        <PeoplePicker
                          id="area-owners"
                          value={team.owners}
                          onValueChange={(next) => setTeam({ ...team, owners: next })}
                          disabled={busy}
                        />
                      </Field>
                      <Field name="approvers" disabled={busy}>
                        <FieldLabel icon={ShieldCheckIcon} htmlFor="area-approvers">
                          High-risk approvers
                        </FieldLabel>
                        <PeoplePicker
                          id="area-approvers"
                          value={team.approvers}
                          onValueChange={(next) => setTeam({ ...team, approvers: next })}
                          disabled={busy}
                        />
                      </Field>
                    </FieldSet>
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                <>
                  {settings}
                  <Field name="reason" invalid={Boolean(shown.reason)} disabled={busy}>
                    <FieldHeader>
                      <FieldLabel icon={MessageSquareIcon}>Why</FieldLabel>
                      <FieldDescription>Kept in the history log with the change.</FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      id="area-reason"
                      value={values.reason}
                      onValueChange={(next) => set('reason', String(next))}
                      render={
                        <Textarea
                          rows={3}
                          className="resize-y text-body pointer-coarse:text-large"
                        />
                      }
                    />
                    <FieldFooter>
                      <FieldError>{shown.reason}</FieldError>
                      <FieldCounter count={[...values.reason].length} max={REASON_MAX} />
                    </FieldFooter>
                  </Field>
                </>
              )}
            </FieldGroup>
          </div>
          <DialogFooter className="border-t px-6 py-4 pointer-coarse:px-4">
            <DialogClose render={<Button variant="outline" size="lg" disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              size="lg"
              aria-disabled={busy || undefined}
              onMouseDown={(event) => event.preventDefault()}
              className="relative"
            >
              <span className={spinning ? 'opacity-0' : undefined}>
                {isNew ? 'Create domain' : 'Save changes'}
              </span>
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
