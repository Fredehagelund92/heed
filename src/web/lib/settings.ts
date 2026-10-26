/**
 * The words and rules of Settings and Administration (FR-801, FR-804, FR-806 to FR-810; plan
 * slice W11b; navigation decision, 12 October 2026): their sections and who may open each, every
 * setting in plain words with the editor its value needs, and the history log's actions. An
 * editor is typed from the contract's `settingSchemas`, so the screen accepts exactly what the
 * service accepts and says why in words before anything is sent. The service decides; these only
 * check a form and say what a value means.
 */
import type { AuditEntry, Permissions } from '@/api'
import { aboutBusinessLength } from '@domain/about-business'
import { domainHues, type DomainHue } from '@domain/item'
import { type SettingKey, settingSchemas } from '../../contract/admin.ts'
import { domainAboutProblems } from './areas'
import { canReadAudit, isAdmin } from './permissions'
import { toolName } from './gateway'
import type { AdminSection, SettingsSection } from './settings-sections'
export type { AdminSection, SettingsSection }

// ---- sections ----

import {
  adminSectionGroups,
  adminSections,
  adminSectionTitles,
  settingsSections,
  settingsSectionTitles,
} from './settings-sections'
export {
  adminSectionGroups,
  adminSections,
  adminSectionTitles,
  settingsSections,
  settingsSectionTitles,
}

/**
 * The sections of Administration a person may open, in the order they show: every section for an
 * administrator, and the history log for an auditor (FR-808). Anyone else has none, and is told
 * whose place it is. The service checks every call again.
 */
export function adminSectionsFor(permissions: Permissions): AdminSection[] {
  if (isAdmin(permissions)) return [...adminSections]
  return canReadAudit(permissions) ? ['audit'] : []
}

// ---- settings ----

export const settingGroups = [
  'review',
  'limits',
  'spending',
  'privacy',
  'tests',
  'models',
  'sources',
  'business',
] as const
export type SettingGroup = (typeof settingGroups)[number]

export const settingGroupTitles: Record<SettingGroup, string> = {
  review: 'Facts and review',
  limits: 'Request limits',
  spending: 'AI spending',
  privacy: 'Privacy and retention',
  tests: 'Answer tests',
  models: 'AI models',
  sources: 'Definition sources',
  business: 'About our business',
}

/** How a field reads and is typed: a whole number, dollars (stored as millionths), text. */
export type SettingFieldKind = 'int' | 'dollars' | 'text' | 'url'

export type SettingField = {
  /** The value's key in an object value; `value` for a plain value. */
  name: string
  label: string
  kind: SettingFieldKind
  /** The unit after a number: "days", "a minute". */
  unit?: string
  /** Empty leaves it out (a record) or sets no value (null). */
  optional?: boolean
  /** A line under the field. */
  description?: string
}

/**
 * The shape of a value: one number or text (`value`), an object with every field (`object`),
 * an object whose fields may be left out (`record`), a model (`model`), or the judge, which is a
 * model or "another model line" (`judge`).
 */
export type SettingShape = 'value' | 'object' | 'record' | 'model' | 'judge'

export type SettingMeta = {
  title: string
  description: string
  group: SettingGroup
  shape: SettingShape
  /** The form's fields. Per-tool rates have one per tool, added by `fieldsOf`. */
  fields: SettingField[]
  /** The value in a few words, for the list and the history. */
  words: (value: unknown) => string
}

