import * as z from 'zod/mini'
import { draftSchema, textFindings, type Draft, type FormatFinding } from '@domain/draft'
import { itemKinds, type ContextItem, type Scope } from '@domain/item'
import { parseMentions } from '@domain/mentions'
import { defaultNotToConclude, limits, ownCaveat } from '@domain/proposal-rules'
import { isCalendarDate } from '@domain/validity'
import type { Catalogue, PreviewInput, ProposalRecord } from '@/api'
import { addToScope } from '@/lib/mention-targets'
import { plainFinding } from '@/lib/text-check'

export const contextFormSchema = z.object({
  kind: z.enum(itemKinds),
  title: z.string(),
  summaryMarkup: z.string(),
  scope: z.object({
    metrics: z.array(z.string()),
    dimensions: z.array(z.string()),
    dimensionValues: z.array(z.object({ dimension: z.string(), value: z.string() })),
  }),
  validity: z.object({ start: z.nullable(z.string()), end: z.nullable(z.string()) }),
  ended: z.boolean(),
  evidence: z.array(z.object({ url: z.string(), quote: z.string(), date: z.string() })),
  areaId: z.string(),
  notToConclude: z.string(),
  bodyMarkup: z.string(),
  /**
   * What is wrong with the current version, on Suggest a change (heed-ux B5): the proposal's
   * reason, not part of the item.
   */
  reason: z.string(),
})
export type ContextFormValues = z.infer<typeof contextFormSchema>

/**
 * An autosaved form. One saved before a scope could name a dimension with any value has none; one
 * saved before Suggest a change asked what is wrong has no reason; one saved before what not to
 * conclude started empty may hold the default, which the box no longer shows.
 */
export function parseFormBackup(value: unknown) {
  const parsed = parseBackup(value)
  return parsed.success
    ? {
        ...parsed,
        data: { ...parsed.data, notToConclude: ownCaveat(parsed.data.notToConclude) ?? '' },
      }
    : parsed
}

function parseBackup(value: unknown) {
  if (value && typeof value === 'object') {
    const filled = { reason: '', ...value }
    const scope: unknown = 'scope' in value ? value.scope : undefined
    if (scope && typeof scope === 'object' && !('dimensions' in scope))
      return contextFormSchema.safeParse({ ...filled, scope: { ...scope, dimensions: [] } })
    return contextFormSchema.safeParse(filled)
  }
  return contextFormSchema.safeParse(value)
}

export function formValues(source?: ContextItem | ProposalRecord): ContextFormValues {
  const draft = source && 'draft' in source ? source.draft : source
  const scope = draft?.scope
  const prefixed = source && 'draft' in source
  const summaryMarkup = draft?.summaryMarkup ?? draft?.summary ?? ''
  const title = draft?.title ?? ''
  return {
    kind: draft?.kind ?? 'event',
    title: title === titleFromSummary(summaryMarkup) ? '' : title,
    summaryMarkup,
    scope:
      prefixed && scope
        ? scope
        : draftScope(scope ?? { metrics: [], dimensions: [], dimensionValues: [] }),
    validity: draft?.validity ?? { start: null, end: null },
    ended: draft?.validity?.end != null,
    evidence: draft?.evidence?.length ? draft.evidence : [{ url: '', quote: '', date: '' }],
    areaId: draft?.areaId ?? '',
    // Optional, and empty unless someone wrote their own line: the stored default ("cause not
    // proven") says what the claim level already says, so the box never shows it (FR-104).
    notToConclude: ownCaveat(draft && 'notToConclude' in draft ? draft.notToConclude : null) ?? '',
    bodyMarkup: draft?.bodyMarkup ?? draft?.body ?? '',
    reason: source && 'draft' in source && source.action === 'change' ? (source.reason ?? '') : '',
  }
}

/**
 * A new draft that starts from a term page ("Add context about Orders"): the metric is in its
 * scope from the start, the way a gap starts a draft. A scope that already names it is kept.
 */
