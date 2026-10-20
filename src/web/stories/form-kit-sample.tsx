import { useState } from 'react'
import { Controller } from 'react-hook-form'
import * as z from 'zod/mini'
import { itemKinds, type ItemKind } from '@domain/item'
import { DateField } from '@/components/form/date-field'
import { FormErrorSummary } from '@/components/form/form-error-summary'
import { MarkdownField } from '@/components/form/markdown-field'
import { ValidityRange } from '@/components/form/validity-range'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxItemMeta,
  ComboboxLabel,
  ComboboxList,
  ComboboxStatus,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  AlignLeftIcon,
  HeedDomainIcon,
  HeedValidUntilIcon,
  LinkIcon,
  ScaleIcon,
  SendIcon,
  ShapesIcon,
  SigmaIcon,
  TagIcon,
  TargetIcon,
  FileTextIcon,
} from '@/components/icons'
import { useAutosave } from '@/hooks/use-autosave'
import { useZodForm } from '@/hooks/use-zod-form'
import { fieldControlId } from '@/lib/form-errors'
import { kindNames } from '@/lib/library'
import { areas, vocabulary } from '@/mocks/reference-data'

/**
 * The sample form of the form kit stories: every form part in a believable form. It validates
 * like the real ones (contract 9.9) and saves to nowhere after a short wait, so the save status
 * can be watched. It is a sample of the parts, not a screen: Add a fact is built on them
 * separately.
 */

export const kindLines: Record<ItemKind, string> = {
  event: 'Something that happened',
  note: 'A lasting remark',
  guide: 'How to investigate',
  example: 'A checked answer',
  issue: 'A temporary problem',
}

export type ScopeOption = { id: string; name: string; type: 'metric' | 'value'; count: number }

export const scopeGroups: { value: string; items: ScopeOption[] }[] = [
  {
    value: 'Metrics',
    items: vocabulary.metrics.slice(0, 8).map((metric, index) => ({
      id: `metric:${metric.id}`,
      name: metric.name,
      type: 'metric',
      count: 40 - index * 3,
    })),
  },
  {
    value: 'Markets',
    items: (vocabulary.dimensions[0]?.values ?? []).slice(0, 6).map((market, index) => ({
      id: `val:market/${market.id}`,
      name: market.name,
      type: 'value',
      count: 28 - index * 4,
    })),
  },
]

/** At most this many scope chips in the sample, to show the "max reached" state. */
export const SCOPE_MAX = 6

const sampleSchema = z.object({
  kind: z.enum(itemKinds),
  summary: z.string().check(
    z.trim(),
    z.minLength(1, 'Say what happened in a sentence or two.'),
    z.refine((value) => [...value].length <= 280, 'Shorten it to 280 characters.'),
  ),
  scope: z.array(z.string()).check(z.minLength(1, 'Add at least one metric or market.')),
  validity: z.object({
    start: z
      .nullable(z.string())
      .check(z.refine((value) => value !== null, 'Enter the first day it applies.')),
    end: z.nullable(z.string()),
  }),
  url: z
    .string()
    .check(
      z.refine(
        (value) => /^https?:\/\/\S+\.\S+/.test(value),
        'Add a link that starts with https://',
      ),
    ),
  quote: z
    .string()
    .check(z.refine((value) => [...value].length <= 500, 'Shorten the quote to 500 characters.')),
  readOn: z.nullable(z.string()),
  areaId: z.string().check(z.minLength(1, 'Choose the domain that reviews it.')),
  claim: z.enum(['fact_only', 'effect_stated']),
  notify: z.boolean(),
  body: z
    .string()
    .check(z.refine((value) => [...value].length <= 20000, 'Shorten it to 20,000 characters.')),
})

type SampleValues = z.input<typeof sampleSchema>

export const sampleOrder = [
  'kind',
  'summary',
  'scope',
  'validity',
  'url',
  'quote',
  'readOn',
  'areaId',
  'claim',
  'notify',
  'body',
] as const

