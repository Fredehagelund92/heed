import type { UIMessage, UIMessageChunk } from 'ai'
import {
  boundFields,
  QUESTION_SCOPE_PART,
  questionScopeSchema,
  type AssistantLimit,
  type CitationReport,
} from '../../contract/assistant.ts'
import type { TryItInput } from '../../contract/connect.ts'
import type { Applicability } from '../../domain/applicability.ts'
import {
  asksAboutChange,
  changeLead,
  changeSubject,
  demoFallback,
  followUpKind,
  followUpReply,
  looksLikeDataQuestion,
  metaKind,
  metaReply,
  type MetaFacts,
} from '../../domain/assistant-meta.ts'
import type { Draft } from '../../domain/draft.ts'
import { limits, ownCaveat } from '../../domain/proposal-rules.ts'
import { coverageStatement } from '../../domain/resolver.ts'
import { productName } from '../lib/brand.ts'
import type { PreviewReply } from './client.ts'
import type { MockServedItem } from './mock-proposal-preview.ts'

/*
  The scripted assistant of the mock binding, the browser's twin of the service's scripted model
  (MODELS=mock, src/server/modules/models/assistant-mock.ts). It reads the person's last message,
  picks a read tool from plain words, runs it on the mock's live edition with the same resolver
  as What an agent would get, and answers in the service's stream: tool calls and their results,
  the answer one checked sentence at a time, then the citation report. It names only items its
  tools returned, so the check never removes a statement. It exists so the Ask tab, its stories
  and its browser tests have every state without a service or a model; it never claims what a
  real model would say. A greeting, thanks, "what can you do" and other messages about the
  assistant itself get a plain answer with no tool (domain/assistant-meta.ts), as the service's
  does; a message it cannot place says it is the demo model.
*/

/** The live edition as the assistant's read tools see it (mock-workflow.ts, assistantReads). */
export type MockAssistantReads = {
  today: string
  edition: string
  /** The domains, with what each is and the names of their owners. */
  areas: {
    id: string
    name: string
    summary: string
    owners: string[]
  }[]
  /** The items served to everyone on the live edition. */
  items: readonly MockServedItem[]
  /** get_facts's reply for a question and a typed scope. */
  context: (question: string, input: TryItInput) => PreviewReply
  /** explain_item: whether one item applies to the question and scope, and why. */
  explain: (id: string, question: string, input: TryItInput) => Applicability
  /** create_draft, once the person confirmed: saves their draft, unsubmitted. */
  saveDraft: (input: {
    draft: Draft
    sources: Record<string, string>
    datesUncertain: boolean
  }) => { id: string; number: number; title: string }
  /** A vocabulary key's name ("metric:orders" is "Orders"). */
  nameOf: (key: string) => string | undefined
  /** An attached key as the service resolves it (assistant/attachments.ts); null when unknown. */
  describe: (key: string) => {
    kind: 'metric' | 'dimension' | 'dimension_value'
    name: string
    definition: string | null
    /** A value's dimension. */
    dimension: string | null
    /** A dimension's values. */
    values: string[]
  } | null
}

/**
 * How the turn goes: an answer, or one of the states a test asks for with a mock scenario: a
 * spending limit reached before the model runs, a failure part way, or a refusal.
 */
export type MockAssistantMode = 'answer' | 'limit' | 'fails' | 'refuses'

/** The scope the browser sends with a question, as message metadata (lib/assistant-chat.ts). */
type SentScope = { about?: string; from?: string; to?: string }

/** The words a service's daily limit says, in the same fields. */
export const MOCK_DAILY_LIMIT: AssistantLimit = {
  kind: 'person_day',
  message: 'Your model spending reached the daily limit of $2.00; it resets within 24 hours.',
  resets: null,
}

/** How many facts an area summary lists before the answer reaches its length limit. */
const SUMMARY_LIMIT = 12

/** The service's words for why a fact does or doesn't apply (assistant/tools.ts, reasonText). */
const reasons: Record<string, string> = {
  not_in_edition: "Agents don't get it today.",
  need_more_detail: 'I need a metric, a market or dates first.',
  audience: "It's only for some groups of people.",
  stopped: "It's switched off, so agents don't get it for now.",
  high_risk_unverified: "It's high risk and needs checking first, so agents don't get it yet.",
  cut: 'It applies, but the answer was full, so it was left out.',
  retired: "It's archived.",
}
const partReasons = {
  metric: "It's about other metrics.",
  dates: "Its dates don't overlap the dates you asked about.",
  dimension: "It applies to another market or product, or to one your question doesn't name.",
}