export function withMetric(values: ContextFormValues, metricId: string | undefined) {
  if (!metricId) return values
  const key = `metric:${metricId}`
  if (values.scope.metrics.includes(key) || values.scope.metrics.includes(metricId)) return values
  return { ...values, scope: { ...values.scope, metrics: [...values.scope.metrics, key] } }
}

/**
 * A new draft started from Try it ("Start a draft"): the scope it asked about, and its first day
 * as the day the fact starts, unless the draft already has one. A scope key already there is kept.
 */
export function withScope(
  values: ContextFormValues,
  keys: readonly string[] | undefined,
  from: string | undefined,
): ContextFormValues {
  const scope = (keys ?? []).reduce(addToScope, values.scope)
  const validity =
    from && values.validity.start === null ? { ...values.validity, start: from } : values.validity
  return scope === values.scope && validity === values.validity
    ? values
    : { ...values, scope, validity }
}

/**
 * A new draft opened by a capture link (lib/capture.ts): the page and the sentence the person
 * selected fill the first empty source, or a new one after the sources already there. The day
 * read stays empty: the person says it (the Today button), it is never filled in silently. A
 * source already there with the same link and sentence is kept as it is.
 */
export function withEvidence(
  values: ContextFormValues,
  url: string | undefined,
  quote: string | undefined,
): ContextFormValues {
  if (!url && !quote) return values
  const row = { url: url ?? '', quote: quote ?? '', date: '' }
  if (values.evidence.some((entry) => entry.url === row.url && entry.quote === row.quote))
    return values
  const empty = values.evidence.findIndex((entry) => !entry.url.trim() && !entry.quote.trim())
  const evidence =
    empty === -1
      ? [...values.evidence, row]
      : values.evidence.map((entry, index) =>
          index === empty ? { ...row, date: entry.date } : entry,
        )
  return { ...values, evidence }
}

export function titleFromSummary(markup: string): string {
  const text = parseMentions(markup).text.trim().replace(/\s+/g, ' ')
  const first = text.match(/^.*?[.!?](?=\s|$)/u)?.[0] ?? text
  return [...first].slice(0, 200).join('')
}

export function draftScope(scope: Scope): NonNullable<Draft['scope']> {
  return {
    metrics: scope.metrics.map((id) => (/^(metric|group):/.test(id) ? id : `metric:${id}`)),
    dimensions: scope.dimensions.map((id) => (id.startsWith('dim:') ? id : `dim:${id}`)),
    dimensionValues: scope.dimensionValues.map(({ dimension, value }) => ({
      dimension: dimension.startsWith('dim:') ? dimension : `dim:${dimension}`,
      value: value.startsWith('val:') ? value : `val:${dimension.replace(/^dim:/, '')}/${value}`,
    })),
  }
}

/**
 * What not to conclude, as the draft stores it. An empty box stores the default (FR-104), as the
 * service does for a draft without one: a draft that has the default, or none yet, keeps what it
 * has, so a change to an item never turns its stored default into a field change.
 */
function storedCaveat(text: string, previous: Draft): Pick<Draft, 'notToConclude'> {
  if (text.trim()) return { notToConclude: text }
  return ownCaveat(previous.notToConclude) ? { notToConclude: defaultNotToConclude } : {}
}

/** Owner, risk and review date are service defaults, never contributor selections. */
export function formToDraft(value: ContextFormValues, previous: Draft = {}): Draft {
  const { ownerId: _owner, reviewDate: _review, riskLevel: _risk, ...rest } = previous
  return draftSchema.parse({
    ...rest,
    kind: value.kind,
    title: value.title.replace(/\s+/g, ' ').trim() || titleFromSummary(value.summaryMarkup),
    summary: parseMentions(value.summaryMarkup).text,
    summaryMarkup: value.summaryMarkup,
    body: parseMentions(value.bodyMarkup).text,
    bodyMarkup: value.bodyMarkup,
    scope: draftScope(value.scope),
    validity: {
      start: value.validity.start ?? '',
      end: value.kind === 'issue' && !value.ended ? null : value.validity.end,
    },
    evidence: value.evidence,
    areaId: value.areaId,
    ...storedCaveat(value.notToConclude, previous),
    // Keep reviewed values when suggesting a change; switching a new draft's kind gets its default.
    ...(previous.kind === value.kind && previous.riskLevel
      ? { riskLevel: previous.riskLevel }
      : {}),
    ...(value.kind !== 'issue' && previous.reviewDate ? { reviewDate: previous.reviewDate } : {}),
  })
}