const count = new Intl.NumberFormat('en-GB')
const dollars = (micros: number) =>
  `$${(micros / 1_000_000).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plural = (n: number, one: string, many = `${one}s`) =>
  `${count.format(n)} ${n === 1 ? one : many}`
const num = (value: unknown) => (typeof value === 'number' ? value : NaN)
const obj = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const days = (value: unknown) => plural(num(value), 'day')
const perMinute = (value: unknown) => `${count.format(num(value))} a minute`
const modelWords = (value: unknown) => {
  const { provider, model } = obj(value)
  return typeof model === 'string' ? `${model} (${String(provider)})` : 'Not set'
}
const modelFields: SettingField[] = [
  {
    name: 'provider',
    label: 'Provider',
    kind: 'text',
    description: 'The name we know it by, such as anthropic.',
  },
  { name: 'model', label: 'Model', kind: 'text', description: 'A model the provider lists.' },
]
const modelLeaves =
  "Questions and answers sent to it leave the company. They go to the provider and the model's maker."

const dayField = (label = 'Days'): SettingField[] => [
  { name: 'value', label, kind: 'int', unit: 'days' },
]

/**
 * About our business in a few words, for the history: its start and how long it is, or that it is
 * empty and nothing is given.
 */
function aboutBusinessWords(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Empty'
  const length = aboutBusinessLength(value)
  const start = value.trim().split('\n')[0]!
  const shown = [...start].length > 80 ? `${[...start].slice(0, 77).join('').trimEnd()}...` : start
  return `${shown} (${plural(length, 'character')})`
}

/** Every setting an admin may change, in plain words. */
export const settingMeta: Record<SettingKey, SettingMeta> = {
  'review.default_days': {
    title: 'Check facts again after',
    description:
      'How long after a fact is accepted we ask its owner to check it again, unless the fact has its own check date.',
    group: 'review',
    shape: 'value',
    fields: dayField(),
    words: days,
  },
  'review.open_issue_days': {
    title: 'Ask about open Issues after',
    description:
      "When an Issue has no end date, we ask its owner this many days after it starts whether it's still going on.",
    group: 'review',
    shape: 'value',
    fields: dayField(),
    words: days,
  },
  'limits.mentions_per_version': {
    title: 'Mentions per fact',
    description:
      'How many metrics, names such as a market, and other facts one version of a fact can mention.',
    group: 'review',
    shape: 'value',
    fields: [{ name: 'value', label: 'Mentions', kind: 'int', unit: 'mentions' }],
    words: (value) => plural(num(value), 'mention'),
  },
  'serving.max_overlay_age_seconds': {
    title: 'Stop switch delay',
    description:
      'How long agents may still get something after a stop switch stops it. It can be 60 seconds at most.',
    group: 'review',
    shape: 'value',
    fields: [{ name: 'value', label: 'Seconds', kind: 'int', unit: 'seconds' }],
    words: (value) => plural(num(value), 'second'),
  },
  'limits.mcp_requests_per_minute': {
    title: 'Agent requests',
    description:
      "How many requests agents can make in a minute, for each person's access key and for each agent. An agent with a limit of its own uses that instead.",
    group: 'limits',
    shape: 'object',
    fields: [
      { name: 'person', label: 'Per person', kind: 'int', unit: 'a minute' },
      { name: 'client', label: 'Per agent', kind: 'int', unit: 'a minute' },
    ],
    words: (value) =>
      `${perMinute(obj(value).person)} per person, ${count.format(num(obj(value).client))} per agent`,
  },
  'limits.mcp_rate_per_minute': {
    title: 'Tool calls',
    description:
      'How often agents together can call one tool in a minute. A tool left empty has no limit of its own.',
    group: 'limits',
    shape: 'record',
    fields: [],
    words: (value) => {
      const entries = Object.entries(obj(value))
      return entries.length
        ? entries
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([tool, rate]) => `${toolName(tool)} ${count.format(num(rate))}`)
            .join(', ')
        : 'No tool has a limit of its own'
    },
  },
  'limits.api_rate_per_minute': {
    title: 'Web requests',
    description:
      'How many requests the web app can make in a minute, for each signed-in person and for each network address before sign-in.',
    group: 'limits',
    shape: 'object',
    fields: [
      { name: 'person', label: 'Per person', kind: 'int', unit: 'a minute' },
      { name: 'ip', label: 'Per address before sign-in', kind: 'int', unit: 'a minute' },
    ],
    words: (value) =>
      `${perMinute(obj(value).person)} per person, ${count.format(num(obj(value).ip))} per address`,
  },
  'limits.gap_reports_per_minute': {
    title: 'Gap reports',
    description:
      'How many gaps one person can report in a minute, from Try a question and the assistant.',
    group: 'limits',
    shape: 'object',
    fields: [{ name: 'person', label: 'Per person', kind: 'int', unit: 'a minute' }],
    words: (value) => `${perMinute(obj(value).person)} per person`,
  },
  'limits.assistant_ratings_per_minute': {
    title: 'Assistant ratings',
    description:
      "How many of the assistant's answers one person can rate in a minute. We keep only the counts.",
    group: 'limits',
    shape: 'object',
    fields: [{ name: 'person', label: 'Per person', kind: 'int', unit: 'a minute' }],
    words: (value) => `${perMinute(obj(value).person)} per person`,
  },
  'limits.agent_drafts': {
    title: 'Drafts from agents',
    description:
      "How many drafts one person's agents can save with the draft tool in a day, and how many can wait unsent at once.",
    group: 'limits',
    shape: 'object',
    fields: [
      { name: 'per_day', label: 'Per person', kind: 'int', unit: 'a day' },
      { name: 'open', label: 'Waiting at once', kind: 'int', unit: 'drafts' },
    ],
    words: (value) =>
      `${count.format(num(obj(value).per_day))} a day per person, ${count.format(num(obj(value).open))} waiting at once`,
  },
  'limits.web_searches_per_day': {
    title: 'Web search by the assistant',
    description:
      'How many web searches the assistant can run for one person in a day, to draft from a news story or a law they describe. 0 turns web search off. The search words go to the AI provider and its search partners. The assistant can always read a page the person links.',
    group: 'limits',
    shape: 'value',
    fields: [{ name: 'value', label: 'Searches per person', kind: 'int', unit: 'a day' }],
    words: (value) =>
      num(value) > 0 ? `On, ${plural(num(value), 'search', 'searches')} a day per person` : 'Off',
  },
  'limits.llm_daily_micros_per_person': {
    title: 'Daily spending per person',
    description: "What one person's use of the assistant can cost in a day.",
    group: 'spending',
    shape: 'value',
    fields: [{ name: 'value', label: 'Dollars a day', kind: 'dollars' }],
    words: (value) => `${dollars(num(value))} a day`,
  },
  'limits.llm_monthly_cap_micros': {
    title: 'Monthly spending cap',
    description:
      'What all AI calls together can cost in a month. They stop when they reach the cap.',
    group: 'spending',
    shape: 'value',
    fields: [{ name: 'value', label: 'Dollars a month', kind: 'dollars' }],
    words: (value) => `${dollars(num(value))} a month`,
  },
  'limits.llm_feature_monthly_micros': {
    title: 'Monthly spending per feature',
    description:
      'What the assistant and the answer tests can each cost in a month. Leave one empty and only the monthly cap applies to it.',
    group: 'spending',
    shape: 'record',
    fields: [
      { name: 'assistant', label: 'Assistant', kind: 'dollars', optional: true },
      { name: 'eval', label: 'Answer tests', kind: 'dollars', optional: true },
    ],
    words: (value) => {
      const { assistant, eval: tests } = obj(value)
      const parts = [
        typeof assistant === 'number' ? `Assistant ${dollars(assistant)}` : null,
        typeof tests === 'number' ? `answer tests ${dollars(tests)}` : null,
      ].filter(Boolean)
      return parts.length ? `${parts.join(', ')} a month` : 'Only the monthly cap'
    },
  },
  'evals.run_budget_micros': {
    title: 'Test run budget',
    description:
      'A full answer test run that we expect to cost more than this waits for an admin to approve it.',
    group: 'spending',
    shape: 'value',
    fields: [{ name: 'value', label: 'Dollars a run', kind: 'dollars' }],
    words: (value) => `${dollars(num(value))} a run`,
  },
  'privacy.min_count': {
    title: 'Smallest count shown',
    description: 'We hide every count of agent calls below this, so nobody can tell who asked.',
    group: 'privacy',
    shape: 'value',
    fields: [{ name: 'value', label: 'Calls', kind: 'int', unit: 'calls' }],
    words: (value) => plural(num(value), 'call'),
  },
  'gaps.no_item_threshold': {
    title: 'When a topic becomes a gap',
    description:
      'When agents ask about a topic this many times within these days and find nothing, it becomes a gap.',
    group: 'privacy',
    shape: 'object',
    fields: [
      { name: 'calls', label: 'Calls', kind: 'int', unit: 'calls' },
      { name: 'days', label: 'Within', kind: 'int', unit: 'days' },
    ],
    words: (value) => `${plural(num(obj(value).calls), 'call')} in ${days(obj(value).days)}`,
  },
  'retention.delivery_days': {
    title: 'Record of what agents got',
    description: 'How long we keep the record of what each agent got.',
    group: 'privacy',
    shape: 'value',
    fields: dayField(),
    words: days,
  },
  'retention.request_log_days': {
    title: 'Request log kept',
    description:
      'How long we keep the record of each request agents make. Older traffic is deleted.',
    group: 'privacy',
    shape: 'value',
    fields: dayField(),
    words: days,
  },
  'retention.note_days': {
    title: 'Notes kept',
    description: 'How long we keep notes on gaps and the notes agents add to their feedback.',
    group: 'privacy',
    shape: 'value',
    fields: dayField(),
    words: days,
  },
  'retention.outbox_days': {
    title: 'Change events kept',
    description:
      "How long we keep the events behind live updates and notifications after they're sent.",
    group: 'privacy',
    shape: 'value',
    fields: dayField(),
    words: days,
  },
  'evals.tries': {
    title: 'Tries per wording',
    description:
      "How many times we ask each wording of a test question in a run. It's always at least three.",
    group: 'tests',
    shape: 'value',
    fields: [{ name: 'value', label: 'Tries', kind: 'int', unit: 'tries' }],
    words: (value) => plural(num(value), 'try', 'tries'),
  },
  'evals.flip_repeats': {
    title: 'Repeats to confirm a change',
    description:
      'How often we ask a test question again when its result changed. The majority decides, so the number is odd.',
    group: 'tests',
    shape: 'value',
    fields: [{ name: 'value', label: 'Repeats', kind: 'int', unit: 'repeats' }],
    words: (value) => plural(num(value), 'repeat'),
  },
  'models.assistant': {
    title: 'Assistant model',
    description: `The model that writes the assistant's answers. ${modelLeaves}`,
    group: 'models',
    shape: 'model',
    fields: modelFields,
    words: modelWords,
  },
  'models.eval_answer': {
    title: 'Answer test model',
    description: `The model that answers test questions in a run. ${modelLeaves}`,
    group: 'models',
    shape: 'model',
    fields: modelFields,
    words: modelWords,
  },
  'models.judge': {
    title: 'Judge model',
    description:
      'The model that scores test answers. Choose one from another model line than the model that answers, or name one here.',
    group: 'models',
    shape: 'judge',
    fields: modelFields,
    words: (value) =>
      value === 'different_family'
        ? 'Another model line than the model that answers'
        : modelWords(value),
  },
  'models.test_authoring': {
    title: 'Test writing model',
    description: `The model that drafts test questions. No feature uses it yet. ${modelLeaves}`,
    group: 'models',
    shape: 'model',
    fields: modelFields,
    words: modelWords,
  },
  'models.call_limits': {
    title: 'Model calls in test runs',
    description:
      'How hard answer tests and assistant checks can call the AI provider: calls at once, and requests and tokens a minute. When the provider refuses a call for its limit, we try again later and never count it as no answer.',
    group: 'models',
    shape: 'record',
    fields: [
      { name: 'concurrency', label: 'At once', kind: 'int', unit: 'calls' },
      {
        name: 'requests_per_minute',
        label: 'Requests',
        kind: 'int',
        unit: 'a minute',
        optional: true,
      },
      { name: 'tokens_per_minute', label: 'Tokens', kind: 'int', unit: 'a minute', optional: true },
    ],
    words: (value) => {
      const { concurrency, requests_per_minute: rpm, tokens_per_minute: tpm } = obj(value)
      return [
        `${plural(num(concurrency), 'call')} at once`,
        typeof rpm === 'number' ? `${count.format(rpm)} requests a minute` : null,
        typeof tpm === 'number' ? `${count.format(tpm)} tokens a minute` : null,
      ]
        .filter(Boolean)
        .join(', ')
    },
  },
  'sources.cube_model_url': {
    title: 'Model folder address',
    description: `Where the model folder is on your Git host's website. With it, the Catalogue links each definition to its file. We never read it.`,
    group: 'sources',
    shape: 'value',
    fields: [
      {
        name: 'value',
        label: 'Address',
        kind: 'url',
        optional: true,
        description:
          'An https address, such as https://github.com/acme/analytics/blob/main/model. Empty for none.',
      },
    ],
    words: (value) => (typeof value === 'string' ? value : 'None'),
  },
  'business.about': {
    title: 'About our business',
    description:
      'What the company does and the words people use. The assistant and connected agents get it as background, never as the source of a fact.',
    group: 'business',
    shape: 'value',
    fields: [{ name: 'value', label: 'About our business', kind: 'text', optional: true }],
    words: aboutBusinessWords,
  },
}