function reasonText(result: Applicability, nameOf: (key: string) => string | undefined): string {
  if (result.applies)
    return result.match === 'exact'
      ? 'It applies to everything you asked about.'
      : `It applies only in part: ${result.restrictions
          .map(
            (r) =>
              `${nameOf(r.dimension) ?? r.dimension} ${r.values.map((v) => nameOf(v) ?? v).join(', ')} only`,
          )
          .join('; ')}.`
  if (result.reason === 'replaced') return `It was replaced by ${result.replacedBy}.`
  if (result.reason === 'scope') return result.parts.map((p) => partReasons[p]).join(' ')
  return reasons[result.reason] ?? 'It does not apply.'
}

/** The typed scope of the person's message: metric and value keys, and the days. */
function inputOf(scope: SentScope | undefined): TryItInput {
  const keys = scope?.about ? scope.about.split(',') : []
  const values = new Map<string, string[]>()
  for (const key of keys)
    if (key.startsWith('dim:')) values.set(key, values.get(key) ?? [])
    else if (key.startsWith('val:')) {
      const dimension = `dim:${key.slice(4).split('/')[0]}`
      values.set(dimension, [...(values.get(dimension) ?? []), key])
    }
  const metrics = keys.filter((key) => key.startsWith('metric:'))
  return {
    ...(metrics.length ? { metrics } : {}),
    ...(values.size
      ? { dimension_filters: [...values].map(([dimension, list]) => ({ dimension, values: list })) }
      : {}),
    ...(scope?.from ? { window: { from: scope.from, to: scope.to ?? scope.from } } : {}),
  }
}

const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const counted = (n: number, one: string, many: string) =>
  `${words[n] ?? n.toLocaleString('en')} ${n === 1 ? one : many}`
/** The first sentence of a summary. */
const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text
/**
 * What a summary adds to its title: its first sentence that is not the title again, as a chip
 * already shows the title. Empty when it adds nothing.
 */
function afterTitle(summary: string, title: string): string {
  const sentences = summary.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [summary]
  const same = (sentence: string) =>
    sentence
      .trim()
      .replace(/[.!?]+$/, '')
      .toLowerCase() === title.trim().toLowerCase()
  return sentences.find((sentence) => !same(sentence))?.trim() ?? ''
}

/**
 * What the person attached, as an answer says it: what each one is, its definition in its
 * source's own words and a dimension's values. Empty when nothing known was attached.
 */