/** The catalogue's metrics that a scope names, by key (`metric:orders`) or by id. */
export function scopeMetrics(scope: Scope, catalogue: Catalogue | undefined) {
  return (
    catalogue?.terms.filter(
      (term) =>
        term.kind === 'metric' &&
        (scope.metrics.includes(term.key) || scope.metrics.includes(term.id)),
    ) ?? []
  )
}

/** The default domain (FR-123): the one domain of every chosen metric, or none. */
export function inferredDomain(scope: Scope, catalogue: Catalogue | undefined): string | null {
  const terms = scopeMetrics(scope, catalogue)
  if (!terms.length || terms.some((term) => !term.domain.areaId)) return null
  const areas = new Set(terms.map((term) => term.domain.areaId))
  return areas.size === 1 ? terms[0]!.domain.areaId : null
}

/**
 * The domain the form follows from the chosen metrics, until the person chooses one: the
 * inferred domain, or none. Undefined while the catalogue loads, so the form keeps what it has
 * instead of clearing a domain it cannot work out yet.
 */
export function followedDomain(
  chose: boolean,
  catalogue: Catalogue | undefined,
  inferred: string | null,
): string | undefined {
  if (chose || !catalogue) return undefined
  return inferred ?? ''
}

/**
 * The chosen metrics that belong to no domain, by name. Heed cannot choose the item's domain from
 * them, so the form says so and what to do.
 */
export function metricsWithoutDomain(scope: Scope, catalogue: Catalogue | undefined): string[] {
  return scopeMetrics(scope, catalogue)
    .filter((term) => !term.domain.areaId)
    .map((term) => term.name)
}

/** What the form says when chosen metrics have no domain: why, and what the person can do. */
export function noDomainHint(names: readonly string[], administrator: boolean): string {
  const listed =
    names.length <= 2
      ? names.join(' and ')
      : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
  const one = names.length === 1
  return `${listed} ${one ? 'has' : 'have'} no domain yet, so we can't choose this fact's domain from ${one ? 'it' : 'them'}. Choose the domain the fact belongs to. ${administrator ? 'You can give a metric its domain in Administration › Sources.' : `Ask an admin to give ${one ? 'it' : 'them'} a domain.`}`
}

export function hasDraftContent(draft: Draft): boolean {
  return Boolean(
    (draft.summary ?? parseMentions(draft.summaryMarkup ?? '').text).trim() ||
    draft.scope?.metrics.length ||
    draft.scope?.dimensions.length ||
    draft.scope?.dimensionValues.length,
  )
}

/**
 * What keeps the change reason from being saved: too long, or not plain text. Autosave leaves
 * such a reason out, so the rest of the draft still saves, and Submit waits for it.
 */
export function changeReasonProblem(reason: string): string | null {
  if (reason.length > limits.changeReason)
    return `Keep it to ${limits.changeReason.toLocaleString('en')} characters.`
  const parsed = parseMentions(reason)
  if (parsed.mentions.length || parsed.errors.length) return 'Write plain text, without @ mentions.'
  return null
}