/** Whether a stored key is one this screen describes (a key the API may change). */
export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(settingMeta, key)

/** A value in words; a key the screen does not describe reads as its JSON. */
export function settingWords(key: string, value: unknown): string {
  return isSettingKey(key) ? settingMeta[key].words(value) : JSON.stringify(value)
}

/** The form's fields for a setting; per-tool rates list each tool (and any it names). */
export function fieldsOf(
  key: SettingKey,
  value: unknown,
  tools: readonly string[],
): SettingField[] {
  if (key !== 'limits.mcp_rate_per_minute') return settingMeta[key].fields
  const names = [...new Set([...tools, ...Object.keys(obj(value))])].sort((a, b) =>
    toolName(a).localeCompare(toolName(b), 'en'),
  )
  return names.map((tool) => ({
    name: tool,
    label: toolName(tool),
    kind: 'int',
    unit: 'a minute',
    optional: true,
  }))
}

// ---- the form ----

/** A setting's form: one text per field, and for the judge whether it names a model. */
export type SettingFormValues = Record<string, string>
/** The judge's choice, in the form: another model line, or a model named here. */
export const JUDGE_MODE = 'judgeMode'

/** Dollars with cents, or with more places when the stored value has them. */
const fromMicros = (micros: number) => {
  const amount = micros / 1_000_000
  return Number.isInteger(micros / 10_000) ? amount.toFixed(2) : String(amount)
}

