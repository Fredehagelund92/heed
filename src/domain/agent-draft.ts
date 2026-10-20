import { question, type AgentAnswers, type AgentQuestion } from './agent-questions.ts'
import type { Draft } from './draft.ts'
import { SUMMARY_MAX_LENGTH, type ItemKind } from './item.ts'
import {
  provenanceFlags,
  withoutInvisible,
  type FieldMark,
  type MarkedField,
  type ProvenanceFlag,
} from './provenance.ts'
import { termsInText } from './scope.ts'
import { isCalendarDate, shiftDate } from './validity.ts'
import { normalizeName, resolveTerm, suggestTerms, type Term } from './vocabulary.ts'

/*
  The deterministic part of an agent's draft (FR-121): no language model, only rules a person can
  read. The calling agent writes the words and may pass hints; this works out what can be worked
  out exactly, marks where every value came from, and lists the questions only the person can
  answer. It never invents a vocabulary key, an evidence link, a risk above the default, an
  audience, an owner or a link to another item.
*/

/** What an agent passes for a draft, in the MCP tool's words (`draft_context`). */
export type AgentDraftInput = {
  text: string
  title?: string
  summary?: string
  kind?: ItemKind
  scope?: {
    metrics?: string[]
    dimension_filters?: { dimension: string; values: string[] }[]
  }
  window?: { from: string; to?: string }
  evidence?: { url: string; quote: string }[]
  not_to_conclude?: string
  area?: string
}

export type DerivationContext = {
  terms: readonly Term[]
  /** The domain of a metric: the vocabulary's area, otherwise the source's domain (Cube). */
  areaOf: (metricKey: string) => string | null
  /** The active areas a draft may go to. */
  areas: readonly { id: string; name: string }[]
  /** The capture day: relative dates and missing years are read against it. */
  today: string
}

export type { AgentQuestion }

export type Derivation = {
  /** The draft before the service's defaults (owner, references, review date and so on). */
  draft: Draft
  marks: Partial<Record<MarkedField, FieldMark>>
  /** Why a value is what it is, in plain words, for the agent and the person. */
  reasons: Partial<Record<MarkedField, string>>
  /** At most four, the most important first. */
  questions: AgentQuestion[]
  /** Names the vocabulary does not know, with the nearest terms. */
  unresolved: { name: string; suggestions: string[] }[]
  /** Set when no single domain follows: the draft cannot be saved without one. */
  areaCandidates: string[] | null
  flags: ProvenanceFlag[]
}

const monthNames = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const month =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const monthOf = (name: string) => monthNames.findIndex((full) => full.startsWith(name.slice(0, 3)))
const pad = (value: number) => String(value).padStart(2, '0')

/** A day from its parts, or null when it is no calendar day. */
function day(year: number, monthIndex: number, date: number): string | null {
  const value = `${year}-${pad(monthIndex + 1)}-${pad(date)}`
  return isCalendarDate(value) ? value : null
}

export type TextDates = {
  start: string
  /** The day after the last day (NFR-048), when the text names a range; otherwise undefined. */
  end?: string
  /** The text named no year, so the year of the capture day was assumed. */
  assumedYear: boolean
}

/**
 * The dates a text names, read deterministically: an ISO day, "4 August 2026", "August 4, 2026",
 * and a range such as "from 3 to 14 August 2026" (the end is the day after the last day). A day
 * without a year takes the capture day's year, or the year before when that would be in the
 * future, and says so. Phrases such as "since the migration" give nothing.
 */