function attachedLines(reads: MockAssistantReads, scope: SentScope | undefined): string[] {
  const keys = scope?.about ? scope.about.split(',') : []
  const lines = keys.flatMap((key) => {
    const term = reads.describe(key)
    if (!term) return []
    const what =
      term.kind === 'metric'
        ? `${term.name}: a metric.`
        : term.kind === 'dimension'
          ? `${term.name}: every ${term.name}, not one in particular.`
          : `${term.name}: a ${(term.dimension ?? 'name').toLowerCase()}.`
    const definition = term.definition
      ? ` Its definition: "${term.definition}"`
      : ' Its source gives no definition.'
    const values = term.values.length ? ` Its values: ${listed(term.values)}.` : ''
    return [`${what}${definition}${values}`]
  })
  return lines.length && scope?.from
    ? [...lines, `Dates: ${longDay(scope.from)} to ${longDay(scope.to ?? scope.from)}.`]
    : lines
}
const listed = (names: string[]) => {
  const shown = names.slice(0, 8)
  const all =
    names.length > shown.length ? [...shown, `${names.length - shown.length} more`] : shown
  return all.length < 2 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`
}

/** Whether the words ask what the attachment is ("What is this?"), not which facts apply to it. */
const asksWhatItIs = (words: string) =>
  /\b(this|these|that|it|them)\b/i.test(words) &&
  /^\s*(what|explain|define|describe|tell me|meaning)\b|\bmeans?\b/i.test(words) &&
  !/\b(apply|applies|facts?|context|changed|happened|caveats?|why)\b/i.test(words)

type Call = { tool: string; input: Record<string, unknown>; output: Record<string, unknown> }
type Turn = {
  calls: Call[]
  text: string
  finish: 'stop' | 'length'
  /** A create_draft call that waits for the person to confirm it, after the words. */
  propose?: { draft: Draft; sources: Record<string, string>; dates_uncertain?: true }
}

/** What a meta answer says of the mock's install: its domains and a question to try. */
function metaFacts(reads: MockAssistantReads): MetaFacts {
  const metric = reads.items.flatMap((item) =>
    item.scope.metrics.flatMap((key) => reads.nameOf(key) ?? []),
  )[0]
  const domain = reads.areas[0]?.name
  const held = (id: string) => reads.items.filter((item) => item.areaId === id).length
  return {
    product: productName,
    domains: reads.areas.map((area) => area.name),
    lines: reads.areas.map(
      (area) =>
        `${area.name}: ${area.summary ? `${area.summary.replace(/[.!?]$/, '')}. ` : ''}${held(area.id).toLocaleString('en')} ${held(area.id) === 1 ? 'fact' : 'facts'}.`,
    ),
    example: metric
      ? `Which facts apply to ${metric} last week?`
      : domain
        ? `What does the ${domain} domain cover?`
        : 'What changed this week?',
  }
}

/** get_facts, then explain_item for up to two nearby facts that do not apply. */
function lookUp(
  reads: MockAssistantReads,
  question: string,
  scope: SentScope | undefined,
  input: TryItInput,
): Turn {
  const reply = reads.context(question, input)
  const calls: Call[] = [
    {
      tool: 'get_facts',
      input: { question, ...input, max_items: 20 },
      output: reply,
    },
  ]
  if (reply.status === 'need_more_detail' || !reply.scope_used) {
    // With something attached, the person is told about it and what would narrow it, never
    // asked which metric, market and dates they mean. Without, only a data question is asked for
    // them; words it cannot place get the demo model's plain answer.
    const attached = attachedLines(reads, scope)
    return {
      calls,
      text: attached.length
        ? [
            'You attached:',
            ...attached.map((line) => `- ${line}`),
            'Facts apply to a metric and dates as well: name them to see which facts apply.',
          ].join('\n')
        : looksLikeDataQuestion(question)
          ? 'Which metric, market and dates do you mean? You can name them in your question.'
          : demoFallback(metaFacts(reads)),
      finish: 'stop',
    }
  }
  const used = reply.scope_used
  const delivered = reply.items ?? []
  const deliveredIds = new Set(delivered.map((item) => item.id))
  const values = Object.values(used.filters).flat()
  // Nearby: served facts about the same metric or value that the reply left out.
  const nearby = reads.items
    .filter(
      (item) =>
        !deliveredIds.has(item.id) &&
        (item.scope.metrics.some((metric) => used.metrics.includes(metric)) ||
          item.scope.dimensionValues.some((row) => values.includes(row.value))),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, 2)
  // The facts nearby that do not apply are explained too: the steps keep them for the folded list.
  for (const item of nearby) {
    const result = reads.explain(item.id, question, input)
    const output = {
      edition: reply.edition,
      id: item.id,
      title: item.title,
      validity: item.validity,
      scope: item.scope,
      applies: result.applies,
      reason: reasonText(result, reads.nameOf),
      ...(result.applies ? {} : { code: result.reason }),
      coverage: coverageStatement,
    }
    calls.push({ tool: 'explain_item', input: { id: item.id, question, ...input }, output })
  }
  // Asked without dates, the reply is the demo's day, and the answer says so, as it is told to.
  const assumed = reply.assumed_date
    ? [
        `I used the demo's date, ${longDay(reply.assumed_date.date)}, because no dates were given. Tell me if you meant a different period.`,
      ]
    : []
  // What the question was about, by name: "Orders, Norway".
  const scopeNames = {
    metrics: used.metrics.map((key) => reads.nameOf(key) ?? key),
    values: values.map((key) => reads.nameOf(key) ?? key),
  }
  const scopeWords = [...scopeNames.metrics, ...scopeNames.values].join(', ')
  // A question about a change or its cause: the facts are notes, never the numbers, so the
  // answer says first what they cannot show.
  const lead = asksAboutChange(question)
    ? [`**${changeLead(question, changeSubject(scopeNames.metrics, scopeNames.values))}**`]
    : []
  // The facts that do not apply stay in the steps' facts, folded under the answer: the words
  // name only what applies.
  if (!delivered.length) {
    const nothing = `Nothing is written down for ${scopeWords || 'that'}.`
    const next =
      'Nobody has added a fact about it yet. If you know of something, I can help you write it down.'
    return {
      calls,
      text: (lead.length
        ? [...lead, `${nothing} ${next}`, ...assumed]
        : [`**${nothing}**`, next, ...assumed]
      ).join('\n\n'),
      finish: 'stop',
    }
  }
  const head = lead.length
    ? `${counted(delivered.length, 'fact is', 'facts are')} related to ${scopeWords || 'it'}. A fact can't prove a cause.`
    : `**${counted(delivered.length, 'fact applies', 'facts apply')}${scopeWords ? ` to ${scopeWords}` : ''}.**`
  const lines = delivered.map((item, index) => {
    const part = item.match === 'partial' ? 'Applies only in part.' : ''
    const quote =
      index === 0 ? item.evidence.find((entry) => entry.quote.length >= 20)?.quote : undefined
    return `- ${[
      `[${item.id}]`,
      part,
      afterTitle(item.summary, item.title),
      quote ? `Its source says "${quote}"` : '',
    ]
      .filter(Boolean)
      .join(' ')}`
  })
  return {
    calls,
    text: [...lead, head, lines.join('\n'), ...assumed].join('\n\n'),
    finish: 'stop',
  }
}