function fieldText(field: SettingField, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (field.kind === 'dollars' && typeof value === 'number') return fromMicros(value)
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value)
}

/** The form a value starts from. */
export function settingFormValues(
  key: SettingKey,
  value: unknown,
  tools: readonly string[],
): SettingFormValues {
  const meta = settingMeta[key]
  const fields = fieldsOf(key, value, tools)
  if (meta.shape === 'value') return { value: fieldText(fields[0]!, value) }
  if (meta.shape === 'judge') {
    const named = value !== 'different_family'
    return {
      [JUDGE_MODE]: named ? 'model' : 'different_family',
      provider: named ? fieldText(fields[0]!, obj(value).provider) : '',
      model: named ? fieldText(fields[1]!, obj(value).model) : '',
    }
  }
  return Object.fromEntries(
    fields.map((field) => [field.name, fieldText(field, obj(value)[field.name])]),
  )
}

export type SettingFormResult =
  { ok: true; value: unknown } | { ok: false; errors: Record<string, string> }

/** One field's text as its value: undefined when it is empty, NaN when it does not read. */
function readField(field: SettingField, text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (field.kind === 'int') return /^\d+$/.test(trimmed) ? Number(trimmed) : NaN
  if (field.kind === 'dollars') {
    const plain = trimmed.replace(/^\$/, '').replaceAll(',', '')
    return /^\d+(\.\d{1,6})?$/.test(plain) ? Math.round(Number(plain) * 1_000_000) : NaN
  }
  return trimmed
}