export function contextFormFindings(value: ContextFormValues): FormatFinding[] {
  const findings: FormatFinding[] = []
  const add = (field: string, message: string) =>
    findings.push({ code: 'form', field, message, severity: 'error' })
  const summary = parseMentions(value.summaryMarkup)
  if ([...value.title].length > limits.title)
    add('title', `Keep the title within ${limits.title} characters.`)
  if (!summary.text.trim()) add('summaryMarkup', 'Write a short summary. AI apps read it first.')
  const reasonProblem = changeReasonProblem(value.reason)
  if (reasonProblem) add('reason', reasonProblem)
  if ([...summary.text].length > limits.summary)
    add('summaryMarkup', `Keep the summary within ${limits.summary} visible characters.`)
  if (summary.errors.length) add('summaryMarkup', 'Fix the mention markup.')
  if (
    !value.scope.metrics.length &&
    !value.scope.dimensions.length &&
    !value.scope.dimensionValues.length
  )
    add('scope', 'Choose at least one metric or value it applies to.')
  if (!value.validity.start || !isCalendarDate(value.validity.start))
    add('validity.start', 'Choose the first day.')
  if (value.kind === 'issue' && value.ended && !value.validity.end)
    add('validity.end', 'Choose the last day, or select Still going on.')
  if (
    value.validity.end &&
    (!isCalendarDate(value.validity.end) ||
      (value.validity.start && value.validity.end <= value.validity.start))
  )
    add('validity.end', 'The last day must be on or after the first day.')
  value.evidence.forEach((entry, index) => {
    if (
      !z
        .string()
        .check(z.url(), z.regex(/^https?:\/\//))
        .safeParse(entry.url).success
    )
      add(`evidence.${index}.url`, 'Enter a full http or https link to the source.')
    if (!entry.quote.trim() || [...entry.quote].length > limits.quote)
      add(
        `evidence.${index}.quote`,
        `Copy a sentence from the source, up to ${limits.quote} characters.`,
      )
    if (!isCalendarDate(entry.date)) add(`evidence.${index}.date`, 'Choose the day you read it.')
  })
  if (!value.areaId) add('areaId', 'Choose the domain this fact belongs to.')
  if ([...value.notToConclude].length > limits.notToConclude)
    add(
      'notToConclude',
      `Keep what not to conclude within ${limits.notToConclude.toLocaleString('en-GB')} characters.`,
    )
  if ([...parseMentions(value.bodyMarkup).text].length > limits.body)
    add(
      'bodyMarkup',
      `Keep the explanation within ${limits.body.toLocaleString('en-GB')} characters.`,
    )
  return [...findings, ...contextTextFindings(value)]
}

/**
 * The text check on every field, as the service runs it (FR-117): on the stored markup and on the
 * plain words a reader sees. The markup escapes `@` (`anna.berg\@example.com`), so a check of the
 * markup alone would miss an email address the service refuses.
 */
export function contextTextFindings(value: ContextFormValues): FormatFinding[] {
  const plain = {
    ...value,
    summaryMarkup: parseMentions(value.summaryMarkup).text,
    bodyMarkup: parseMentions(value.bodyMarkup).text,
  }
  const seen = new Set<string>()
  return [...textFindings(value), ...textFindings(plain)].map(plainFinding).filter((finding) => {
    const key = `${finding.field} ${finding.code}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function findingField(field: string): string {
  if (field === 'title') return 'title'
  if (field === 'summary') return 'summaryMarkup'
  if (field === 'body') return 'bodyMarkup'
  if (!field || field.startsWith('scope')) return 'scope'
  if (field === 'ownerId') return 'areaId'
  return field
}

export function previewInput(
  proposal: ProposalRecord,
  scope = proposal.draft.scope,
  day = proposal.draft.validity?.start,
): PreviewInput {
  const values = new Map<string, string[]>()
  // A dimension with any value is named without a value, so its items apply to the preview.
  for (const dimension of scope?.dimensions ?? []) values.set(dimension, [])
  for (const { dimension, value } of scope?.dimensionValues ?? [])
    values.set(dimension, [...(values.get(dimension) ?? []), value])
  return {
    id: proposal.id,
    question: '',
    metrics: scope?.metrics ?? [],
    dimension_filters: [...values].map(([dimension, values]) => ({ dimension, values })),
    ...(day && isCalendarDate(day) ? { window: { from: day, to: day } } : {}),
  }
}
