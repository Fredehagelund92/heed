import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toNestErrors } from '@hookform/resolvers'
import type { Area, ContextItem, ItemKind } from '@domain/item'
import { limits } from '@domain/proposal-rules'
import { toApiError, type Catalogue, type ProposalRecord } from '@/api'
import { peopleQuery, proposalQuery, useApiWrite } from '@/api/queries'
import { AssistantMenuItem } from '@/components/app-shell/assistant-menu-item'
import { HeaderActions } from '@/components/app-shell/header-actions'
import { useMainAction } from '@/components/app-shell/command-scope'
import { BodyInput } from '@/components/editor/body-input'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import { HelpLink } from '@/components/help/help-link'
import { Page, PageDocument, PagePhoneActions } from '@/components/page/page'
import { PageRail, RailSection } from '@/components/page/page-rail'
import { FormErrorSummary } from '@/components/form/form-error-summary'
import { SaveStatus } from '@/components/form/save-status'
import { ValidityRange } from '@/components/form/validity-range'
import { SummaryInput } from '@/components/mentions/summary-input'
import { ScopeInput } from '@/components/mentions/scope-input'
import {
  Field,
  FieldControl,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldFooter,
  FieldLabel,
} from '@/components/ui/field'
import { BlockedButton } from '@/components/ui/blocked-button'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CircleAlertIcon,
  CircleSlashIcon,
  EllipsisIcon,
  EyeIcon,
  HeedDomainIcon,
  HeedValidUntilIcon,
  InfoIcon,
  LinkIcon,
  SendIcon,
  TargetIcon,
  Trash2Icon,
} from '@/components/icons'
import { useAutosaveDraft } from '@/hooks/use-autosave-draft'
import { readAutosaveBackup } from '@/hooks/use-autosave'
import {
  contextFormFindings,
  contextFormSchema,
  contextTextFindings,
  findingField,
  formValues,
  followedDomain,
  inferredDomain,
  metricsWithoutDomain,
  noDomainHint,
  parseFormBackup,
  scopeMetrics,
  titleFromSummary,
  withEvidence,
  withMetric,
  withScope,
  type ContextFormValues,
} from '@/lib/context-form'
import { caveatWords, sourceWords } from '@/lib/context-help'
import { plainFinding, textCheckMessages, textCheckShort } from '@/lib/text-check'
import { refusedTextMessage } from '@/lib/proposals'
import { usePermissions } from '@/lib/use-session'
import { showToast } from '@/lib/toast'
import { monthText } from '@/lib/gaps'
import { AttachedTests } from '@/components/proposal/attached-tests'
import { DraftProvenanceNotice } from '@/components/proposal/provenance-notes'
import { CaveatField } from './caveat-field'
import { AgentView, DraftChecks } from './context-companion'
import { CHANGE_NOTE_MAX, ChangesRequested } from './changes-requested'
import {
  CaptureHelp,
  DomainChip,
  EvidenceFields,
  KindChip,
  NeededBadge,
  ValidityChip,
  WhyWeAsk,
} from './context-fields'

const idFor = (field: string) => `context-${field}`
const labels = {
  reason: 'What is wrong',
  areaId: 'Domain',
  title: 'Title',
  summaryMarkup: 'Summary',
  bodyMarkup: 'Body',
  scope: 'Where it applies',
  validity: 'When it applies',
  evidence: sourceWords.title,
  notToConclude: caveatWords.title,
}
/** The fields that live in the Details tab: an error there opens it. */
const detailFields = ['scope', 'validity', 'evidence', 'notToConclude']

/** What the summary asks for, by kind: one editor, a prompt for each kind (the editor design, 3). */
const summaryPrompts: Record<ItemKind, string> = {
  event: 'What happened, and when?',
  note: 'What should people keep in mind when they read this number?',
  guide: 'When does this guide help?',
  example: 'What was asked, and what is the right answer?',
  issue: 'What is wrong, and since when?',
}
const bodyPrompt = 'Add detail, steps or examples. Type / for blocks and @ to mention a metric.'