const unreadable: Record<SettingFieldKind, string> = {
  int: 'Enter a whole number.',
  dollars: 'Enter an amount in dollars, such as 2.50.',
  text: 'Enter a value.',
  url: 'Enter an address.',
}

type Issue = {
  code: string
  path: PropertyKey[]
  message: string
  minimum?: number | bigint
  maximum?: number | bigint
}

/** A schema's complaint in words, in the field's own unit. */
function issueWords(issue: Issue, field: SettingField | undefined): string {
  const amount = (n: number | bigint) =>
    field?.kind === 'dollars' ? dollars(Number(n)) : count.format(Number(n))
  const unit = (n: number | bigint) =>
    field?.unit && field.kind === 'int'
      ? ` ${Number(n) === 1 ? field.unit.replace(/s$/, '') : field.unit}`
      : ''
  if (issue.code === 'too_small' && issue.minimum !== undefined)
    return `Use at least ${amount(issue.minimum)}${unit(issue.minimum)}.`
  if (issue.code === 'too_big' && issue.maximum !== undefined)
    return `Use at most ${amount(issue.maximum)}${unit(issue.maximum)}.`
  if (issue.message === 'Expected an odd number') return 'Use an odd number, so a majority decides.'
  if (field?.kind === 'url')
    return 'Use an https address without a user name, password, query or fragment.'
  if (field?.kind === 'int') return 'Enter a whole number.'
  return issue.message
}

/**
 * The form as the value the service would store, checked against the contract's schema for the
 * key; or, per field, what is wrong in words.
 */
export function settingFormValue(
  key: SettingKey,
  values: SettingFormValues,
  tools: readonly string[],
  current: unknown,
): SettingFormResult {
  const meta = settingMeta[key]
  const fields = fieldsOf(key, current, tools)
  const errors: Record<string, string> = {}
  const read: Record<string, unknown> = {}
  const judgeOther = meta.shape === 'judge' && values[JUDGE_MODE] !== 'model'
  for (const field of fields) {
    if (judgeOther) break
    const value = readField(field, values[field.name] ?? '')
    if (Number.isNaN(value)) errors[field.name] = unreadable[field.kind]
    else if (value === undefined && !field.optional)
      errors[field.name] =
        field.kind === 'text' ? `Enter the ${field.label.toLowerCase()}.` : unreadable[field.kind]
    else if (value !== undefined) read[field.name] = value
  }
  if (Object.keys(errors).length) return { ok: false, errors }

  const value: unknown =
    meta.shape === 'value' ? (read.value ?? null) : judgeOther ? 'different_family' : read
  const parsed = settingSchemas[key].safeParse(value)
  if (parsed.success) return { ok: true, value: parsed.data }
  for (const issue of parsed.error.issues as Issue[]) {
    // A plain value's issue has no path; an object's names its field.
    const name =
      meta.shape === 'value' ? 'value' : String(issue.path[0] ?? fields[0]?.name ?? 'value')
    const field = fields.find((candidate) => candidate.name === name)
    errors[name] ??= issueWords(issue, field)
  }
  return { ok: false, errors }
}

