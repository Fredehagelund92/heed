import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Controller, type Control } from 'react-hook-form'
import type { Area } from '@domain/item'
import { describeApiError, toApiError, type LibraryItem, type TestQuestion } from '@/api'
import { libraryQuery, useApiWrite } from '@/api/queries'
import { FormErrorSummary } from '@/components/form/form-error-summary'
import {
  CircleAlertIcon,
  CircleSlashIcon,
  FileTextIcon,
  HeedDomainIcon,
  HeedRiskIcon,
  LinkIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  QuoteIcon,
  SplitIcon,
  TagIcon,
  TextQuoteIcon,
} from '@/components/icons'
import { KindIcon } from '@/components/item/item-marks'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldHeader,
  FieldItem,
  FieldItemContent,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { useZodForm } from '@/hooks/use-zod-form'
import { ERROR_SUMMARY_THRESHOLD, fieldControlId } from '@/lib/form-errors'
import {
  newQuestionValues,
  questionFormSchema,
  questionIdFrom,
  questionValues,
  toSaveQuestionInput,
  type QuestionFormValues,
} from '@/lib/question-form'
import { showToast } from '@/lib/toast'

const fieldOrder = [
  'area',
  'natural',
  'precise',
  'id',
  'mustDeliver',
  'mustNotDeliver',
  'caveat',
  'rubrics',
  'source',
] as const satisfies readonly (keyof QuestionFormValues)[]

const fieldLabels: Record<string, string> = {
  area: 'Domain',
  natural: 'As a person asks it',
  precise: 'Precisely',
  id: 'Short name',
  mustDeliver: 'Facts it must get',
  mustNotDeliver: 'Facts it must not get',
  caveat: 'What the answer must mention',
  rubrics: 'What else a good answer does',
  source: 'Where it comes from',
}

const splitWords = {
  development: 'Visible: used while improving the facts',
  held_out: 'Hidden: kept apart to check the targets',
} as const
const riskWords = { low: 'Low', normal: 'Normal', high: 'High' } as const

/** The service's own words for a refusal it explains; the general sentence for anything else. */
export function refusalText(error: unknown): string {
  const refusal = toApiError(error)
  return ['conflict', 'invalid', 'bad-request', 'forbidden', 'not-found', 'precondition'].includes(
    refusal.kind,
  ) && refusal.message
    ? refusal.message
    : describeApiError(error).description
}

/**
 * A new test question written from a gap (FR-610, Workbench plan V5): the gap's topic gives its
 * scope and month and where it comes from, never question text (FR-602, NFR-036), and it is linked
 * to the gap once added.
 */
export type QuestionFromGap = {
  id: string
  scope: TestQuestion['scope']
  /** The gap's topic in words, such as "Orders in Norway, October 2026". */
  about: string
}

export type QuestionDraft =
  | { mode: 'new'; area: string | undefined; itemId?: string; gap?: QuestionFromGap }
  | { mode: 'edit'; question: TestQuestion }

/**
 * Writing or changing a test question (FR-501): the domain, how a person asks it and the precise
 * wording, the items an answer must and must not get, what a good answer keeps, and where the
 * question comes from. The form checks itself on blur, then as it is corrected (contract 9.9).
 * A change is saved on the revision that was read: if someone else saved first, the service
 * refuses and says so. A question written from a gap keeps the gap's domain and scope, and is
 * linked to the gap once added.
 */
