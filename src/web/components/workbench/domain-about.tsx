import { useState, type FormEvent } from 'react'
import { AREA_DESCRIPTION_MAX, AREA_SUMMARY_MAX, type Area } from '@domain/item'
import { toApiError } from '@/api/errors'
import { useApiWrite } from '@/api/queries'
import { BodyInput } from '@/components/editor/body-input'
import { Markdown } from '@/components/form/markdown'
import {
  AlignLeftIcon,
  CircleAlertIcon,
  InfoIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  TextQuoteIcon,
} from '@/components/icons'
import { RecordSection } from '@/components/page/record-parts'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { domainAbout, domainAboutProblems, type DomainAboutValues } from '@/lib/areas'
import { showToast } from '@/lib/toast'
import { usePermissions } from '@/lib/use-session'

/*
  What a domain is and what kind of data it holds (FR-813): a summary line for lists and pickers,
  and a description in light Markdown, written in the editor item text uses (contract 9.6) with
  mentions off, at the size the record reads it, so what is typed looks as it will show. Its owner, its deputy or an administrator writes them,
  here on the domain's record in Health and in Administration > Domains. People read them on the
  record; the assistant and AI apps read them with the domain.
*/

/** The summary and description fields, as the domain's record and Administration edit them. */
export function DomainAboutFields({
  values,
  problems,
  disabled,
  onChange,
}: {
  values: DomainAboutValues
  problems: Partial<Record<keyof DomainAboutValues, string>>
  disabled: boolean
  onChange: (values: DomainAboutValues) => void
}) {
  return (
    <>
      <Field name="summary" invalid={Boolean(problems.summary)} disabled={disabled}>
        <FieldHeader>
          <FieldLabel icon={TextQuoteIcon} optional>
            Summary
          </FieldLabel>
          <FieldDescription>
            One line on what the domain is. Lists and domain pickers show it under the name.
          </FieldDescription>
        </FieldHeader>
        <FieldControl
          value={values.summary}
          onValueChange={(next) => onChange({ ...values, summary: String(next) })}
          render={
            <Input
              id="area-summary"
              size="lg"
              autoComplete="off"
              placeholder="For example: Orders, returns and payment providers, by market."
            />
          }
        />
        <FieldFooter>
          <FieldError>{problems.summary}</FieldError>
          <FieldCounter count={[...values.summary].length} max={AREA_SUMMARY_MAX} />
        </FieldFooter>
      </Field>
      <Field name="description" invalid={Boolean(problems.description)} disabled={disabled}>
        <FieldHeader>
          <FieldLabel
            id="area-description-label"
            icon={AlignLeftIcon}
            optional
            onClick={() => document.getElementById('area-description')?.focus()}
          >
            Description
          </FieldLabel>
          <FieldDescription id="area-description-hint">
            What the domain is, what it holds and what it doesn&apos;t, and the words people use for
            its data: its main metrics and where they come from. People, the assistant and AI apps
            read it. Write an event, a note or a rule as a fact instead, so its owners check it, it
            has dates, and AI apps get it only where it applies. Bold, lists and links work. Never
            name a customer or a colleague.
          </FieldDescription>
        </FieldHeader>
        <BodyInput
          id="area-description"
          appearance="field"
          size="reading"
          mentions={false}
          labelledBy="area-description-label"
          describedBy={
            problems.description
              ? 'area-description-hint area-description-error'
              : 'area-description-hint'
          }
          placeholder="For example: Sales covers orders and returns, by market and payment provider. Discount cost isn't here. It's in Marketing."
          value={values.description}
          onChange={(next) => onChange({ ...values, description: next })}
          max={AREA_DESCRIPTION_MAX}
          count={(text) => [...text].length}
          invalid={Boolean(problems.description)}
          disabled={disabled}
        />
        <FieldError id="area-description-error">{problems.description}</FieldError>
      </Field>
    </>
  )
}

/** The domain's summary and description on its record, with Edit for those who write them. */
export function DomainAbout({ area }: { area: Area }) {
  const { canDescribe } = usePermissions()
  const [editing, setEditing] = useState(false)
  const allowed = canDescribe(area.id)
  const empty = !area.summary && !area.description
  return (
    <div data-slot="domain-about">
      <RecordSection
        title="About this domain"
        icon={InfoIcon}
        action={
          allowed ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <PencilLineIcon aria-hidden="true" />
              {empty ? 'Describe' : 'Edit'}
            </Button>
          ) : null
        }
      >
        {empty ? (
          <p className="text-body text-muted-foreground">
            {allowed
              ? 'Nobody has said what this domain is yet. Describe what it covers and what kind of data it holds, so people, the assistant and AI apps know what to find here.'
              : `Nobody has said what ${area.name} is yet. Its owners write it.`}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {area.summary ? <p className="text-reading font-bold">{area.summary}</p> : null}
            {area.description ? (
              <Markdown source={area.description} headingOffset={2} className="text-reading" />
            ) : null}
          </div>
        )}
      </RecordSection>
      {editing ? <DescribeDomainDialog area={area} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}

/** Writing what a domain is: its summary line and description, saved together. */
export function DescribeDomainDialog({ area, onClose }: { area: Area; onClose: () => void }) {
  const describe = useApiWrite('describeArea')
  const [values, setValues] = useState<DomainAboutValues>({
    summary: area.summary,
    description: area.description,
  })
  const [shown, setShown] = useState<Partial<Record<keyof DomainAboutValues, string>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const spinning = usePendingIndicator(busy)

  const change = (next: DomainAboutValues) => {
    setValues(next)
    // A field already marked wrong is checked again as it is corrected.
    if (shown.summary || shown.description) setShown(domainAboutProblems(next))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const problems = domainAboutProblems(values)
    setShown(problems)
    const first = (['summary', 'description'] as const).find((name) => problems[name])
    if (first) {
      document
        .querySelector<HTMLElement>(first === 'summary' ? '#area-summary' : '#area-description')
        ?.focus()
      return
    }
    setFailure(null)
    setBusy(true)
    try {
      await describe.mutateAsync({ id: area.id, revision: area.revision, ...domainAbout(values) })
      showToast(`${area.name} is saved`, 'The history log keeps what changed.')
      onClose()
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Try again.'
      setFailure(
        toApiError(error).kind === 'conflict'
          ? 'Someone changed this domain since you opened it. Close this and open it again to see their change.'
          : message,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
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
          aria-label={`Describe ${area.name}`}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 pointer-coarse:p-4">
            <DialogHeader>
              <DialogTitle>Describe {area.name}</DialogTitle>
              <DialogDescription>
                Say what the domain is, what it holds and what it doesn&apos;t. It shows at once
                here, in domain pickers, to the assistant and to AI apps. The history log keeps it.
              </DialogDescription>
            </DialogHeader>
            {failure ? (
              <Alert variant="danger" role="alert">
                <CircleAlertIcon aria-hidden />
                <AlertContent>
                  <AlertTitle>We couldn&apos;t save the description</AlertTitle>
                  <AlertDescription>{failure}</AlertDescription>
                </AlertContent>
              </Alert>
            ) : null}
            <FieldGroup>
              <DomainAboutFields
                values={values}
                problems={shown}
                disabled={busy}
                onChange={change}
              />
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
              <span className={spinning ? 'opacity-0' : undefined}>Save</span>
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