/** A day as a person writes it, "15 June 2026", like the titles the answer quotes (contract 8.2). */
const longDayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const longDay = (isoDate: string) =>
  longDayFormat.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`))

/** read_item for one fact the person named by id or by its title in quotes. */
function readOne(reads: MockAssistantReads, item: MockServedItem): Turn {
  const output = {
    edition: reads.edition,
    status: 'matched',
    item: {
      id: item.id,
      version: item.version,
      edition: reads.edition,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      validity: item.validity,
      claim_level: item.claimLevel,
      risk: item.riskLevel,
      evidence: item.evidence.map(({ url, quote, date }) => ({ url, quote, read_on: date })),
      ...(ownCaveat(item.notToConclude) ? { not_to_conclude: ownCaveat(item.notToConclude)! } : {}),
      links: [],
    },
  }
  const until = item.validity.end
    ? ` to ${longDay(item.validity.end)}`
    : ', and it is still going on'
  return {
    calls: [{ tool: 'read_item', input: { id: item.id }, output }],
    text: [
      `${firstSentence(item.summary)} [${item.id}]`,
      `It applies from ${longDay(item.validity.start)}${until}. Your numbers may look different from that day for this reason alone.`,
      "It doesn't say it caused any change, so compare with a market it doesn't apply to before you read a cause into it.",
    ].join('\n\n'),
    finish: 'stop',
  }
}

/** find_facts for one domain's name: a summary of what it covers, cut at the length limit. */
function summarise(
  reads: MockAssistantReads,
  area: { id: string; name: string; summary: string },
): Turn {
  const found = reads.items.filter((item) => item.areaId === area.id)
  const page = found.slice(0, 20)
  const output = {
    edition: reads.edition,
    status: 'matched',
    found_by: 'words',
    query_used: { domains: [area.id], terms: [], words: [], ignored: [], unknown_members: [] },
    items: page.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      domain: area.name,
      validity: item.validity,
      match: 'all',
    })),
    total: found.length,
    domains: [
      {
        id: area.id,
        name: area.name,
        ...(area.summary ? { summary: area.summary } : {}),
        items: found.length,
      },
    ],
    check_report: { status: 'matched', matched: found.length, statements: [coverageStatement] },
  }
  const kinds = new Map<string, number>()
  for (const item of found) kinds.set(item.kind, (kinds.get(item.kind) ?? 0) + 1)
  const mix = [...kinds]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`)
    .join(', ')
  const listed = page.slice(0, SUMMARY_LIMIT)
  return {
    calls: [{ tool: 'find_facts', input: { query: area.name, limit: 20 }, output }],
    text: [
      `**${area.name} has ${counted(found.length, 'fact', 'facts').toLowerCase()}.**`,
      `By kind: ${mix || 'none yet'}.`,
      ...listed.map(
        (item) =>
          `- [${item.id}] ${afterTitle(item.summary, item.title) || firstSentence(item.summary)}`,
      ),
    ].join('\n\n'),
    finish: found.length > SUMMARY_LIMIT ? 'length' : 'stop',
  }
}

/** improve_question: what would make the question clearer, from the scope it names. */
function sharpen(reads: MockAssistantReads, question: string, scope: SentScope | undefined): Turn {
  const reply = reads.context(question, inputOf(scope))
  const output = {
    edition: reply.edition,
    status: reply.status,
    options: reply.options ?? [],
    scope_used: reply.scope_used ?? null,
    suggestions: [
      'Name the metric definition and the date range.',
      'Specify the market and compare it with an unaffected market and earlier dates.',
    ],
  }
  return {
    calls: [{ tool: 'improve_question', input: { question }, output }],
    text: [
      '**A clearer question names what, where and when.**',
      'Name the metric and the dates, for example *average order value, 1 to 30 June 2026*.',
      "Name the market too, and compare it with a market that wasn't affected and with earlier dates, so a change has something to stand against.",
    ].join('\n\n'),
    finish: 'stop',
  }
}