export function QuestionDialog({
  draft,
  areas,
  takenIds,
  onClose,
  onSaved,
}: {
  draft: QuestionDraft
  /** The domains the person writes test questions for. */
  areas: readonly Area[]
  takenIds: ReadonlySet<string>
  onClose: () => void
  onSaved: (question: TestQuestion) => void
}) {
  const isNew = draft.mode === 'new'
  const original = draft.mode === 'edit' ? draft.question : null
  const fromGap = draft.mode === 'new' ? draft.gap : undefined
  const schema = useMemo(() => questionFormSchema({ isNew, takenIds }), [isNew, takenIds])
  const form = useZodForm(schema, {
    defaultValues:
      draft.mode === 'edit'
        ? questionValues(draft.question)
        : {
            ...newQuestionValues(
              draft.area ?? (areas.length === 1 ? areas[0]!.id : ''),
              draft.itemId,
            ),
            ...(fromGap ? { source: `A gap: ${fromGap.about}` } : {}),
          },
  })
  const save = useApiWrite('saveTestQuestion')
  const link = useApiWrite('linkGapTest')
  const [failure, setFailure] = useState<string | null>(null)
  const submitting = form.formState.isSubmitting
  const showSpinner = usePendingIndicator(submitting)
  const [idTouched, setIdTouched] = useState(false)
  const area = form.watch('area')

  const submit = form.handleSubmit(
    async (values) => {
      setFailure(null)
      try {
        const saved = await save.mutateAsync(toSaveQuestionInput(values, original, fromGap?.scope))
        if (fromGap) {
          try {
            await link.mutateAsync({ id: fromGap.id, question: saved.id })
            showToast('The test question is added and linked to the gap', 'The next run tests it.')
          } catch (error) {
            showToast(
              'The test question is added, but not linked to the gap',
              `${refusalText(error)} Link it from the gap.`,
            )
          }
        } else
          showToast(
            isNew ? 'The test question is added' : 'The test question is saved',
            'The next run tests it.',
          )
        onSaved(saved)
      } catch (error) {
        setFailure(refusalText(error))
      }
    },
    (errors) => {
      const failed = fieldOrder.filter((name) => errors[name])
      if (failed.length > 0 && failed.length < ERROR_SUMMARY_THRESHOLD) form.setFocus(failed[0]!)
    },
  )

  const title = isNew ? 'Write a test question' : 'Edit the test question'
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !submitting) onClose()
      }}
    >
      <DialogContent
        aria-busy={submitting || undefined}
        className="flex max-h-drawer max-w-dialog-wide flex-col gap-0 overflow-hidden p-0"
      >
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex min-h-0 flex-1 flex-col"
          aria-label={title}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 pointer-coarse:p-4">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                A question agents should answer well. Weekly runs ask it in both wordings, then
                check the facts and the answer.
              </DialogDescription>
            </DialogHeader>
            {fromGap ? (
              <Alert data-slot="from-gap">
                <LinkIcon aria-hidden />
                <AlertContent>
                  <AlertTitle>Written from a gap: {fromGap.about}</AlertTitle>
                  <AlertDescription>
                    It takes the gap’s domain, topic and month, and is linked to the gap once added.
                    Write both wordings yourself, never a question someone asked.
                  </AlertDescription>
                </AlertContent>
              </Alert>
            ) : null}
            {failure ? (
              <Alert variant="danger" role="alert">
                <CircleAlertIcon aria-hidden />
                <AlertContent>
                  <AlertTitle>We couldn&apos;t save the test question</AlertTitle>
                  <AlertDescription>{failure}</AlertDescription>
                </AlertContent>
              </Alert>
            ) : null}
            <FormErrorSummary control={form.control} order={fieldOrder} labels={fieldLabels} />
            <FieldGroup>
              <Controller
                control={form.control}
                name="area"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    disabled={submitting || Boolean(fromGap)}
                  >
                    <FieldLabel icon={HeedDomainIcon}>Domain</FieldLabel>
                    <Select
                      disabled={submitting || Boolean(fromGap)}
                      value={field.value}
                      onValueChange={(value: string | null) => {
                        field.onChange(value ?? '')
                        // Items belong to a domain: a new domain starts the items again.
                        form.setValue('mustDeliver', [])
                        form.setValue('mustNotDeliver', [])
                      }}
                    >
                      <SelectTrigger
                        id={fieldControlId('area')}
                        ref={field.ref}
                        size="lg"
                        className="w-full"
                      >
                        <SelectValue>
                          {(value: string) =>
                            areas.find((candidate) => candidate.id === value)?.name ??
                            'Choose a domain'
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {areas.map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            <SelectItemText>{candidate.name}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="natural"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={QuoteIcon}>As a person asks it</FieldLabel>
                      <FieldDescription>
                        In everyday words, as someone would type it. Invent it: never paste a real
                        question someone asked.
                      </FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      id={fieldControlId('natural')}
                      value={field.value}
                      onValueChange={(next) => {
                        field.onChange(next)
                        if (isNew && !idTouched)
                          form.setValue('id', questionIdFrom(String(next)), {
                            shouldValidate: form.formState.submitCount > 0,
                          })
                      }}
                      onBlur={field.onBlur}
                      render={
                        <Textarea
                          ref={field.ref}
                          rows={2}
                          placeholder="Why did units sold in Norway drop in August?"
                        />
                      }
                    />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="precise"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={TextQuoteIcon}>Precisely</FieldLabel>
                      <FieldDescription>
                        The same question with the metric, the market and the dates spelled out.
                      </FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      id={fieldControlId('precise')}
                      value={field.value}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      render={
                        <Textarea
                          ref={field.ref}
                          rows={2}
                          placeholder="What explains the change in units sold for Norway between 1 and 31 August 2026?"
                        />
                      }
                    />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </Field>
                )}
              />
              {isNew ? (
                <Controller
                  control={form.control}
                  name="id"
                  render={({ field, fieldState }) => (
                    <Field
                      name={field.name}
                      invalid={Boolean(fieldState.error)}
                      touched={fieldState.isTouched}
                      disabled={submitting}
                    >
                      <FieldHeader>
                        <FieldLabel icon={TagIcon}>Short name</FieldLabel>
                        <FieldDescription>
                          Made from the question; change it if you like. It can&apos;t change once
                          the question is saved.
                        </FieldDescription>
                      </FieldHeader>
                      <FieldControl
                        value={field.value}
                        onValueChange={(next) => {
                          setIdTouched(true)
                          field.onChange(next)
                        }}
                        onBlur={field.onBlur}
                        render={
                          <Input
                            ref={field.ref}
                            id={fieldControlId('id')}
                            size="lg"
                            autoComplete="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            className="font-mono"
                          />
                        }
                      />
                      <FieldError>{fieldState.error?.message}</FieldError>
                    </Field>
                  )}
                />
              ) : null}
              <ItemsField
                control={form.control}
                name="mustDeliver"
                area={area}
                label="Facts it must get"
                hint="The facts an agent must get to answer well."
                icon={ListChecksIcon}
                disabled={submitting}
              />
              <ItemsField
                control={form.control}
                name="mustNotDeliver"
                area={area}
                label="Facts it must not get"
                hint="Facts that would mislead the answer, such as an issue that has ended."
                icon={CircleSlashIcon}
                disabled={submitting}
                optional
              />
              <Controller
                control={form.control}
                name="caveat"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={TextQuoteIcon} optional>
                        What the answer must mention
                      </FieldLabel>
                      <FieldDescription>
                        Every try must say it, so this is checked strictly.
                      </FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      value={field.value}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      render={<Input ref={field.ref} id={fieldControlId('caveat')} size="lg" />}
                    />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="noCauseClaim"
                render={({ field }) => (
                  <Field name={field.name} disabled={submitting}>
                    <FieldItem>
                      <Checkbox
                        ref={field.ref}
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked)}
                      />
                      <FieldItemContent>
                        <FieldLabel>The answer claims no cause</FieldLabel>
                        <FieldDescription>
                          It may say what changed, not why, unless a fact proves it.
                        </FieldDescription>
                      </FieldItemContent>
                    </FieldItem>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="clarifyingQuestion"
                render={({ field }) => (
                  <Field name={field.name} disabled={submitting}>
                    <FieldItem>
                      <Checkbox
                        ref={field.ref}
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked)}
                      />
                      <FieldItemContent>
                        <FieldLabel>The agent asks a clarifying question</FieldLabel>
                        <FieldDescription>
                          For a question too vague to answer as it stands.
                        </FieldDescription>
                      </FieldItemContent>
                    </FieldItem>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="rubrics"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={ListChecksIcon} optional>
                        What else a good answer does
                      </FieldLabel>
                      <FieldDescription>
                        One check a line, such as "Separates the provider switch from the trend". An
                        AI judge checks each one.
                      </FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      value={field.value}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      render={<Textarea ref={field.ref} id={fieldControlId('rubrics')} rows={3} />}
                    />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="split"
                render={({ field }) => (
                  <Field name={field.name} disabled={submitting}>
                    <FieldLabel icon={SplitIcon}>Set</FieldLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value: string | null) => field.onChange(value)}
                    >
                      <SelectTrigger ref={field.ref} size="lg" className="w-full">
                        <SelectValue>
                          {(value: keyof typeof splitWords) => splitWords[value]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(['development', 'held_out'] as const).map((split) => (
                          <SelectItem key={split} value={split}>
                            <SelectItemText>{splitWords[split]}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="risk"
                render={({ field }) => (
                  <Field name={field.name} disabled={submitting}>
                    <FieldLabel icon={HeedRiskIcon}>Risk</FieldLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value: string | null) => field.onChange(value)}
                    >
                      <SelectTrigger ref={field.ref} size="lg" className="w-full">
                        <SelectValue>
                          {(value: keyof typeof riskWords) => riskWords[value]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(['low', 'normal', 'high'] as const).map((risk) => (
                          <SelectItem key={risk} value={risk}>
                            <SelectItemText>{riskWords[risk]}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="source"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={FileTextIcon}>Where it comes from</FieldLabel>
                      <FieldDescription>
                        A team and a month, such as "Sales analysts, September 2026".
                      </FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      value={field.value}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      render={<Input ref={field.ref} id={fieldControlId('source')} size="lg" />}
                    />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </Field>
                )}
              />
            </FieldGroup>
          </div>
          <DialogFooter className="border-t px-6 py-4 pointer-coarse:px-4">
            <DialogClose render={<Button variant="outline" type="button" />} disabled={submitting}>
              Cancel
            </DialogClose>
            <Button type="submit" aria-disabled={submitting || undefined}>
              {showSpinner ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              {isNew ? 'Add the question' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The items of a domain the library serves, as chips: an answer must, or must not, get them. */
function ItemsField({
  control,
  name,
  area,
  label,
  hint,
  icon,
  disabled,
  optional = false,
}: {
  control: Control<QuestionFormValues>
  name: 'mustDeliver' | 'mustNotDeliver'
  area: string
  label: string
  hint: string
  icon: typeof ListChecksIcon
  disabled: boolean
  optional?: boolean
}) {
  const anchor = useComboboxAnchor()
  const { data: library } = useQuery(libraryQuery())
  const items = useMemo(
    () =>
      (library?.items ?? [])
        .filter((item) => item.areaId === area && item.status !== 'retired')
        .sort((a, b) => a.title.localeCompare(b.title, 'en')),
    [library, area],
  )
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const chosen = field.value.map(
          (id) => byId.get(id) ?? ({ id, title: id, kind: 'note' } as LibraryItem),
        )
        return (
          <Field name={field.name} invalid={Boolean(fieldState.error)} disabled={disabled}>
            <FieldHeader>
              <FieldLabel icon={icon} optional={optional}>
                {label}
              </FieldLabel>
              <FieldDescription>{hint}</FieldDescription>
            </FieldHeader>
            <Combobox
              multiple
              autoHighlight
              items={items}
              value={chosen}
              onValueChange={(next: LibraryItem[]) => field.onChange(next.map((item) => item.id))}
              itemToStringLabel={(item: LibraryItem) => item.title}
              isItemEqualToValue={(a: LibraryItem, b: LibraryItem) => a.id === b.id}
              limit={50}
              disabled={disabled}
            >
              <ComboboxChips ref={anchor} size="lg">
                <ComboboxValue>
                  {(values: LibraryItem[]) =>
                    values.map((item) => (
                      <ComboboxChip key={item.id} label={item.title}>
                        <KindIcon kind={item.kind} size="sm" decorative />
                        {item.title}
                      </ComboboxChip>
                    ))
                  }
                </ComboboxValue>
                <ComboboxChipsInput
                  id={fieldControlId(name)}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  placeholder={
                    area
                      ? chosen.length
                        ? ''
                        : 'Find a fact by its title'
                      : 'Choose a domain first'
                  }
                />
              </ComboboxChips>
              <ComboboxContent anchor={anchor}>
                <ComboboxEmpty>No fact of this domain has that title.</ComboboxEmpty>
                <ComboboxList>
                  {(item: LibraryItem) => (
                    <ComboboxItem key={item.id} value={item}>
                      <KindIcon kind={item.kind} size="sm" decorative />
                      <span className="truncate">{item.title}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <FieldError>{fieldState.error?.message}</FieldError>
          </Field>
        )
      }}
    />
  )
}