/** Who looks at a proposal once it is sent: "Jon Abara, who owns Commercial, will look at it." */
function reviewerSentence(
  areas: readonly Area[],
  people: readonly { id: string; name: string }[] | undefined,
  areaId: string,
): string {
  const area = areas.find((candidate) => candidate.id === areaId)
  const owner = area?.ownerIds[0]
    ? people?.find((person) => person.id === area.ownerIds[0])
    : undefined
  if (area && owner) return `${owner.name}, who owns ${area.name}, will look at it.`
  return area ? `The owner of ${area.name} will look at it.` : 'The owner will look at it.'
}

/** Puts the caret at the start or the end of a text field or an editor, and focuses it. */
function focusField(id: string, edge: 'start' | 'end') {
  const element = document.getElementById(id)
  if (!element) return
  element.focus()
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const at = edge === 'start' ? 0 : element.value.length
    element.setSelectionRange(at, at)
    return
  }
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(edge === 'start')
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * Add context and Suggest a change (the editor design, direction A, "the Page"): one editor for
 * every kind, laid out as the item page reads. Kind, domain and validity are chips above the
 * title; the summary (at most 280 characters, what agents read first) and the body are two
 * zones of one document; where, when, where it comes from and what not to conclude sit in a 320
 * pixel rail with the agent's view beside them. Command or Control Enter submits.
 */