/**
 * domain_overview for no one domain: every domain side by side. The words are those of a real
 * answer, table and all: the table straight after the sentence that introduces it, lines after
 * it, a page's path in brackets and a question to end.
 */
function compareDomains(reads: MockAssistantReads): Turn {
  const rows = reads.areas.map((area) => {
    const items = reads.items.filter((item) => item.areaId === area.id)
    return { area, items: items.length, issues: items.filter((i) => i.kind === 'issue').length }
  })
  const output = {
    edition: reads.edition,
    domains: rows.map(({ area, items }) => ({
      id: area.id,
      name: area.name,
      ...(area.summary ? { summary: area.summary } : {}),
      items,
      owners: area.owners,
    })),
  }
  const most = rows.toSorted((a, b) => b.items - a.items)[0]
  return {
    calls: [{ tool: 'domain_overview', input: {}, output }],
    text: [
      `There are ${counted(rows.length, 'domain', 'domains').toLowerCase()}.`,
      '| Domain | What it is | Facts | Owners | Issues |',
      '|---|---|---|---|---|',
      ...rows.map(
        ({ area, items, issues }) =>
          `| ${area.name} | ${area.summary || 'Not described yet'} | ${items} | ${area.owners.join(', ') || 'None yet'} | ${issues} |`,
      ),
      `${most ? `${most.area.name} has the most facts, at ${most.items}. ` : ''}You can see what needs checking in [Needs a look](/library?view=attention).`,
      "Do you want a closer look at one domain? If you don't say, I'll leave it here.",
    ].join('\n'),
    finish: 'stop',
  }
}

/** Writing a fact starts with four questions (FR-702); no tool runs until the person answers. */
const coach: Turn = {
  calls: [],
  text: [
    '**I can help you write that down as a draft.** Tell me four things:',
    '- What happened, in one or two plain sentences.',
    '- Where it applies: the metrics, markets or products.',
    '- From when, and until when if it has ended.',
    '- How you know: a link to the source and a short quote from it.',
    "I'll suggest careful wording and a date to check it again. The owner of its domain checks the draft before AI agents get it.",
  ].join('\n'),
  finish: 'stop',
}

/** Words that say the person does not know when it happened. */
const unsureDate =
  /\b(?:not sure|unsure|no idea|don'?t know|do not know|can'?t remember)\b[^.?!]{0,40}\b(?:date|day|when)\b/i
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
/** "1 October 2026" in the person's words, as a UTC day. */
function dayIn(text: string): string | null {
  const found =
    /\b(\d{1,2}) (january|february|march|april|may|june|july|august|september|october|november|december) (\d{4})\b/i.exec(
      text,
    )
  if (!found) return null
  const month = monthNames.indexOf(found[2]!.toLowerCase()) + 1
  return `${found[3]}-${String(month).padStart(2, '0')}-${found[1]!.padStart(2, '0')}`
}

/** Whole sentences up to a summary's limit, the rest as the body: the drafting guide's shape. */
function summaryAndBody(text: string): { summary: string; body?: string } {
  let summary = ''
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const next = summary ? `${summary} ${sentence}` : sentence
    if ([...next].length > limits.summary) break
    summary = next
  }
  if (!summary) summary = [...text].slice(0, limits.summary).join('')
  const body = text.slice(summary.length).trim()
  return body ? { summary, body } : { summary }
}

/**
 * "Draft this: ..." with the facts after the colon: a draft for the person to confirm, as the
 * service's create_draft proposes one. Names of the mock's metrics and markets become the scope,
 * a link is read first and gives the evidence, and with no date, or the person unsure of it, the
 * draft starts today with its dates flagged uncertain, and the answer says so.
 */