/** Every setting this screen describes, by group in the order they show. */
/**
 * The groups Limits lists. A source's settings are on the source's page in Sources (integrations
 * decision, 12 October 2026), and About our business has a section of its own.
 */
export const limitsSettingGroups = settingGroups.filter(
  (group) => group !== 'sources' && group !== 'business',
)

export function groupSettings<T extends { key: string }>(
  settings: readonly T[],
  groups: readonly SettingGroup[] = settingGroups,
): { group: SettingGroup; settings: T[] }[] {
  // The order this file describes them in, which reads better than the contract's.
  const order = new Map(Object.keys(settingMeta).map((key, index) => [key, index]))
  return groups
    .map((group) => ({
      group,
      settings: settings
        .filter((setting) => isSettingKey(setting.key) && settingMeta[setting.key].group === group)
        .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)),
    }))
    .filter((entry) => entry.settings.length > 0)
}

// ---- the history log ----

/**
 * The history log's actions in the glossary's words (src/domain/words-v1.ts). The log stores the
 * action's key, so these change only how a row reads, never what was recorded.
 */
const actionNames: Record<string, string> = {
  'setting.changed': 'Setting changed',
  'source.added': 'Source added',
  'source.changed': 'Source changed',
  'area.created': 'Domain created',
  'area.changed': 'Domain changed',
  'area.deleted': 'Domain deleted',
  // Before 16 Oct 2026 a domain its history named was removed as "archived".
  'area.archived': 'Domain deleted',
  'area.restored': 'Domain restored',
  'role.granted': 'Role given',
  'role.revoked': 'Role removed',
  'assignment.granted': 'Domain role given',
  'assignment.revoked': 'Domain role removed',
  'import.applied': 'Facts imported',
  'tool.switched_on': 'Tool switched on',
  'tool.switched_off': 'Tool switched off',
  'client_policy.added': 'Agent added',
  'client_policy.changed': 'Agent changed',
  'stop.on': 'Sharing with agents stopped',
  'stop.off': 'Sharing with agents started again',
  'edition.published': 'Shared with agents',
  'edition.rollback': 'Went back to an earlier version',
  'item.flagged': 'Fact flagged',
  'item.unflagged': 'Flag removed from a fact',
  'item.rechecked': 'Fact checked again',
  'item.retired': 'Fact archived',
  'item.binned': 'Moved to the Bin',
  'item.restored': 'Restored from the Bin',
  'item.links_stale': 'Mentions out of date',
  'proposal.created': 'Proposal created',
  'proposal.saved': 'Proposal saved',
  'proposal.edited': 'Proposal edited',
  'proposal.submitted': 'Sent for review',
  'proposal.checked': 'Proposal checked',
  'proposal.claimed': 'Proposal claimed',
  'proposal.handed_over': 'Proposal handed over',
  'proposal.commented': 'Comment added',
  'proposal.withdrawn': 'Proposal withdrawn',
  'proposal.discarded': 'Draft discarded',
  'proposal.test_attached': 'Test question added to a proposal',
  'proposal.test_detached': 'Test question removed from a proposal',
  'proposal.decided': 'Proposal decided',
  'decision.accept': 'Accepted',
  'decision.request_changes': 'Changes requested',
  'decision.reject': 'Rejected',
  'decision.retire': 'Archived',
  'gap.draft_started': 'Draft started from a gap',
  'ai_client.connected': 'Agent connected',
  'ai_client.disconnected': 'Agent disconnected',
  // Heed ended it on its own: a copied code or refresh token, the app's own revoke, a person gone.
  'ai_client.revoked': 'Agent connection ended',
  'gap.note_added': 'Note added to a gap',
  'gap.status_changed': 'Gap status changed',
  'gap.test_linked': 'Test question linked to a gap',
  'gap.test_unlinked': 'Test question unlinked from a gap',
  'gap.verified': 'Gap answered',
  'gap.verification_cleared': 'Gap answer cleared',
  'golden_question.created': 'Test question added',
  'golden_question.changed': 'Test question changed',
  'golden_question.set_aside': 'Test question set aside',
  'golden_question.restored': 'Test question restored',
  'eval_run.approved': 'Test run approved',
  'vocabulary.domain_changed': 'Name moved to another domain',
}