export function ContextForm({
  areas,
  catalogue,
  source,
  personId,
  asked,
  metric,
  about,
  from,
  evidence,
  onCreated,
}: {
  areas: Area[]
  catalogue?: Catalogue
  source?: ContextItem | ProposalRecord
  personId: string
  /** The month people asked about, YYYY-MM, when the draft started from a gap. */
  asked?: string
  /** A new draft about this metric (a vocabulary id): it starts in the scope. */
  metric?: string
  /** A new draft about the scope Try it asked about: its keys start in the scope. */
  about?: readonly string[]
  /** ...and its first day, as the day the fact starts. */
  from?: string
  /** A new draft from a capture link: the page and the sentence selected on it, as its source. */
  evidence?: { url?: string; quote?: string }
  onCreated: (proposal: ProposalRecord) => void
}) {
  const initialProposal = source && 'draft' in source ? source : undefined
  const item = source && !('draft' in source) ? source : undefined
  const itemId = item?.id ?? initialProposal?.itemId ?? undefined
  // Only a new draft starts from a metric, a scope or a captured source; a draft or an item
  // keeps its own.
  const startWith = (values: ContextFormValues) =>
    source
      ? values
      : withEvidence(
          withScope(withMetric(values, metric), about, from),
          evidence?.url,
          evidence?.quote,
        )
  /**
   * The domain the chosen metrics give, when the person has not chosen one: part of where the
   * form starts, so opening a draft about a metric saves nothing until the person writes.
   */
  const withFollowed = (values: ContextFormValues) => {
    const next = followedDomain(
      Boolean(values.areaId),
      catalogue,
      inferredDomain(values.scope, catalogue),
    )
    return next ? { ...values, areaId: next } : values
  }
  const [initial] = useState(() => withFollowed(startWith(formValues(source))))
  const backupKey = `heed.context.${personId}.${initialProposal?.id ?? itemId ?? 'new'}`
  const [started] = useState(() => {
    const backup = parseFormBackup(readAutosaveBackup(backupKey))
    return backup.success ? startWith(backup.data) : startWith(formValues(source))
  })
  const [restored] = useState(() => withFollowed(started))
  const form = useForm<ContextFormValues>({
    defaultValues: restored,
    mode: 'onBlur',
    reValidateMode: 'onChange',
    resolver: async (values, context, options) => {
      const parsed = await zodResolver(contextFormSchema)(values, context, options)
      if (Object.keys(parsed.errors).length) return parsed
      const findings = contextFormFindings(values)
      return findings.length
        ? {
            values: {},
            errors: toNestErrors(
              Object.fromEntries(
                findings.map((finding) => [
                  findingField(finding.field),
                  { type: finding.code, message: finding.message },
                ]),
              ),
              options,
            ),
          }
        : { values, errors: {} }
    },
  })
  const values = useWatch({ control: form.control }) as ContextFormValues
  const formRef = useRef<HTMLFormElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const [tab, setTab] = useState<'details' | 'agent'>('details')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discarded, setDiscarded] = useState(false)
  const submitted = useRef(false)
  const [choseDomain, setChoseDomain] = useState(Boolean(started.areaId))
  const inferred = inferredDomain(values.scope, catalogue)
  const metricNames = scopeMetrics(values.scope, catalogue).map((term) => term.name)
  const domainless = metricsWithoutDomain(values.scope, catalogue)
  const { isAdmin } = usePermissions()
  const people = useQuery(peopleQuery()).data
  useEffect(() => {
    const next = followedDomain(choseDomain, catalogue, inferred)
    // A Submit refused before the metric's domain was known shows the error until the domain
    // is filled in, then checks again, so the error never stays beside the domain it asked for.
    if (next !== undefined)
      form.setValue('areaId', next, { shouldValidate: form.formState.isSubmitted })
  }, [inferred, form, choseDomain, catalogue])
  const autosave = useAutosaveDraft({
    value: values,
    initialValue: initial,
    initialProposal,
    itemId,
    backupKey,
    onCreated,
    enabled: !submitting && !discarded,
  })
  const submit = useApiWrite('submitProposal')
  const comment = useApiWrite('commentOnProposal')
  const [changeNote, setChangeNote] = useState('')
  const [changeNoteError, setChangeNoteError] = useState<string | null>(null)
  const discard = useApiWrite('discardDraft')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      !submitted.current && autosave.unsaved && current.pathname !== next.pathname,
    enableBeforeUnload: () => !submitted.current && autosave.unsaved,
    withResolver: true,
  })
  // The text check runs as the person types (FR-117): it holds the save and blocks Submit.
  const sensitive = useMemo(() => contextTextFindings(values), [values])
  const found = sensitive[0]
  const held = found
    ? `${textCheckShort[found.code] ?? 'Something private'} is in the text. Remove it to save and see what agents get.`
    : undefined
  useMainAction(
    useMemo(() => ({ title: 'Send for review', run: () => formRef.current?.requestSubmit() }), []),
  )
  const error = (field: string) =>
    form.getFieldState(field as FieldPath<ContextFormValues>, form.formState).error?.message
  /** An editor shows its own text check under the words, so the field does not repeat it. */
  const textError = (field: 'summaryMarkup' | 'bodyMarkup') => {
    const state = form.getFieldState(field, form.formState).error
    return state?.type && textCheckMessages[state.type] ? undefined : state?.message
  }
  const set = <K extends keyof ContextFormValues>(field: K, value: ContextFormValues[K]) => {
    form.setValue(field, value as never, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted || Boolean(error(field)),
    })
  }
  const blur = (field: string) => {
    void form.trigger(field as FieldPath<ContextFormValues>)
  }
  const showDetails = (then?: () => void) => {
    setTab('details')
    requestAnimationFrame(() => then?.())
  }
  const onSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const saved = await autosave.saveNow()
      let revision = saved.revision
      // What the person changed goes to the owner as a reply, before the resubmission.
      const note = changeNote.trim()
      if (note && saved.state === 'changes_requested') {
        if ([...note].length > CHANGE_NOTE_MAX) {
          setChangeNoteError(`Keep it to ${CHANGE_NOTE_MAX.toLocaleString('en')} characters.`)
          return
        }
        try {
          revision = (await comment.mutateAsync({ id: saved.id, revision, text: note })).revision
        } catch (error) {
          const failure = toApiError(error)
          setChangeNoteError(
            refusedTextMessage(failure.findings) ??
              (failure.kind === 'invalid'
                ? 'Write plain text, without @ mentions.'
                : "We couldn't send your note. Try again."),
          )
          return
        }
        // Sent: a retry of the resubmission does not send it twice.
        setChangeNote('')
      }
      const result = await submit.mutateAsync({ id: saved.id, revision })
      submitted.current = true
      try {
        localStorage.removeItem(backupKey)
      } catch {
        /* The server already holds the submitted version. */
      }
      showToast('Sent for review', reviewerSentence(areas, people, values.areaId))
      await navigate({ to: '/proposals/$proposalId', params: { proposalId: result.id } })
    } catch (error) {
      const failure = toApiError(error)
      setSubmitError(failure.message)
      for (const finding of failure.findings.map(plainFinding))
        form.setError(findingField(finding.field) as FieldPath<ContextFormValues>, {
          type: finding.code,
          message: finding.message,
        })
    } finally {
      setSubmitting(false)
    }
  }
  const onInvalid = (errors: FieldErrors<ContextFormValues>) => {
    if (Object.keys(errors).some((field) => detailFields.includes(field))) setTab('details')
  }
  // A draft that was never sent can be thrown away (proposals.discard); a sent one is withdrawn
  // from its status page instead.
  const draft = autosave.proposal?.state === 'draft' ? autosave.proposal : undefined
  const onDiscard = async () => {
    if (!draft) return
    setDiscarded(true)
    try {
      try {
        await discard.mutateAsync({ id: draft.id, revision: draft.revision })
      } catch (error) {
        const failure = toApiError(error)
        if (failure.kind !== 'conflict') throw error
        // An autosave moved the revision on while the dialog was open.
        const fresh =
          failure.current ??
          (await queryClient.fetchQuery({ ...proposalQuery(draft.id), staleTime: 0 }))
        if (!fresh || fresh.state !== 'draft') throw error
        await discard.mutateAsync({ id: fresh.id, revision: fresh.revision })
      }
    } catch (error) {
      setDiscarded(false)
      throw new Error(toApiError(error).message || "We couldn't discard the draft.", {
        cause: error,
      })
    }
    submitted.current = true
    try {
      localStorage.removeItem(backupKey)
      localStorage.removeItem(`heed.context.${personId}.${draft.id}`)
    } catch {
      /* Storage may be unavailable; there is then no copy to forget. */
    }
    showToast('Draft discarded')
    await navigate({ to: '/proposals' })
  }
  const discardMenu = draft ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" aria-label="More draft actions" />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setDiscardOpen(true)}>
          <Trash2Icon />
          Discard draft
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null
  const action = found ? (
    <BlockedButton variant="default" reason={held} title="Can't send yet">
      <SendIcon />
      Send for review
    </BlockedButton>
  ) : (
    <Button type="submit" form="context-form" disabled={submitting}>
      <SendIcon />
      {submitting ? 'Sending...' : 'Send for review'}
    </Button>
  )
  const status = (
    <SaveStatus
      {...autosave}
      onRetry={autosave.retry}
      held={found ? 'Not saved. Fix the text first' : undefined}
    />
  )
  // What to check before sending, when an agent or the assistant wrote the draft (FR-121, FR-707).
  const provenance = autosave.proposal?.provenance ?? initialProposal?.provenance ?? null
  const area = areas.find((area) => area.id === values.areaId)
  const owner = area?.ownerIds[0] ? people?.find((person) => person.id === area.ownerIds[0]) : null
  // A contributor never sets the claim level: a draft keeps its own, a change keeps the item's.
  const claimLevel =
    autosave.proposal?.draft.claimLevel ??
    initialProposal?.draft.claimLevel ??
    item?.claimLevel ??
    'fact_only'
  const scopeEmpty = !values.scope.metrics.length && !values.scope.dimensionValues.length
  const evidenceEmpty = values.evidence.some(
    (entry) => !entry.url.trim() || !entry.quote.trim() || !entry.date,
  )
  return (
    <Page title={itemId ? 'Suggest a change' : 'Add a fact'}>
      <HeaderActions>
        {status}
        {discardMenu}
        {action}
      </HeaderActions>
      <PageDocument className="@6xl:justify-between">
        <form
          id="context-form"
          ref={formRef}
          noValidate
          onSubmit={(event) => void form.handleSubmit(onSubmit, onInvalid)(event)}
          className="flex w-full max-w-reading min-w-0 flex-col gap-6"
        >
          {item ? (
            <details className="rounded-md border p-4">
              <summary className="cursor-pointer text-body font-bold">
                Current version: {item.title}
              </summary>
              <p className="py-3 text-body">{item.summary}</p>
              <p className="text-caption text-muted-foreground">
                Your changes become a proposal. Agents keep getting the current version until the
                owner accepts it.
              </p>
            </details>
          ) : null}
          {itemId ? (
            <Field invalid={Boolean(error('reason'))} disabled={submitting}>
              <FieldLabel optional htmlFor={idFor('reason')}>
                What is wrong with the current version?
              </FieldLabel>
              <FieldDescription>The owner reads it above your changes.</FieldDescription>
              <FieldControl
                value={values.reason}
                onValueChange={(next) => set('reason', String(next))}
                onBlur={() => blur('reason')}
                render={
                  <Textarea
                    id={idFor('reason')}
                    rows={2}
                    className="resize-y text-body pointer-coarse:text-large"
                  />
                }
              />
              <FieldFooter>
                <FieldError>{error('reason')}</FieldError>
                <FieldCounter count={values.reason.length} max={limits.changeReason} />
              </FieldFooter>
            </Field>
          ) : null}
          <FormErrorSummary
            control={form.control}
            order={Object.keys(labels)}
            labels={labels}
            idFor={idFor}
          />
          {initialProposal?.state === 'changes_requested' ? (
            <ChangesRequested
              proposal={initialProposal}
              note={changeNote}
              onNoteChange={(next) => {
                setChangeNote(next)
                setChangeNoteError(null)
              }}
              error={changeNoteError}
              disabled={submitting}
            />
          ) : null}
          {provenance ? <DraftProvenanceNotice provenance={provenance} /> : null}
          {submitError ? (
            <p role="alert" className="text-body text-status-danger-fg">
              {submitError}
            </p>
          ) : null}
          {autosave.error && !found ? (
            <p role="alert" className="text-body text-status-danger-fg">
              {toApiError(autosave.error).message}
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
            <div
              role="group"
              aria-label="Kind, domain and dates"
              className="flex flex-wrap items-center gap-2"
            >
              <KindChip
                value={values.kind}
                onChange={(kind) => {
                  set('kind', kind)
                  if (kind === 'issue') set('ended', values.validity.end != null)
                }}
                disabled={submitting || Boolean(itemId)}
              />
              <DomainChip
                value={values.areaId}
                areas={areas}
                invalid={Boolean(error('areaId'))}
                onChange={(value) => {
                  setChoseDomain(true)
                  set('areaId', value)
                }}
                disabled={submitting}
              />
              <span aria-hidden="true" className="hidden h-4 w-px bg-border @md:block" />
              <ValidityChip
                kind={values.kind}
                validity={values.validity}
                ended={values.ended}
                invalid={Boolean(error('validity.start') ?? error('validity.end'))}
                onOpen={() =>
                  showDetails(() => {
                    const field = document.getElementById(idFor('validity.start'))
                    field?.scrollIntoView({ block: 'center' })
                    field?.focus()
                  })
                }
              />
              {itemId ? null : (
                <span className="text-caption">
                  <HelpLink to="add-your-first-context">How to add a fact</HelpLink>
                </span>
              )}
            </div>
            {error('areaId') ? (
              <p
                id={`${idFor('areaId')}-error`}
                data-slot="field-error"
                className="flex items-start gap-1 text-caption text-status-danger-fg"
              >
                <CircleAlertIcon
                  aria-hidden="true"
                  className="size-icon-sm shrink-0 translate-y-px text-status-danger-icon"
                />
                <span className="min-w-0">{error('areaId')}</span>
              </p>
            ) : domainless.length && !values.areaId ? (
              <p
                data-slot="no-domain-hint"
                className="flex items-start gap-1 text-caption text-muted-foreground"
              >
                <InfoIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
                <span className="min-w-0">{noDomainHint(domainless, isAdmin)}</span>
              </p>
            ) : null}
            <Field invalid={Boolean(error('title'))} disabled={submitting}>
              <textarea
                id={idFor('title')}
                aria-label="Title"
                aria-describedby={`${idFor('title')}-error`}
                aria-invalid={Boolean(error('title')) || undefined}
                rows={1}
                maxLength={200}
                value={values.title}
                placeholder={titleFromSummary(values.summaryMarkup) || 'Title'}
                onChange={(event) => set('title', event.target.value.replace(/\s*\n\s*/g, ' '))}
                onBlur={() => blur('title')}
                onKeyDown={(event) => {
                  const end =
                    event.currentTarget.selectionStart === event.currentTarget.value.length
                  if (
                    (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) ||
                    (event.key === 'ArrowDown' && end)
                  ) {
                    event.preventDefault()
                    focusField(idFor('summaryMarkup'), 'start')
                  }
                }}
                disabled={submitting}
                className="field-sizing-content w-full resize-none rounded-md bg-transparent text-display font-bold text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <FieldError id={`${idFor('title')}-error`}>{error('title')}</FieldError>
            </Field>
          </div>
          <Field invalid={Boolean(textError('summaryMarkup'))} disabled={submitting}>
            <SummaryInput
              id={idFor('summaryMarkup')}
              appearance="zone"
              label="Summary"
              placeholder={summaryPrompts[values.kind]}
              describedBy={`${idFor('summaryMarkup')}-error`}
              value={values.summaryMarkup}
              onChange={(value) => set('summaryMarkup', value)}
              onOverflow={(rest) => {
                const body = form.getValues('bodyMarkup')
                set('bodyMarkup', body.trim() ? `${rest}\n\n${body}` : rest)
              }}
              onLeave={(where) =>
                where === 'next'
                  ? focusField(idFor('bodyMarkup'), 'start')
                  : focusField(idFor('title'), 'end')
              }
              checkText
              invalid={Boolean(textError('summaryMarkup'))}
              disabled={submitting}
            />
            <FieldError id={`${idFor('summaryMarkup')}-error`}>
              {textError('summaryMarkup')}
            </FieldError>
          </Field>
          <Field invalid={Boolean(textError('bodyMarkup'))} disabled={submitting}>
            <BodyInput
              id={idFor('bodyMarkup')}
              label="Body"
              kind={values.kind}
              placeholder={bodyPrompt}
              describedBy={`${idFor('bodyMarkup')}-error`}
              value={values.bodyMarkup}
              onChange={(value) => set('bodyMarkup', value)}
              onLeave={() => focusField(idFor('summaryMarkup'), 'end')}
              checkText
              invalid={Boolean(textError('bodyMarkup'))}
              disabled={submitting}
            />
            <FieldError id={`${idFor('bodyMarkup')}-error`}>{textError('bodyMarkup')}</FieldError>
          </Field>
        </form>
        <PageRail ref={railRef} aria-label="Details and what agents get">
          <Tabs value={tab} onValueChange={(next: 'details' | 'agent') => setTab(next)}>
            <TabsList variant="line" className="w-full justify-start border-b">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="agent">What agents get</TabsTrigger>
            </TabsList>
            <TabsContent value="details" keepMounted className="data-hidden:hidden">
              <div className="flex flex-col gap-6 pt-4">
                <RailSection
                  icon={TargetIcon}
                  title="Where it applies"
                  titleId={`${idFor('scope')}-title`}
                  aside={<NeededBadge needed={scopeEmpty} />}
                >
                  <Field
                    invalid={Boolean(error('scope'))}
                    disabled={submitting}
                    onBlur={() => blur('scope')}
                  >
                    <ScopeInput
                      id={idFor('scope')}
                      value={values.scope}
                      onChange={(value) => set('scope', value)}
                      aria-label="Where it applies"
                      aria-invalid={Boolean(error('scope'))}
                      aria-describedby={`${idFor('scope')}-hint ${idFor('scope')}-error`}
                      disabled={submitting}
                    />
                    <FieldDescription id={`${idFor('scope')}-hint`}>
                      Agents get this fact when a question is about these. Choose Any to cover every
                      value.
                    </FieldDescription>
                    <FieldError id={`${idFor('scope')}-error`}>{error('scope')}</FieldError>
                  </Field>
                </RailSection>
                <RailSection
                  icon={HeedValidUntilIcon}
                  title="When it applies"
                  titleId={`${idFor('validity')}-title`}
                  aside={<NeededBadge needed={!values.validity.start} />}
                >
                  <ValidityRange
                    idPrefix={idFor('validity')}
                    value={values.validity}
                    onValueChange={(value) => set('validity', value)}
                    kind={values.kind === 'issue' ? 'issue' : 'standing'}
                    ended={values.ended}
                    onEndedChange={(ended) => set('ended', ended)}
                    errors={{ start: error('validity.start'), end: error('validity.end') }}
                    disabled={submitting}
                  />
                  {asked ? (
                    <p data-slot="asked-month" className="text-caption text-muted-foreground">
                      {`People asked about ${monthText(asked)}. Say when the fact itself applies.`}
                    </p>
                  ) : null}
                  <p className="text-caption text-muted-foreground">
                    {values.kind === 'issue'
                      ? 'Without a last day, we ask again until it ends.'
                      : "Leave the end date empty while it's still going on."}
                  </p>
                </RailSection>
                <RailSection
                  icon={LinkIcon}
                  title={sourceWords.title}
                  titleId={`${idFor('evidence')}-title`}
                  aside={<NeededBadge needed={evidenceEmpty} />}
                >
                  <p className="text-caption text-muted-foreground">
                    {sourceWords.help} <WhyWeAsk topic="source" section={sourceWords.title} />{' '}
                    <CaptureHelp />
                  </p>
                  <EvidenceFields
                    kind={values.kind}
                    value={values.evidence}
                    onChange={(value) => set('evidence', value)}
                    error={error}
                    disabled={submitting}
                    onBlur={blur}
                  />
                </RailSection>
                <RailSection
                  icon={CircleSlashIcon}
                  title={caveatWords.title}
                  titleId={`${idFor('notToConclude')}-title`}
                  aside={
                    <span className="text-caption text-muted-foreground">
                      {caveatWords.optional}
                    </span>
                  }
                >
                  <CaveatField
                    id={idFor('notToConclude')}
                    labelledBy={`${idFor('notToConclude')}-title`}
                    value={values.notToConclude}
                    onChange={(next) => set('notToConclude', next)}
                    onBlur={() => blur('notToConclude')}
                    kind={values.kind}
                    itemTitle={values.title.trim() || titleFromSummary(values.summaryMarkup)}
                    claimLevel={claimLevel}
                    error={error('notToConclude')}
                    disabled={submitting}
                  />
                </RailSection>
                <RailSection
                  icon={HeedDomainIcon}
                  title="Who reviews it"
                  titleId={`${idFor('reviewer')}-title`}
                >
                  {area ? (
                    <p className="flex items-center gap-2 text-dense">
                      {owner ? (
                        <span>
                          <b className="font-bold">{owner.name}</b>{' '}
                          <span className="text-muted-foreground">owner of {area.name}</span>
                        </span>
                      ) : (
                        <span>The owner of {area.name}</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-dense text-muted-foreground">
                      Choose the domain above. Its owner reviews it.
                    </p>
                  )}
                  {inferred && !choseDomain ? (
                    <p className="text-caption text-muted-foreground">
                      The domain follows the metric you chose ({metricNames.join(', ')}). Change it
                      above if it's wrong.
                    </p>
                  ) : null}
                </RailSection>
              </div>
            </TabsContent>
            <TabsContent value="agent" className="flex flex-col gap-6 pt-4">
              <AgentView
                proposal={autosave.proposal}
                unsaved={autosave.unsaved}
                onShowEvidence={() =>
                  showDetails(() => {
                    const field = document.getElementById(idFor('evidence.0.url'))
                    field?.scrollIntoView({ block: 'center' })
                    field?.focus()
                  })
                }
              />
            </TabsContent>
          </Tabs>
          <DraftChecks proposal={autosave.proposal} unsaved={autosave.unsaved} held={held} />
          {autosave.proposal ? (
            <AttachedTests
              proposal={autosave.proposal}
              risk={autosave.proposal.draft.riskLevel ?? null}
            />
          ) : null}
        </PageRail>
      </PageDocument>
      <PagePhoneActions holdsAssistant>
        {status}
        <div className="flex items-center gap-2">
          {action}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon-touch" aria-label="More form actions" />}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  setTab('agent')
                  requestAnimationFrame(() =>
                    railRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                  )
                }}
              >
                <EyeIcon />
                What agents will get
              </DropdownMenuItem>
              <AssistantMenuItem />
              {draft ? (
                <DropdownMenuItem onClick={() => setDiscardOpen(true)}>
                  <Trash2Icon />
                  Discard draft
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PagePhoneActions>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this draft?"
        effect="Nobody else has seen it. This cannot be undone."
        action="Discard draft"
        actionIcon={Trash2Icon}
        tone="destructive"
        onConfirm={onDiscard}
      />
      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave with unsaved changes?</DialogTitle>
            <DialogDescription>
              Your last changes aren't saved yet. Stay on this page for a moment.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.proceed?.()}>
              Leave this page
            </Button>
            <Button onClick={() => blocker.reset?.()}>Keep writing</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