function proposeDraft(reads: MockAssistantReads, question: string): Turn {
  const text = question.slice(question.indexOf(':') + 1).trim()
  const link = /\bhttps?:\/\/[^\s<>"'()]+/i.exec(text)?.[0]?.replace(/[.,;:!?]+$/, '')
  const quote = /[“"]([^"”]{20,})[”"]/.exec(text)?.[1] ?? null
  // The facts without the source's words: those are the evidence.
  const facts = text
    .replace(/\s*Source:.*$/is, '')
    .replace(/\s*Do not conclude[^.]*\./i, '')
    .trim()
  const caveat = /\bDo not conclude ([^.]*)\./i.exec(text)?.[1]
  // Every metric and value the served items name, by name, to find in the words.
  const keys = new Set(
    reads.items.flatMap((item) => [
      ...item.scope.metrics,
      ...item.scope.dimensionValues.map((row) => `${row.dimension}|${row.value}`),
    ]),
  )
  const metrics: string[] = []
  const dimensionValues: { dimension: string; value: string }[] = []
  let areaId: string | null = null
  const named = (key: string) => {
    const name = reads.nameOf(key)
    return name !== undefined && new RegExp(`\\b${escaped(name)}\\b`, 'i').test(facts)
  }
  for (const key of keys) {
    const [dimension, value] = key.includes('|') ? key.split('|') : [null, key]
    if (!value || !named(value)) continue
    if (dimension) {
      if (!dimensionValues.some((row) => row.value === value))
        dimensionValues.push({ dimension, value })
    } else if (!metrics.includes(value)) {
      metrics.push(value)
      areaId ??= reads.items.find((item) => item.scope.metrics.includes(value))?.areaId ?? null
    }
  }
  areaId ??= reads.areas[0]?.id ?? null
  const day = dayIn(facts)
  const uncertain = !day || unsureDate.test(facts)
  const start = uncertain ? reads.today : day
  const words = summaryAndBody(facts.replace(/\s*I(?:'m| am) not sure[^.]*\./i, '').trim())
  const title = [...(words.summary.split(/(?<=[.!?])\s/)[0] ?? words.summary)]
    .slice(0, 120)
    .join('')
    .replace(/\.$/, '')
  const calls: Call[] = link
    ? [
        {
          tool: 'read_source',
          input: { url: link },
          output: {
            url: link,
            title: title,
            read_on: reads.today,
            passages: [quote ?? words.summary],
          },
        },
      ]
    : []
  const draft = {
    kind: /\b(law|ban|bans|banned|prohibit\w*|closed|stopped|measure|rule)\b/i.test(facts)
      ? ('event' as const)
      : ('note' as const),
    title,
    ...words,
    ...(areaId ? { areaId } : {}),
    scope: { metrics, dimensions: [], dimensionValues },
    validity: { start, end: null },
    reviewDate: addMonths(start, 3),
    ...(link
      ? { evidence: [{ url: link, quote: quote ?? words.summary, date: reads.today }] }
      : {}),
    ...(caveat ? { notToConclude: `Do not conclude ${caveat}.` } : {}),
  }
  const sources = {
    title: 'suggested',
    summary: 'your_text',
    ...(words.body ? { body: 'your_text' } : {}),
    ...(metrics.length || dimensionValues.length ? { scope: 'your_text' } : {}),
    validity: uncertain ? 'suggested' : 'your_text',
    reviewDate: 'suggested',
    areaId: 'suggested',
    ...(link ? { evidence: 'suggested' } : {}),
    ...(caveat ? { notToConclude: 'your_text' } : {}),
  }
  return {
    calls,
    propose: { draft, sources, ...(uncertain ? { dates_uncertain: true } : {}) },
    text: uncertain
      ? `You weren't sure of the date, so I started it today, ${formatLong(start)}, and marked the dates as uncertain for the owner. Check the draft below, then create it.`
      : 'Check the draft below, then create it. Nothing is saved until you do.',
    finish: 'stop',
  }
}

/** A name as a pattern that matches it literally. */
const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A day three months on: the review date the mock suggests. */
function addMonths(day: string, months: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}
const formatLong = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

function choose(
  reads: MockAssistantReads,
  question: string,
  scope: SentScope | undefined,
  input: TryItInput,
  about: readonly string[] = [],
  reply: string | null = null,
): Turn {
  if (/\bdomains\b/i.test(question) && /\b(compare|side by side|table|stand)\b/i.test(question))
    return compareDomains(reads)
  // "What do you mean?", "say it simpler", "shorter", "why?": about the last reply, so answered
  // from it, with no lookup. What the question names or attaches is more than that.
  const followUp = followUpKind(question)
  if (followUp && !scope && !about.length)
    return { calls: [], text: followUpReply(followUp, reply, metaFacts(reads)), finish: 'stop' }
  // A greeting, thanks or "what can you do": answered at once, with no tool and no scope question.
  const meta = metaKind(question)
  if (meta) return { calls: [], text: metaReply(meta, metaFacts(reads)), finish: 'stop' }
  // An item or a domain the question names with a chip is what it is about, as the service
  // tells the model (assistant/attachments.ts).
  const chipped = (prefix: string) =>
    about.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
  const id = /\bitm_[a-z0-9]{8,16}\b/.exec(question)?.[0] ?? chipped('item:')[0]
  const quoted = /[“"](.+?)[”"]/.exec(question)?.[1]?.toLowerCase()
  const named =
    reads.items.find((item) => item.id === id) ??
    (quoted ? reads.items.find((item) => item.title.toLowerCase() === quoted) : undefined)
  if (named) return readOne(reads, named)
  const domain = reads.areas.find((a) => chipped('area:').includes(a.id))
  if (domain) return summarise(reads, domain)
  if (/\b(summar|cover)/i.test(question)) {
    const area = reads.areas.find((a) => question.toLowerCase().includes(a.name.toLowerCase()))
    if (area) return summarise(reads, area)
  }
  if (/\b(clearer|improve|rephrase|sharpen|coach)\b/i.test(question))
    return sharpen(reads, question, scope)
  // "Draft this: what happened...": the facts are there, so the draft is offered to confirm.
  if (/\bdraft (?:this|it)\b[^:]{0,20}:\s*\S/i.test(question)) return proposeDraft(reads, question)
  if (/\b(write|draft|note down|propose)\b/i.test(question)) return coach
  // "What is this?" about what the person attached: the service names it, no tool is needed.
  const attached = attachedLines(reads, scope)
  if (attached.length && asksWhatItIs(question))
    return {
      calls: [],
      text: ['You attached:', ...attached.map((line) => `- ${line}`)].join('\n'),
      finish: 'stop',
    }
  return lookUp(reads, question, scope, input)
}

/**
 * The person's last message: the question's words, the scope sent with it, and what get_facts
 * reads for it: the scope the composer showed (`data-scope`), bound as the service binds it.
 */
function lastQuestion(messages: readonly UIMessage[]) {
  const message = [...messages].reverse().find((m) => m.role === 'user')
  const text = message?.parts.find((part) => part.type === 'text')
  const question = text?.type === 'text' ? text.text : ''
  const scope = (message?.metadata as { scope?: SentScope } | undefined)?.scope
  const part = message?.parts.find((p) => p.type === QUESTION_SCOPE_PART) as
    { data?: unknown } | undefined
  const read = part ? questionScopeSchema.safeParse(part.data) : null
  const bound = read?.success ? boundFields(read.data, question) : null
  const about = read?.success ? (read.data.about ?? []) : []
  const input: TryItInput = !bound
    ? inputOf(scope)
    : 'question' in bound
      ? {
          metrics: bound.metrics,
          dimension_filters: bound.dimension_filters,
          ...(bound.window ? { window: bound.window } : {}),
        }
      : { ...inputOf(scope), window: bound.window }
  // What the assistant said last, before this question: a follow-up on it reads it.
  const said = messages.slice(
    0,
    messages.findLastIndex((m) => m.role === 'user'),
  )
  const answered = said.findLast((m) => m.role === 'assistant')
  const reply =
    answered?.parts
      .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
      .filter(Boolean)
      .join('\n\n') || null
  return { question, scope, input, about, reply }
}

/**
 * The person's answer to a draft the last answer proposed, when the conversation ends on it: the
 * call as it was proposed, and whether they said create it.
 */
function confirmationOf(messages: readonly UIMessage[]) {
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return null
  const part = last.parts.find(
    (p) =>
      p.type === 'dynamic-tool' &&
      p.toolName === 'create_draft' &&
      p.state === 'approval-responded',
  )
  if (part?.type !== 'dynamic-tool' || part.state !== 'approval-responded') return null
  const input = (part.input ?? {}) as {
    draft?: Draft
    sources?: Record<string, string>
    dates_uncertain?: boolean
  }
  return {
    toolCallId: part.toolCallId,
    approved: part.approval.approved,
    draft: input.draft ?? {},
    sources: input.sources ?? {},
    datesUncertain: input.dates_uncertain === true,
  }
}

/** Sentences and lines, each with what follows it, as the citation check lets them out. */
const pieces = (text: string) =>
  text.match(/[^\n]*?(?:[.!?:](?=\s)|\n|$)\s*/g)?.filter(Boolean) ?? []

/**
 * One turn of the scripted assistant, as the service streams it. `pause` waits between parts, so
 * the answer streams at the mock's latency; aborting `signal` ends it, as a stop does.
 */
export async function* mockAssistantTurn(
  reads: MockAssistantReads,
  messages: readonly UIMessage[],
  {
    signal,
    pause,
    mode = 'answer',
  }: { signal?: AbortSignal; pause: () => Promise<void>; mode?: MockAssistantMode },
): AsyncGenerator<UIMessageChunk> {
  const { question, scope, input, about, reply } = lastQuestion(messages)
  yield { type: 'start', messageMetadata: { model: { name: 'scripted-demo', mock: true } } }
  const notice = function* (text: string): Generator<UIMessageChunk> {
    yield { type: 'text-start', id: 'notice' }
    yield { type: 'text-delta', id: 'notice', delta: text }
    yield { type: 'text-end', id: 'notice' }
  }
  if (mode === 'limit') {
    yield* notice(MOCK_DAILY_LIMIT.message)
    yield { type: 'data-limit', data: MOCK_DAILY_LIMIT }
    yield { type: 'finish', finishReason: 'stop' }
    return
  }
  // The person answered a draft this answer proposed: save it, or not, and say so.
  const answered = confirmationOf(messages)
  if (answered) {
    await pause()
    if (signal?.aborted) return
    yield { type: 'start-step' }
    let words: string
    if (answered.approved) {
      const saved = reads.saveDraft({
        draft: answered.draft,
        sources: answered.sources,
        datesUncertain: answered.datesUncertain,
      })
      yield {
        type: 'tool-output-available',
        toolCallId: answered.toolCallId,
        output: {
          proposal_id: saved.id,
          number: saved.number,
          state: 'draft',
          title: saved.title,
          label: 'unreviewed draft',
        },
        dynamic: true,
      }
      words = `I saved it as your draft #${saved.number}. Open it, check each part, then send it for review.`
    } else {
      yield { type: 'tool-output-denied', toolCallId: answered.toolCallId }
      words = "Okay, I didn't save it. Tell me what to change, and I'll try again."
    }
    yield { type: 'finish-step' }
    yield { type: 'start-step' }
    yield { type: 'text-start', id: 'text-saved' }
    yield { type: 'text-delta', id: 'text-saved', delta: words }
    yield { type: 'text-end', id: 'text-saved' }
    yield { type: 'finish-step' }
    yield { type: 'data-citations', data: { cited: [], removed: [], quoted: 0 } }
    yield { type: 'finish', finishReason: 'stop' }
    return
  }
  const turn = choose(reads, question, scope, input, about, reply)
  let call = 0
  for (const { tool, input, output } of turn.calls) {
    await pause()
    if (signal?.aborted) return
    const toolCallId = `call_${tool}_${(call++).toString(36).padStart(4, '0')}`
    yield { type: 'start-step' }
    yield { type: 'tool-input-available', toolCallId, toolName: tool, input, dynamic: true }
    // The tool runs a moment, as the service's do: its step shows in the present until it is done.
    await pause()
    if (signal?.aborted) return
    yield { type: 'tool-output-available', toolCallId, output, dynamic: true }
    yield { type: 'finish-step' }
  }
  yield { type: 'start-step' }
  if (mode === 'refuses') {
    yield* notice("I can't answer this one. Try asking it another way.")
    yield { type: 'finish-step' }
    yield { type: 'data-refusal', data: { refused: true } }
    yield { type: 'data-citations', data: { cited: [], removed: [], quoted: 0 } }
    yield { type: 'finish', finishReason: 'content-filter' }
    return
  }
  const cited = new Set<string>()
  let quoted = 0
  yield { type: 'text-start', id: 'text-0' }
  const all = pieces(turn.text)
  for (const [index, piece] of all.entries()) {
    await pause()
    if (signal?.aborted) return
    // Part way through the answer the model's service stops answering.
    if (mode === 'fails' && index === Math.min(2, all.length - 1)) {
      yield { type: 'error', errorText: "The assistant couldn't finish. Try again in a moment." }
      return
    }
    for (const [id] of piece.matchAll(/\bitm_[a-z0-9]{8,16}\b/g)) cited.add(id)
    quoted += [...piece.matchAll(/"[^"]{20,}"/g)].length
    yield { type: 'text-delta', id: 'text-0', delta: piece }
  }
  yield { type: 'text-end', id: 'text-0' }
  // A draft to confirm: the call waits for the person, who sees exactly what it would save.
  if (turn.propose) {
    const toolCallId = `call_create_draft_${call.toString(36).padStart(4, '0')}`
    yield {
      type: 'tool-input-available',
      toolCallId,
      toolName: 'create_draft',
      input: turn.propose,
      dynamic: true,
    }
    yield { type: 'tool-approval-request', approvalId: `approval_${toolCallId}`, toolCallId }
  }
  yield { type: 'finish-step' }
  const report: CitationReport = { cited: [...cited].sort(), removed: [], quoted }
  yield { type: 'data-citations', data: report }
  yield { type: 'finish', finishReason: turn.finish }
}