/** An action in words: a known one by name, any other from its parts ("Report exported"). */
export function auditActionWords(action: string): string {
  const known = actionNames[action]
  if (known) return known
  const words = action.replaceAll('.', ' ').replaceAll('_', ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Actions Heed carries out itself, though a person's request started them: the checks that run
 * when a proposal is submitted. The log credits them to Heed (A12); the entry still names the
 * person, and the panel says for whom.
 */
const actionsHeedRuns: ReadonlySet<string> = new Set(['proposal.checked'])

/** Whether the log shows Heed as who did it: Heed's own work, or a check Heed ran for someone. */
export function auditByHeed(entry: Pick<AuditEntry, 'action' | 'actorKind'>): boolean {
  return entry.actorKind !== 'person' || actionsHeedRuns.has(entry.action)
}

/** One row of the log's screen: an entry, and the older entries it stands for. */
export type AuditRow = {
  /** The newest entry of the row: the one it opens. */
  entry: AuditEntry
  /** Every entry of the row, newest first; one for most rows. */
  entries: AuditEntry[]
}

/**
 * The log's rows, newest first: autosaves of the same proposal by the same person one after the
 * other are one row ("Proposal saved 5 times"). A display rule only: the log keeps every entry
 * (FR-806), and the export has them all.
 */
export function auditRows(entries: readonly AuditEntry[]): AuditRow[] {
  const rows: AuditRow[] = []
  for (const entry of entries) {
    const last = rows.at(-1)
    if (
      last &&
      entry.action === 'proposal.saved' &&
      last.entry.action === 'proposal.saved' &&
      entry.subjectId === last.entry.subjectId &&
      entry.actorId === last.entry.actorId
    )
      last.entries.push(entry)
    else rows.push({ entry, entries: [entry] })
  }
  return rows
}

/** Where a role change came from, as the history log records it. */
export const auditSourceWords: Record<NonNullable<AuditEntry['source']>, string> = {
  named: 'Named in the app',
}

/** The action families the filter offers: the part before the dot. */
export const auditActionFamilies = [
  { value: 'setting', label: 'Settings' },
  { value: 'source', label: 'Sources' },
  { value: 'area', label: 'Domains' },
  { value: 'role', label: 'Roles' },
  { value: 'assignment', label: 'Domain roles' },
  { value: 'tool', label: 'Tools' },
  { value: 'client_policy', label: 'Agents' },
  { value: 'ai_client', label: 'Agent connections' },
  { value: 'stop', label: 'Stop switches' },
  { value: 'edition', label: 'Sharing with agents' },
  { value: 'proposal', label: 'Proposals' },
  { value: 'decision', label: 'Decisions' },
  { value: 'import', label: 'Imports' },
  { value: 'item', label: 'Facts' },
  { value: 'gap', label: 'Gaps' },
] as const

/** A file name for an export: the log and the day, such as heed-history-2026-10-11.csv. */
export function auditFileName(format: 'jsonl' | 'csv', today: string): string {
  return `heed-history-${today}.${format}`
}

// ---- operations and traffic ----

/** Bytes in words: 1.2 MB, 340 KB, 900 bytes. */
export function byteWords(bytes: number): string {
  if (bytes >= 1_000_000)
    return `${(bytes / 1_000_000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000).toLocaleString('en-GB')} KB`
  return plural(bytes, 'byte')
}

/** A duration in milliseconds in words: 214 ms, 1.8 s. */
export function durationWords(ms: number | null): string {
  if (ms === null) return 'No calls timed'
  if (ms >= 1_000) return `${(ms / 1_000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} s`
  return `${Math.round(ms)} ms`
}

/** An age in seconds in words: 25 minutes, 3 hours, 40 days. */
export function ageWords(seconds: number): string {
  if (seconds < 90) return plural(Math.round(seconds), 'second')
  if (seconds < 90 * 60) return plural(Math.round(seconds / 60), 'minute')
  if (seconds < 36 * 3600) return plural(Math.round(seconds / 3600), 'hour')
  return plural(Math.round(seconds / 86_400), 'day')
}

/** Dollars from millionths, as the operations view shows spending: $61.42. */
export const dollarWords = dollars

// ---- areas ----

export const hueNames: Record<DomainHue, string> = {
  teal: 'Teal',
  sky: 'Sky',
  indigo: 'Indigo',
  violet: 'Violet',
  pink: 'Pink',
  lime: 'Lime',
  stone: 'Stone',
  gray: 'Gray',
}

/** The area form as typed: every field is text until it is sent. */
export type AreaFormValues = {
  id: string
  name: string
  label: string
  reviewDays: string
  chatChannel: string
  ownerTeam: string
  summary: string
  description: string
  reason: string
}

/**
 * A new area's id from its name: "Customer value" becomes customer_value, the id a source's
 * view-to-domain file (CL_DOMAIN_OVERRIDES) uses. A name that does not start with a letter, or is a
 * single letter, gets area_ in front, as an id must start with a letter and have two characters.
 */
export function areaIdFrom(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug) return ''
  const id = /^[a-z][a-z0-9_]/.test(slug) ? slug : `area_${slug}`
  return id.slice(0, 40).replace(/_+$/, '')
}

const lineProblem = (text: string, max: number, what: string): string | undefined => {
  const trimmed = text.trim()
  if ([...trimmed].length > max) return `Keep the ${what} to ${max} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return `Keep the ${what} on one line.`
  return undefined
}

/**
 * What is wrong with an area form, per field, as the service would refuse it
 * (src/contract/areas.ts): a name of at most 60 characters no other area has, an id of
 * lowercase letters, digits and underscores no area has, a review time of 1 to 30 working days,
 * a channel and an owner team of at most 100 characters, and a reason.
 */
export function areaFormProblems(
  values: AreaFormValues,
  isNew: boolean,
  others: readonly { id: string; name: string }[],
): Partial<Record<keyof AreaFormValues, string>> {
  const problems: Partial<Record<keyof AreaFormValues, string>> = {}
  const name = values.name.trim()
  if (!name) problems.name = 'Enter a name.'
  else
    problems.name =
      lineProblem(name, 60, 'name') ??
      (others.some((area) => area.name.toLowerCase() === name.toLowerCase())
        ? 'Another domain has this name.'
        : undefined)
  if (isNew) {
    if (!values.id) problems.id = 'Enter an id.'
    else if (!/^[a-z][a-z0-9_]{1,39}$/.test(values.id))
      problems.id =
        'Start with a letter; use lowercase letters, digits and underscores, at most 40.'
    else if (others.some((area) => area.id === values.id))
      problems.id = 'Another domain has this id.'
  }
  if (!(domainHues as readonly string[]).includes(values.label)) problems.label = 'Choose a colour.'
  const days = values.reviewDays.trim()
  if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 30)
    problems.reviewDays = 'Enter a whole number of working days, from 1 to 30.'
  problems.chatChannel = lineProblem(values.chatChannel, 100, 'channel')
  problems.ownerTeam = lineProblem(values.ownerTeam, 100, 'team name')
  Object.assign(problems, domainAboutProblems(values))
  // A change says why; creating a domain is its own record in the history log.
  const reason = values.reason.trim()
  if (!isNew && !reason) problems.reason = "Say why you're changing it."
  else if ([...reason].length > 500) problems.reason = 'Keep the reason to 500 characters.'
  return Object.fromEntries(Object.entries(problems).filter(([, problem]) => problem))
}

/** The scheduled jobs in plain words; a job the screen does not know reads as its name. */
export const jobNames: Record<string, string> = {
  'connectors.sync': 'Read the definition sources',
  'evals.retrieval': 'Check what agents find',
  'evals.weekly': 'Weekly answer tests',
  'evals.work': 'Run answer tests',
  'gaps.detect': 'Find gaps',
  'jobs.watchdog': 'Watch the other jobs',
  'outbox.relay': 'Send live updates and notifications',
  'partitions.ensure': 'Prepare storage for the logs',
  'retention.run': 'Delete old records',
}

export const jobStatusWords = {
  ok: 'On time',
  waiting: 'Not run yet',
  failing: 'Failing',
  overdue: 'Overdue',
} as const

export const connectorStatusWords = {
  ok: 'Up to date',
  waiting: 'Not read yet',
  stale: 'Out of date',
  disabled: 'Switched off',
} as const

/** The features that spend on AI, in words. */
export const spendFeatureNames: Record<string, string> = {
  assistant: 'Assistant',
  eval: 'Answer tests',
}
