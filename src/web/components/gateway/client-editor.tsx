import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Controller } from 'react-hook-form'
import type { ClientPolicy } from '@/api'
import { toolsQuery, useApiWrite } from '@/api/queries'
import { FormErrorSummary } from '@/components/form/form-error-summary'
import {
  BotIcon,
  CircleAlertIcon,
  FileTextIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  TagIcon,
  TimerIcon,
} from '@/components/icons'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { useZodForm } from '@/hooks/use-zod-form'
import { ERROR_SUMMARY_THRESHOLD, fieldControlId } from '@/lib/form-errors'
import {
  clientFormSchema,
  clientValues,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_RATE_PER_MINUTE,
  GATEWAY_REASON_MAX,
  newClientValues,
  orderTools,
  toolInfo,
  toolName,
  toSaveClientInput,
  type ClientFormValues,
} from '@/lib/gateway'
import { showToast } from '@/lib/toast'

/** The fields in the order they show, for the error summary and the first error's focus. */
const fieldOrder = [
  'displayName',
  'label',
  'enabled',
  'tools',
  'chosen',
  'ratePerMinute',
  'maxResponseBytes',
  'reason',
] as const satisfies readonly (keyof ClientFormValues)[]

const fieldLabels: Record<string, string> = {
  displayName: 'Name',
  label: 'Label',
  chosen: 'Tools',
  ratePerMinute: 'Requests a minute',
  maxResponseBytes: 'Largest answer',
  reason: 'Why',
}

/**
 * Adding a client, or changing one (FR-408): its name, the label its token carries (fixed once
 * added), whether it may connect, the tools it may call, its request rate and its largest answer,
 * and why. The service applies it at the client's next request. The form checks itself on blur,
 * then as it is corrected (contract 9.9); Save is never disabled for an incomplete form.
 */