export function datesInText(text: string, today: string): TextDates | null {
  const lower = text.toLowerCase()
  const thisYear = Number(today.slice(0, 4))
  let assumedYear = false
  const withYear = (date: number, monthIndex: number, year: string | undefined) => {
    if (year) return day(Number(year), monthIndex, date)
    assumedYear = true
    const guess = day(thisYear, monthIndex, date)
    return guess && guess > today ? day(thisYear - 1, monthIndex, date) : guess
  }
  const range = new RegExp(
    `\\b(?:from |between )?(\\d{1,2})(?:st|nd|rd|th)?(?: ${month})?(?: (\\d{4}))? ?(?:to|until|till|and|-|\\u2013) ?(\\d{1,2})(?:st|nd|rd|th)? ${month}(?: (\\d{4}))?\\b`,
  )
  const ranged = range.exec(lower)
  if (ranged) {
    const lastMonth = monthOf(ranged[5]!)
    const lastYear = ranged[6] ?? ranged[3]
    const last = withYear(Number(ranged[4]), lastMonth, lastYear)
    const first = withYear(
      Number(ranged[1]),
      ranged[2] ? monthOf(ranged[2]) : lastMonth,
      ranged[3] ?? lastYear,
    )
    if (first && last && first <= last)
      return { start: first, end: shiftDate(last, 1), assumedYear }
  }
  const found: { at: number; value: string }[] = []
  for (const match of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const value = day(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    if (value) found.push({ at: match.index, value })
  }
  for (const match of lower.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${month}(?:,? (\\d{4}))?\\b`, 'g'),
  )) {
    const value = withYear(Number(match[1]), monthOf(match[2]!), match[3])
    if (value) found.push({ at: match.index, value })
  }
  for (const match of lower.matchAll(
    new RegExp(`\\b${month} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`, 'g'),
  )) {
    const value = withYear(Number(match[2]), monthOf(match[1]!), match[3])
    if (value) found.push({ at: match.index, value })
  }
  if (!found.length) return null
  found.sort((a, b) => a.at - b.at)
  return { start: found[0]!.value, assumedYear }
}

/**
 * The kind a text's shape suggests, with the rule that chose it. The line between an event and
 * an issue is a judgement (requirements 4.4): the person confirms it.
 */
export function kindByRule(text: string): { kind: ItemKind; reason: string } {
  const first = text.split(/\n|(?<=[.!?])\s/)[0] ?? text
  const lower = first.toLowerCase()
  if (/\?\.?$/.test(first.trim()))
    return { kind: 'example', reason: 'It reads as a question with a checked answer.' }
  if (/^(?:how to|how do|checklist|comparing|what to rule out|steps? to|before you)\b/.test(lower))
    return { kind: 'guide', reason: 'It reads as a way to investigate.' }
  const dated = /\b(?:on|from) (?:\d{1,2} [a-z]+|[a-z]+ \d{1,2}|\d{4}-\d{2}-\d{2})/.test(lower)
  // A data problem shows in the first sentence, or anywhere in words only a data problem uses.
  const all = text.toLowerCase()
  if (
    /\b(?:is|are|has been|have been|was|were) (?:down|delayed|missing|broken|late|stale|incomplete|unreliable|not tracked)\b/.test(
      lower,
    ) ||
    /\b(?:delays?|gaps? in|still|ongoing|until further notice|since)\b/.test(lower) ||
    (/\boutage\b/.test(lower) && !dated) ||
    /\b(?:counted (?:\w+ ){0,4}twice|double[- ]counted|not tracked|sen(?:d|ds|t) no|(?:is|are) missing until|arrive (?:\w+ ){0,3}late|dropped|drops some)\b/.test(
      all,
    )
  )
    return { kind: 'issue', reason: 'It reads as a data problem that lasts for a while.' }
  if (
    dated &&
    /\b(?:closed|opened|applied|switched|started|stopped|paused|took effect|launched|affected|introduced|ended|began|went live|moved)\b/.test(
      lower,
    )
  )
    return { kind: 'event', reason: 'It reads as something that happened on a day.' }
  return { kind: 'note', reason: 'No other kind fits its shape, so it is a lasting remark.' }
}

/** A mention-like sequence in an agent's words stays words: an agent never adds a mention. */
const asWords = (text: string) => withoutInvisible(text).replaceAll('@[', '@ [').trim()

/**
 * Why an agent's text cannot become a summary of whole sentences: no summary was given and the
 * first sentence alone is longer than a summary may be. The tool refuses it, so the agent writes
 * a summary, instead of saving words cut off part way. Null when the text splits cleanly.
 */
export function summaryCut(input: Pick<AgentDraftInput, 'text' | 'summary'>): string | null {
  if (input.summary !== undefined) return null
  if (!split(asWords(input.text)).cut) return null
  return `The first sentence of text is longer than a summary may be (${SUMMARY_MAX_LENGTH} characters), so it would be cut part way. Give summary: what happened, where and when, in at most ${SUMMARY_MAX_LENGTH} characters; text keeps the detail as the body.`
}

/**
 * The summary and the body from one text: whole sentences up to the summary's limit. `cut` when
 * not even the first sentence fits, so the summary is its first words.
 */
function split(text: string): { summary: string; body?: string; cut?: true } {
  if ([...text].length <= SUMMARY_MAX_LENGTH) return { summary: text }
  let summary = ''
  let end = 0
  for (const match of text.matchAll(/\S[\s\S]*?(?:(?<=[.!?])(?=\s)|$)/g)) {
    const next = summary ? `${summary} ${match[0]}` : match[0]
    if ([...next].length > SUMMARY_MAX_LENGTH) break
    summary = next
    end = match.index + match[0].length
  }
  if (!summary) {
    const words = [...text].slice(0, SUMMARY_MAX_LENGTH - 3).join('')
    summary = `${words.slice(0, Math.max(words.lastIndexOf(' '), 1)).trimEnd()}...`
    return { summary, body: text, cut: true }
  }
  const body = text.slice(end).trim()
  return body ? { summary, body } : { summary }
}

/**
 * Works out a draft from an agent's input. Pure: the same input gives the same draft. `answers`
 * are what the person answered in their AI app (agent-questions.ts): each one replaces what the
 * agent suggested, is marked `confirmed`, and closes its question.
 */
export function deriveAgentDraft(
  input: AgentDraftInput,
  context: DerivationContext,
  answers: AgentAnswers = {},
): Derivation {
  const marks: Derivation['marks'] = {}
  const reasons: Derivation['reasons'] = {}
  const questions: AgentQuestion[] = []
  const unresolved: Derivation['unresolved'] = []
  const draft: Draft = {}
  const text = asWords(input.text)

  // The words: the agent's, so the person checks them.
  const words = input.summary ? { summary: asWords(input.summary) } : split(text)
  const body = input.summary && text !== words.summary ? text : words.body
  draft.summary = words.summary
  marks.summary = 'prefilled'
  reasons.summary = 'Written by the agent. Check the wording, and that it does not claim a cause.'
  if (body) {
    draft.body = body
    marks.body = 'prefilled'
    reasons.body = 'Written by the agent from what the person said.'
  }
  if (input.title) draft.title = asWords(input.title)
  marks.title = 'prefilled'
  reasons.title = input.title
    ? 'Written by the agent.'
    : 'The first words of the summary. Shorten it if it reads badly.'

  // The kind: the agent's hint or the rule, always confirmed.
  const rule = kindByRule(input.title ? `${asWords(input.title)}\n${text}` : text)
  if (answers.kind) {
    draft.kind = answers.kind
    marks.kind = 'confirmed'
    reasons.kind = confirmed
  } else {
    draft.kind = input.kind ?? rule.kind
    marks.kind = 'prefilled'
    reasons.kind = input.kind ? 'Suggested by the agent.' : rule.reason
    if (input.kind && input.kind !== rule.kind)
      questions.push(
        question(
          'kind',
          `Is this ${article(input.kind)} or ${article(rule.kind)}? ${rule.reason}`,
          [input.kind, rule.kind],
        ),
      )
  }

  // Where it applies: names resolved against the vocabulary, never keys from memory.
  const metrics = new Set<string>()
  const values = new Map<string, Set<string>>()
  const anyValue = new Set<string>()
  const resolve = (name: string, kinds: Term['kind'][], parent?: string) =>
    resolveName(name, context.terms, kinds, parent, unresolved)
  for (const name of input.scope?.metrics ?? []) {
    const key = resolve(name, ['metric', 'metric_group'])
    if (key) metrics.add(key)
  }
  for (const filter of input.scope?.dimension_filters ?? []) {
    const dimension = resolve(filter.dimension, ['dimension'])
    if (!dimension) continue
    if (!filter.values.length) anyValue.add(dimension)
    for (const name of filter.values) {
      const value = resolve(name, ['dimension_value'], dimension)
      if (value) values.set(dimension, (values.get(dimension) ?? new Set()).add(value))
    }
  }
  // Names in the words count too; a dimension named without a value is never read as "any value".
  const named = termsInText(`${input.title ?? ''}\n${text}`, context.terms)
  for (const key of named.metrics) metrics.add(key)
  for (const [dimension, keys] of Object.entries(named.filters))
    for (const key of keys) values.set(dimension, (values.get(dimension) ?? new Set()).add(key))
  for (const dimension of anyValue) values.delete(dimension)
  const matchedByAgent = metrics.size > 0 || values.size > 0 || anyValue.size > 0
  // The terms the person chose from the choices offered: keys of the live vocabulary only.
  for (const key of answers.scope ?? []) {
    const term = context.terms.find((candidate) => candidate.key === key)
    if (!term) continue
    if (term.kind === 'metric' || term.kind === 'metric_group') metrics.add(key)
    else if (term.kind === 'dimension_value' && term.parentKey)
      values.set(term.parentKey, (values.get(term.parentKey) ?? new Set()).add(key))
  }
  draft.scope = {
    metrics: [...metrics].sort(),
    dimensions: [...anyValue].sort(),
    dimensionValues: [...values]
      .flatMap(([dimension, keys]) => [...keys].map((value) => ({ dimension, value })))
      .sort((a, b) => (a.value < b.value ? -1 : 1)),
  }
  const wholeScopeAnswered = answers.scope !== undefined && !matchedByAgent
  marks.scope = wholeScopeAnswered ? 'confirmed' : 'prefilled'
  reasons.scope = wholeScopeAnswered
    ? confirmed
    : 'Matched to the vocabulary from the names the agent passed and the words.'
  const ambiguous = named.ambiguous.map((issue) => issue.input)
  if (answers.scope) {
    // Answered: no question about where it applies is left.
  } else if (
    !draft.scope.metrics.length &&
    !draft.scope.dimensions.length &&
    !draft.scope.dimensionValues.length
  )
    questions.push(
      question(
        'scope',
        unresolved.length
          ? `Which metric or market is it about? Not in the vocabulary: ${unresolved.map((u) => u.name).join(', ')}.`
          : 'Which metric, market or other dimension value is it about?',
      ),
    )
  else if (ambiguous.length)
    questions.push(
      question(
        'scope',
        `Which term is meant by ${ambiguous.map((name) => `"${name}"`).join(', ')}?`,
        [...new Set(named.ambiguous.flatMap((issue) => issue.options))].slice(0, 10),
      ),
    )

  // The domain: exactly one area for every scoped metric, or the person's choice.
  let areaCandidates: string[] | null = null
  const answered = answers.area ? areaByName(answers.area, context.areas) : undefined
  if (answered) {
    draft.areaId = answered.id
    marks.areaId = 'confirmed'
    reasons.areaId = confirmed
  } else if (input.area) {
    const chosen = areaByName(input.area, context.areas)
    if (chosen) {
      draft.areaId = chosen.id
      marks.areaId = 'prefilled'
      reasons.areaId = 'Chosen by the person, as the agent says.'
    } else areaCandidates = context.areas.map((area) => area.id)
  } else {
    const area = areaOfMetrics(draft.scope.metrics, context)
    if (area.id) {
      draft.areaId = area.id
      marks.areaId = 'derived'
      reasons.areaId = 'Every metric it names belongs to this domain.'
    } else areaCandidates = area.candidates
  }
  if (areaCandidates)
    questions.unshift(
      question('area', 'Which domain is it about? Its owner reviews it.', areaCandidates),
    )

  // When it applies: the person's answer, the agent's dates, otherwise the dates the words name.
  if (answers.validity) {
    draft.validity = answers.validity
    marks.validity = 'confirmed'
    reasons.validity = confirmed
  } else if (input.window) {
    draft.validity = {
      start: input.window.from,
      end: input.window.to ? shiftDate(input.window.to, 1) : null,
    }
    marks.validity = 'prefilled'
    reasons.validity = input.window.to
      ? 'The dates the agent passed; the last day is included.'
      : 'The first day the agent passed, with no end.'
  } else {
    const dates = datesInText(`${input.title ?? ''}\n${text}`, context.today)
    if (dates) {
      draft.validity = { start: dates.start, end: dates.end ?? null }
      marks.validity = 'prefilled'
      reasons.validity = `${dates.end ? 'The range' : 'The first date'} the words name${dates.assumedYear ? `; the year is assumed from ${context.today}` : ''}.`
    } else questions.push(question('start', 'From which day does it apply?', [context.today]))
  }
  if (!answers.validity && draft.kind === 'issue' && draft.validity && draft.validity.end === null)
    questions.push(
      question('end', 'Is it still going on, or what was the last day?', ['still going on']),
    )

  // Where it comes from: only links and sentences the agent read or the person gave.
  if (answers.evidence) {
    draft.evidence = [
      ...(input.evidence ?? []).map((entry) => ({
        url: entry.url.trim(),
        quote: asWords(entry.quote),
        date: context.today,
      })),
      { url: answers.evidence.url, quote: asWords(answers.evidence.quote), date: context.today },
    ]
    marks.evidence = 'confirmed'
    reasons.evidence = 'The link and sentence the person gave. Check that the sentence is there.'
  } else if (input.evidence?.length) {
    draft.evidence = input.evidence.map((entry) => ({
      url: entry.url.trim(),
      quote: asWords(entry.quote),
      date: context.today,
    }))
    marks.evidence = 'prefilled'
    reasons.evidence = 'The link and sentence the agent passed. Check that the sentence is there.'
  } else
    questions.push(
      question('evidence', 'Where does this come from? A link and one sentence from it.'),
    )

  // What not to conclude: the default unless the agent wrote one.
  if (input.not_to_conclude) {
    draft.notToConclude = asWords(input.not_to_conclude)
    marks.notToConclude = 'prefilled'
    reasons.notToConclude = 'Written by the agent.'
  } else {
    marks.notToConclude = 'default'
    reasons.notToConclude = 'The default: cause not proven.'
  }

  // The rest is the service's to fill (FR-105), or people's to decide.
  Object.assign(marks, {
    references: 'derived',
    changeMarks: 'derived',
    ownerId: 'derived',
    reviewDate: 'derived',
    claimLevel: 'default',
    riskLevel: 'default',
    audience: 'default',
    replaces: 'not_inferred',
    conflicts: 'not_inferred',
  } satisfies Derivation['marks'])
  Object.assign(reasons, {
    references: 'The definitions of the metrics and dimensions in its scope.',
    ownerId: "The domain's owner.",
    reviewDate: 'The default review date for its kind.',
    claimLevel: 'The default: a fact, with no stated effect. Only an owner states an effect.',
    riskLevel: 'The default for its kind. Only an owner raises it.',
    audience: 'Everyone.',
    replaces: 'Left for people: only the items that overlap are listed.',
    conflicts: 'Left for people: only the items that overlap are listed.',
  } satisfies Derivation['reasons'])
  const flags = provenanceFlags(draft)
  return {
    draft,
    marks,
    reasons,
    questions: questions.slice(0, 4),
    unresolved,
    areaCandidates,
    flags,
  }
}

/**
 * A name matched to the vocabulary, as `draft_context` matches it: a key, a name or another name
 * of exactly one term. A name it cannot match goes on `unresolved` with the nearest terms.
 */
function resolveName(
  name: string,
  terms: readonly Term[],
  kinds: Term['kind'][],
  parent: string | undefined,
  unresolved: Derivation['unresolved'],
): string | null {
  const result = resolveTerm(name, terms, kinds, parent)
  if (result.status === 'resolved') return result.key
  unresolved.push({
    name,
    suggestions: suggestTerms(
      name,
      terms.filter(
        (term) => kinds.includes(term.kind) && (parent === undefined || term.parentKey === parent),
      ),
    ).slice(0, 5),
  })
  return null
}

/** A domain by its id or its name. */
const areaByName = (value: string, areas: DerivationContext['areas']) =>
  areas.find((area) => area.id === value || normalizeName(area.name) === normalizeName(value))

/** The one active domain every metric belongs to, or the domains to choose from. */
function areaOfMetrics(
  metrics: readonly string[],
  context: Pick<DerivationContext, 'areaOf' | 'areas'>,
): { id: string | null; candidates: string[] } {
  const areas = metrics.map((key) => context.areaOf(key))
  const distinct = [...new Set(areas.filter((area): area is string => area !== null))]
  const active = distinct.filter((area) => context.areas.some((a) => a.id === area))
  if (areas.length && !areas.includes(null) && active.length === 1 && distinct.length === 1)
    return { id: active[0]!, candidates: [] }
  return { id: null, candidates: active.length ? active : context.areas.map((area) => area.id) }
}

/** A draft whose domain, owner and scope may name things instead of giving their keys. */
export type NamedDraft = Omit<Draft, 'areaId' | 'ownerId' | 'scope'> & {
  areaId?: string
  ownerId?: string
  scope?: {
    metrics: string[]
    dimensions?: string[]
    dimensionValues: { dimension: string; value: string }[]
  }
}

/**
 * Resolves the names in a draft the way `draft_context` does (FR-121), so the assistant can pass
 * what the person said: a domain by name, a metric or a market by name or another name, an owner
 * by name. A change to an accepted item (`change`) keeps its item's domain unless one is named.
 * Each name that matches nothing, or more than one thing, is a problem the model can act on;
 * nothing is guessed.
 */
export function resolveDraftNames(
  draft: NamedDraft,
  context: Pick<DerivationContext, 'terms' | 'areaOf' | 'areas'> & {
    /** The active owners and deputies of each domain. */
    owners: readonly { id: string; name: string; areaId: string }[]
  },
  change = false,
): { draft: Draft; problems: string[] } {
  const problems: string[] = []
  const unresolved: Derivation['unresolved'] = []
  const resolve = (name: string, kinds: Term['kind'][], parent?: string) =>
    resolveName(name, context.terms, kinds, parent, unresolved)
  const { areaId: areaName, ownerId: ownerName, scope: named, ...rest } = draft
  const resolved: Draft = { ...rest }
  if (named) {
    const metrics = named.metrics.map((name) => resolve(name, ['metric', 'metric_group']))
    const dimensions = (named.dimensions ?? []).map((name) => resolve(name, ['dimension']))
    const values = named.dimensionValues.map((entry) => {
      const dimension = resolve(entry.dimension, ['dimension'])
      const value = dimension ? resolve(entry.value, ['dimension_value'], dimension) : null
      return dimension && value ? { dimension, value } : null
    })
    resolved.scope = {
      metrics: metrics.filter((key): key is string => key !== null),
      dimensions: dimensions.filter((key): key is string => key !== null),
      dimensionValues: values.filter((entry) => entry !== null),
    }
  }
  const names = (keys: string[]) =>
    keys.map((key) => context.terms.find((term) => term.key === key)?.name ?? key)
  for (const { name, suggestions } of unresolved)
    problems.push(
      `There is no single term called "${name}"${suggestions.length ? `; the nearest are ${names(suggestions).join(', ')}` : ''}.`,
    )
  const domains = context.areas.map((area) => area.name).join(', ')
  if (areaName !== undefined) {
    const area = areaByName(areaName, context.areas)
    if (area) resolved.areaId = area.id
    else problems.push(`No domain is called "${areaName}". The domains are ${domains}.`)
  } else if (!change) {
    const area = areaOfMetrics(resolved.scope?.metrics ?? [], context)
    if (area.id) resolved.areaId = area.id
    else
      problems.push(
        `Say which domain it is about, as areaId: ${area.candidates
          .map((id) => context.areas.find((a) => a.id === id)?.name ?? id)
          .join(', ')}.`,
      )
  }
  if (ownerName !== undefined) {
    const inArea = context.owners.filter(
      (s) => resolved.areaId === undefined || s.areaId === resolved.areaId,
    )
    const owner =
      inArea.find((s) => s.id === ownerName) ??
      inArea.find((s) => normalizeName(s.name) === normalizeName(ownerName))
    if (owner) resolved.ownerId = owner.id
    else
      problems.push(
        `"${ownerName}" is not an owner of that domain. Leave ownerId out: the domain's owner is set for you.`,
      )
  }
  return { draft: resolved, problems }
}

const confirmed = 'Answered by the person in their AI app.'
const article = (kind: ItemKind) => `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`