const sampleLabels: Record<string, string> = {
  kind: 'Kind',
  summary: 'What happened',
  scope: 'Where it applies',
  validity: 'When it applies',
  url: 'Link',
  quote: 'Quote',
  readOn: 'Date you read it',
  areaId: 'Domain',
  claim: 'What the source says',
  body: 'Longer explanation',
}

export const emptySample: SampleValues = {
  kind: 'event',
  summary: '',
  scope: [],
  validity: { start: null, end: null },
  url: '',
  quote: '',
  readOn: null,
  areaId: '',
  claim: 'fact_only',
  notify: true,
  body: '',
}

/**
 * The sample form's state and its autosave, which saves to nowhere after `saveDelayMs`. A story
 * shows the autosave above the form and passes the form to `FormKitSample`.
 */
export function useFormKitSample(initial: SampleValues = emptySample, saveDelayMs = 400) {
  const form = useZodForm(sampleSchema, { defaultValues: initial })
  const autosave = useAutosave({
    value: form.watch(),
    save: () => new Promise((resolve) => window.setTimeout(resolve, saveDelayMs)),
  })
  return { form, autosave }
}

/** The sample form, every part in use. */
export function FormKitSample({ form }: { form: ReturnType<typeof useFormKitSample>['form'] }) {
  const [submitted, setSubmitted] = useState(false)
  const kind = form.watch('kind')
  const anchor = useComboboxAnchor()

  return (
    <form
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(event) =>
        void form.handleSubmit(
          () => setSubmitted(true),
          () => setSubmitted(false),
        )(event)
      }
    >
      <FormErrorSummary control={form.control} order={sampleOrder} labels={sampleLabels} />

      <FieldGroup>
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <Field name={field.name}>
              <FieldHeader>
                <FieldLabel icon={ShapesIcon}>What kind is it?</FieldLabel>
                <FieldDescription>Pick the closest. An owner can change it.</FieldDescription>
              </FieldHeader>
              <Select
                value={field.value}
                onValueChange={(next) => field.onChange(next)}
                items={itemKinds.map((value) => ({ value, label: kindNames[value] }))}
              >
                <SelectTrigger size="lg" id={fieldControlId('kind')} className="max-w-popover">
                  <SelectValue>
                    {(value: ItemKind) => (
                      <>
                        <KindIcon kind={value} decorative />
                        <span className="font-bold">{kindNames[value]}</span>
                        <span className="truncate text-muted-foreground">{kindLines[value]}</span>
                      </>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {itemKinds.map((value) => (
                    <SelectItem key={value} value={value} className="items-start py-2">
                      <KindIcon kind={value} decorative />
                      <span className="flex min-w-0 flex-col">
                        <SelectItemText className="font-bold">{kindNames[value]}</SelectItemText>
                        <span className="text-caption text-muted-foreground">
                          {kindLines[value]}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="summary"
          render={({ field, fieldState }) => (
            <Field
              name={field.name}
              invalid={Boolean(fieldState.error)}
              touched={fieldState.isTouched}
            >
              <FieldHeader>
                <FieldLabel icon={AlignLeftIcon}>What happened</FieldLabel>
                <FieldDescription>One or two sentences, in plain words.</FieldDescription>
              </FieldHeader>
              <FieldControl
                value={field.value}
                onValueChange={(next) => field.onChange(next)}
                onBlur={field.onBlur}
                render={
                  <Textarea
                    ref={field.ref}
                    id={fieldControlId('summary')}
                    rows={2}
                    placeholder="For example: online sales to Norway stopped on 4 August 2026."
                  />
                }
              />
              <FieldFooter>
                <FieldError>{fieldState.error?.message}</FieldError>
                <FieldCounter count={[...field.value].length} max={280} />
              </FieldFooter>
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="scope"
          render={({ field, fieldState }) => {
            const full = field.value.length >= SCOPE_MAX
            const chosen = scopeGroups
              .flatMap((group) => group.items)
              .filter((option) => field.value.includes(option.id))
            return (
              <Field name={field.name} invalid={Boolean(fieldState.error)}>
                <FieldHeader>
                  <FieldLabel icon={TargetIcon}>Where it applies</FieldLabel>
                  <FieldDescription>
                    Agents use this to decide when to show it. Other names for a value work too.
                  </FieldDescription>
                </FieldHeader>
                <Combobox
                  multiple
                  autoHighlight
                  items={scopeGroups}
                  value={chosen}
                  onValueChange={(next: ScopeOption[]) =>
                    field.onChange(next.map((option) => option.id))
                  }
                  itemToStringLabel={(option: ScopeOption) => option.name}
                  isItemEqualToValue={(a: ScopeOption, b: ScopeOption) => a.id === b.id}
                >
                  <ComboboxChips ref={anchor} size="lg">
                    <ComboboxValue>
                      {(options: ScopeOption[]) =>
                        options.map((option) => (
                          <ComboboxChip key={option.id} label={option.name}>
                            {option.type === 'metric' ? (
                              <SigmaIcon aria-hidden className="text-muted-foreground" />
                            ) : (
                              <TagIcon aria-hidden className="text-muted-foreground" />
                            )}
                            {option.name}
                          </ComboboxChip>
                        ))
                      }
                    </ComboboxValue>
                    <ComboboxChipsInput
                      id={fieldControlId('scope')}
                      onBlur={field.onBlur}
                      placeholder={field.value.length ? '' : 'Add a metric, market or product'}
                    />
                  </ComboboxChips>
                  <ComboboxContent anchor={anchor}>
                    <ComboboxStatus>
                      {full
                        ? `You have added ${SCOPE_MAX}, the most it takes. Remove one to add another.`
                        : null}
                    </ComboboxStatus>
                    <ComboboxEmpty>No match. An owner can add it to the vocabulary.</ComboboxEmpty>
                    <ComboboxList>
                      {(group: (typeof scopeGroups)[number]) => (
                        <ComboboxGroup key={group.value} items={group.items}>
                          <ComboboxLabel>{group.value}</ComboboxLabel>
                          <ComboboxCollection>
                            {(option: ScopeOption) => (
                              <ComboboxItem
                                key={option.id}
                                value={option}
                                disabled={full && !field.value.includes(option.id)}
                              >
                                {option.type === 'metric' ? (
                                  <SigmaIcon aria-hidden className="text-muted-foreground" />
                                ) : (
                                  <TagIcon aria-hidden className="text-muted-foreground" />
                                )}
                                <span className="truncate">{option.name}</span>
                                <ComboboxItemMeta>{option.count} items</ComboboxItemMeta>
                              </ComboboxItem>
                            )}
                          </ComboboxCollection>
                        </ComboboxGroup>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                <FieldError>{fieldState.error?.message}</FieldError>
              </Field>
            )
          }}
        />

        <FieldSet>
          <FieldHeader>
            <FieldLegend icon={HeedValidUntilIcon}>When it applies</FieldLegend>
            <FieldDescription>
              The last day is included. Leave it open if you do not know when it ends.
            </FieldDescription>
          </FieldHeader>
          <Controller
            control={form.control}
            name="validity"
            render={({ field, fieldState }) => (
              <ValidityRange
                kind={kind === 'issue' ? 'issue' : 'standing'}
                value={field.value}
                onValueChange={(next) => field.onChange(next)}
                errors={{
                  start: (fieldState.error as { start?: { message?: string } } | undefined)?.start
                    ?.message,
                }}
              />
            )}
          />
        </FieldSet>

        <FieldSet>
          <FieldHeader>
            <FieldLegend icon={LinkIcon}>Where this comes from</FieldLegend>
            <FieldDescription>
              A link to where you read it and a sentence copied from it.
            </FieldDescription>
          </FieldHeader>
          <Controller
            control={form.control}
            name="url"
            render={({ field, fieldState }) => (
              <Field name={field.name} invalid={Boolean(fieldState.error)}>
                <FieldLabel>Link</FieldLabel>
                <Input
                  {...field}
                  id={fieldControlId('url')}
                  size="lg"
                  type="url"
                  inputMode="url"
                  placeholder="https://www.customs.example/notices/2026-08"
                />
                <FieldError>{fieldState.error?.message}</FieldError>
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="quote"
            render={({ field, fieldState }) => (
              <Field name={field.name} invalid={Boolean(fieldState.error)}>
                <FieldLabel optional>Quote</FieldLabel>
                <FieldControl
                  value={field.value}
                  onValueChange={(next) => field.onChange(next)}
                  onBlur={field.onBlur}
                  render={<Textarea ref={field.ref} id={fieldControlId('quote')} rows={2} />}
                />
                <FieldFooter>
                  <FieldError>{fieldState.error?.message}</FieldError>
                  <FieldCounter count={[...field.value].length} max={500} />
                </FieldFooter>
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="readOn"
            render={({ field }) => (
              <Field name={field.name} className="max-w-popover">
                <FieldLabel optional>Date you read it</FieldLabel>
                <DateField value={field.value} onValueChange={field.onChange} />
              </Field>
            )}
          />
        </FieldSet>

        <Controller
          control={form.control}
          name="areaId"
          render={({ field, fieldState }) => {
            const area = areas.find((candidate) => candidate.id === field.value)
            return (
              <Field name={field.name} invalid={Boolean(fieldState.error)}>
                <FieldHeader>
                  <FieldLabel icon={HeedDomainIcon}>Domain</FieldLabel>
                  <FieldDescription>The owner of this domain reviews it.</FieldDescription>
                </FieldHeader>
                <Select
                  value={field.value || null}
                  onValueChange={(next) => field.onChange(next ?? '')}
                  items={areas.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                >
                  <SelectTrigger
                    size="lg"
                    id={fieldControlId('areaId')}
                    onBlur={field.onBlur}
                    className="max-w-popover"
                  >
                    <SelectValue placeholder="Choose a domain">
                      {area ? <DomainBadge name={area.name} label={area.label} /> : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        <SelectItemText>
                          <DomainBadge name={candidate.name} label={candidate.label} form="bare" />
                        </SelectItemText>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{fieldState.error?.message}</FieldError>
              </Field>
            )
          }}
        />

        <Controller
          control={form.control}
          name="claim"
          render={({ field }) => (
            <Field name={field.name}>
              <FieldSet render={<RadioGroup value={field.value} onValueChange={field.onChange} />}>
                <FieldLegend icon={ScaleIcon}>What the source says</FieldLegend>
                <FieldItem>
                  <RadioGroupItem value="fact_only" />
                  <FieldItemContent>
                    <FieldLabel>A fact only</FieldLabel>
                    <FieldDescription>
                      An agent says it might be related, never that it caused a change.
                    </FieldDescription>
                  </FieldItemContent>
                </FieldItem>
                <FieldItem>
                  <RadioGroupItem value="effect_stated" />
                  <FieldItemContent>
                    <FieldLabel>A named authority states the effect</FieldLabel>
                    <FieldDescription>Quote the sentence that states it.</FieldDescription>
                  </FieldItemContent>
                </FieldItem>
              </FieldSet>
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="notify"
          render={({ field }) => (
            <Field name={field.name}>
              <FieldItem>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
                <FieldItemContent>
                  <FieldLabel>Tell me when an owner decides</FieldLabel>
                </FieldItemContent>
              </FieldItem>
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="body"
          render={({ field, fieldState }) => (
            <Field name={field.name} invalid={Boolean(fieldState.error)}>
              <FieldHeader>
                <FieldLabel icon={FileTextIcon} optional>
                  Longer explanation
                </FieldLabel>
                <FieldDescription>
                  Markdown works: headings, lists, links and quotes.
                </FieldDescription>
              </FieldHeader>
              <MarkdownField
                value={field.value}
                onValueChange={field.onChange}
                max={20000}
                error={fieldState.error?.message}
              />
            </Field>
          )}
        />
      </FieldGroup>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg">
          <SendIcon aria-hidden />
          Send for review
        </Button>
        {submitted && (
          <p role="status" className="text-body text-muted-foreground">
            Everything is in order. In the app this sends it to the owner.
          </p>
        )}
      </div>
    </form>
  )
}