export function ClientEditor({
  client,
  takenLabels,
  open,
  onOpenChange,
}: {
  /** The client to change; null to add one. */
  client: ClientPolicy | null
  /** Labels in use, which a new client may not take; null while they are not known. */
  takenLabels: readonly string[] | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isNew = client === null
  const tools = useQuery(toolsQuery())
  const save = useApiWrite('saveClient')
  const schema = useMemo(() => clientFormSchema({ isNew, takenLabels }), [isNew, takenLabels])
  const form = useZodForm(schema, {
    defaultValues: client ? clientValues(client) : newClientValues,
  })
  const [failure, setFailure] = useState<string | null>(null)
  const submitting = form.formState.isSubmitting
  const showSpinner = usePendingIndicator(submitting)
  const toolsMode = form.watch('tools')
  /*
    Every tool the gateway lists, and any the client names that it no longer lists. When the
    list cannot be read, the tools this page knows stand in, without saying which are on.
  */
  const listed: { tool: string; enabled: boolean | null }[] =
    tools.data ?? Object.keys(toolInfo).map((tool) => ({ tool, enabled: null }))
  const toolChoices = orderTools([
    ...listed,
    ...(client?.toolsAllowed ?? [])
      .filter((name) => !listed.some((tool) => tool.tool === name))
      .map((tool) => ({ tool, enabled: null, gone: true })),
  ])

  const submit = form.handleSubmit(
    async (values) => {
      setFailure(null)
      try {
        const saved = await save.mutateAsync(toSaveClientInput(values))
        showToast(
          isNew ? `${saved.displayName} added` : `${saved.displayName} saved`,
          saved.enabled
            ? 'It applies from the next call.'
            : 'It gets no answers while it is switched off.',
        )
        onOpenChange(false)
      } catch (error) {
        setFailure(error instanceof Error && error.message ? error.message : 'Try again.')
      }
    },
    (errors) => {
      const failed = fieldOrder.filter((name) => errors[name])
      if (failed.length > 0 && failed.length < ERROR_SUMMARY_THRESHOLD) form.setFocus(failed[0]!)
    },
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        aria-busy={submitting || undefined}
        className="flex max-h-drawer max-w-dialog-wide flex-col gap-0 overflow-hidden p-0"
      >
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="@container/editor flex min-h-0 flex-1 flex-col"
          aria-label={isNew ? 'Add an agent' : `Edit ${client.displayName}`}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 pointer-coarse:p-4">
            <DialogHeader>
              <DialogTitle>{isNew ? 'Add an agent' : `Edit ${client.displayName}`}</DialogTitle>
              <DialogDescription>
                {isNew
                  ? 'It gets answers once its access key carries this label.'
                  : 'Changes apply from its next call.'}
              </DialogDescription>
            </DialogHeader>
            {failure ? (
              <Alert variant="danger" role="alert">
                <CircleAlertIcon aria-hidden />
                <AlertContent>
                  <AlertTitle>The agent wasn&apos;t saved</AlertTitle>
                  <AlertDescription>{failure}</AlertDescription>
                </AlertContent>
              </Alert>
            ) : null}
            <FormErrorSummary control={form.control} order={fieldOrder} labels={fieldLabels} />

            <FieldGroup>
              <Controller
                control={form.control}
                name="displayName"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={BotIcon}>Name</FieldLabel>
                      <FieldDescription>How it shows on this page.</FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      value={field.value}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      render={
                        <Input
                          ref={field.ref}
                          id={fieldControlId('displayName')}
                          size="lg"
                          autoComplete="off"
                          placeholder="For example: Claude Code"
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
                  name="label"
                  render={({ field, fieldState }) => (
                    <Field
                      name={field.name}
                      invalid={Boolean(fieldState.error)}
                      touched={fieldState.isTouched}
                      disabled={submitting}
                    >
                      <FieldHeader>
                        <FieldLabel icon={TagIcon}>Label</FieldLabel>
                        <FieldDescription>
                          The name on its access key: lowercase letters, digits, dots, dashes or
                          underscores. You can&apos;t change it once the agent is added.
                        </FieldDescription>
                      </FieldHeader>
                      <FieldControl
                        value={field.value}
                        onValueChange={(next) => field.onChange(next)}
                        onBlur={field.onBlur}
                        render={
                          <Input
                            ref={field.ref}
                            id={fieldControlId('label')}
                            size="lg"
                            autoComplete="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            className="font-mono"
                            placeholder="claude-code"
                          />
                        }
                      />
                      <FieldError>{fieldState.error?.message}</FieldError>
                    </Field>
                  )}
                />
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="flex items-center gap-2 text-body font-bold heed-ink">
                    <TagIcon aria-hidden className="size-4 text-muted-foreground" />
                    Label
                  </p>
                  <p className="text-body">
                    <span className="font-mono" translate="no">
                      {client.label}
                    </span>
                    <span className="text-muted-foreground"> · fixed once an agent is added</span>
                  </p>
                </div>
              )}

              <Controller
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <Field name={field.name} disabled={submitting}>
                    <FieldItem>
                      <Checkbox
                        ref={field.ref}
                        id={fieldControlId('enabled')}
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked)}
                      />
                      <FieldItemContent>
                        <FieldLabel>Allowed to connect</FieldLabel>
                        <FieldDescription>
                          Switched off, it gets no answers. Its label stays, so its past calls still
                          read right.
                        </FieldDescription>
                      </FieldItemContent>
                    </FieldItem>
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="tools"
                render={({ field }) => (
                  <Field name={field.name} disabled={submitting}>
                    <FieldSet
                      render={
                        <RadioGroup
                          value={field.value}
                          onValueChange={(next) => field.onChange(next)}
                        />
                      }
                    >
                      <FieldLegend icon={ListChecksIcon}>Tools it may call</FieldLegend>
                      <FieldItem>
                        <RadioGroupItem value="all" id={fieldControlId('tools')} ref={field.ref} />
                        <FieldItemContent>
                          <FieldLabel>Every tool that is on</FieldLabel>
                          <FieldDescription>
                            A tool you switch on later reaches it too.
                          </FieldDescription>
                        </FieldItemContent>
                      </FieldItem>
                      <FieldItem>
                        <RadioGroupItem value="chosen" />
                        <FieldItemContent>
                          <FieldLabel>Only the tools chosen below</FieldLabel>
                        </FieldItemContent>
                      </FieldItem>
                    </FieldSet>
                  </Field>
                )}
              />

              {toolsMode === 'chosen' ? (
                <Controller
                  control={form.control}
                  name="chosen"
                  render={({ field, fieldState }) => (
                    <FieldSet
                      disabled={submitting}
                      data-invalid={fieldState.error ? '' : undefined}
                    >
                      <FieldLegend>Chosen tools</FieldLegend>
                      {tools.isPending ? (
                        <Skeleton
                          role="status"
                          aria-label="Loading the tools"
                          className="h-16 w-full"
                        />
                      ) : (
                        <div
                          id={fieldControlId('chosen')}
                          className="grid gap-x-6 gap-y-3 @lg/editor:grid-cols-2"
                        >
                          {toolChoices.map((tool, index) => (
                            <Field key={tool.tool} name={`chosen.${tool.tool}`}>
                              <FieldItem>
                                <Checkbox
                                  ref={index === 0 ? field.ref : undefined}
                                  checked={field.value.includes(tool.tool)}
                                  onCheckedChange={(checked) =>
                                    field.onChange(
                                      checked
                                        ? [...field.value, tool.tool]
                                        : field.value.filter((name) => name !== tool.tool),
                                    )
                                  }
                                />
                                <FieldItemContent>
                                  <FieldLabel>{toolName(tool.tool)}</FieldLabel>
                                  <FieldDescription>
                                    {'gone' in tool
                                      ? 'This tool is no longer listed.'
                                      : (toolInfo[tool.tool]?.about ?? tool.tool)}
                                    {tool.enabled === false ? ' Off for every agent now.' : ''}
                                  </FieldDescription>
                                </FieldItemContent>
                              </FieldItem>
                            </Field>
                          ))}
                        </div>
                      )}
                      {fieldState.error ? (
                        <Field invalid>
                          <FieldError>{fieldState.error.message}</FieldError>
                        </Field>
                      ) : null}
                    </FieldSet>
                  )}
                />
              ) : null}

              <Controller
                control={form.control}
                name="ratePerMinute"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={TimerIcon} optional>
                        Requests a minute
                      </FieldLabel>
                      <FieldDescription>
                        1 to 10,000. Leave it empty for the default of{' '}
                        {DEFAULT_RATE_PER_MINUTE.toLocaleString('en')}.
                      </FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      value={field.value}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      render={
                        <Input
                          ref={field.ref}
                          id={fieldControlId('ratePerMinute')}
                          size="lg"
                          inputMode="numeric"
                          autoComplete="off"
                          className="w-number-field tabular-nums"
                        />
                      }
                    />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="maxResponseBytes"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={FileTextIcon} optional>
                        Largest answer, in bytes
                      </FieldLabel>
                      <FieldDescription>
                        1,000 to 100,000. Leave it empty for the default of{' '}
                        {DEFAULT_MAX_RESPONSE_BYTES.toLocaleString('en')}.
                      </FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      value={field.value}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      render={
                        <Input
                          ref={field.ref}
                          id={fieldControlId('maxResponseBytes')}
                          size="lg"
                          inputMode="numeric"
                          autoComplete="off"
                          className="w-number-field tabular-nums"
                        />
                      }
                    />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="reason"
                render={({ field, fieldState }) => (
                  <Field
                    name={field.name}
                    invalid={Boolean(fieldState.error)}
                    touched={fieldState.isTouched}
                    disabled={submitting}
                  >
                    <FieldHeader>
                      <FieldLabel icon={MessageSquareIcon}>Why</FieldLabel>
                      <FieldDescription>Kept in the history log with the change.</FieldDescription>
                    </FieldHeader>
                    <FieldControl
                      // The id goes on the control, which the label names; on the textarea the
                      // label would point at an id nothing has.
                      id={fieldControlId('reason')}
                      value={field.value}
                      onValueChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      render={
                        <Textarea
                          ref={field.ref}
                          rows={3}
                          className="resize-y text-body pointer-coarse:text-large"
                        />
                      }
                    />
                    <FieldFooter>
                      <FieldError>{fieldState.error?.message}</FieldError>
                      <FieldCounter count={[...field.value].length} max={GATEWAY_REASON_MAX} />
                    </FieldFooter>
                  </Field>
                )}
              />
            </FieldGroup>
          </div>

          <DialogFooter className="border-t px-6 py-4 pointer-coarse:px-4">
            <DialogClose render={<Button variant="outline" size="lg" disabled={submitting} />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              size="lg"
              aria-disabled={submitting || undefined}
              // Keeps focus in the field on press: its blur check would show a message above
              // and move this button before the press ends, and the click would be lost.
              onMouseDown={(event) => event.preventDefault()}
              className="relative"
            >
              <span
                className={
                  showSpinner ? 'flex items-center gap-2 opacity-0' : 'flex items-center gap-2'
                }
              >
                {isNew ? 'Add agent' : 'Save changes'}
              </span>
              {showSpinner ? (
                <LoaderCircleIcon
                  aria-hidden
                  className="absolute inset-0 m-auto motion-safe:animate-spin"
                />
              ) : null}
            </Button>
          </DialogFooter>
          <p role="status" className="sr-only">
            {showSpinner ? 'Saving' : ''}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
