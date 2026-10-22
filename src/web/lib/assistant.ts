import type { DynamicToolUIPart, UIMessage } from 'ai'
import type { ItemKind } from '@domain/item'
import {
  removedNotice,
  SCOPE_LINE,
  type AssistantLimit,
  type CitationReport,
  type QuestionScope,
} from '../../contract/assistant.ts'
import { namedKeys, type ServedStamp } from '@/lib/agent-reply'
import { tidyAnswer } from '@/lib/answer-markdown'
import { addToScope } from '@/lib/mention-targets'
import { siteOf } from '@/lib/provenance'
import { formatDay } from '@/lib/library'
import { lastDayFromEnd } from '@/lib/validity-range'
import type { TryItSearch } from '@/lib/search-params'
import { emptyScope, scopeFromSearch, tryItInput, type TryItScope } from '@/lib/try-it'

/*
  The Ask tab's reading of the assistant's stream (Assistant board, direction A). The answer's
  words come from the model, but everything that proves them comes from the service: the steps
  and the facts read are the tool results of this turn, the chips are the item ids the citation
  check let through, and the checked row is the check's own report. Pure, so the panel, the page,
  the stories and the tests read a message the same way.
*/

/** The scope sent with a question: the same keys and days as What an agent would get's address. */
export type SentScope = Pick<TryItSearch, 'about' | 'from' | 'to'>

export type AskMetadata = {
  /**
   * The scope the question was asked with: what the composer's "Heed reads" line showed, or, when
   * the words could not be read, what was picked. The next question carries it.
   */
  scope?: SentScope
  /** The same scope as words the model reads, sent with the question (lib/assistant-chat.ts). */
  scopeText?: string
  /**
   * The same scope as get_facts's fields, with where the dates came from and what was carried:
   * sent as the question's `data-scope` part, which binds the answer's tool calls.
   */
  read?: QuestionScope
  /** The day the question was read at because it gave no dates. */
  assumedDay?: string
  /** How the answer ended: `length` when it stopped at its length limit. */
  finishReason?: string
  /** When the message was sent or started, as a time (ISO 8601): for the chat's export. */
  at?: string
  /** The model that wrote the answer, as the service named it, and whether it is the scripted one. */
  model?: { name: string; mock: boolean }
}
export type AskData = {
  citations: CitationReport
  limit: AssistantLimit
  refusal: { refused: boolean }
}
export type AskMessage = UIMessage<AskMetadata, AskData>

/** What the service says when the model declined (assistant/chat.ts, closing). */
export const REFUSAL_NOTICE = "I can't answer this one. Try asking it another way."

const itemId = /^itm_[a-z0-9]{8,16}$/

/** How one fact read in this answer stands: applies, in part, not, or only read or found. */
export type FactVerdict = 'applies' | 'partial' | 'not' | 'read'

export type FactRead = {
  id: string
  title: string
  kind: ItemKind | null
  verdict: FactVerdict
  /** Why, in the service's words; null for a fact that was only read. */
  reason: string | null
  /** How it was reviewed before it was served, as the tool gave it (FR-326); null when none said. */
  reviewed: ServedStamp | null
}

/** A tool's `reviewed` as the stamp reads it; null for anything else. */
export function servedStampOf(value: unknown): ServedStamp | null {
  const reviewed = record(value)
  const [on, by, edition] = [reviewed.accepted_on, reviewed.accepted_by, reviewed.in_edition]
  return typeof on === 'string' && typeof by === 'string' && typeof edition === 'string'
    ? { acceptedOn: on, by, edition }
    : null
}

/**
 * One step the assistant took, in plain words: the verb in the present while it runs ("Reading")
 * and in the past once it is done ("Read"), what it acted on ("consumer.example") and what it
 * found ("4 checked, 2 apply").
 */
export type StepView = {
  id: string
  words: string
  /** What the step acted on, after the words: a site, a domain, an edition. */
  object: string | null
  /** What it found, after a middle dot. */
  counts: string | null
  icon: 'search' | 'explain' | 'read' | 'check' | 'draft' | 'web'
  running: boolean
  failed: boolean
  /** The facts this step returned, by id, for its details. */
  facts: string[]
}

export type AnswerView = {
  /** The edition the tools read; null when no tool named one. */
  edition: string | null
  steps: StepView[]
  /**
   * The answer as Markdown, each cited item as an `@[title](item:id)` mention and each removed
   * statement as a mention of `REMOVED_TARGET` and its reason, so the renderer draws chips and
   * notices.
   */
  markup: string
  /** The answer's words as typed, citations as `[itm_...]`: for copying. */
  plain: string
  facts: FactRead[]
  report: CitationReport | null
  limit: AssistantLimit | null
  refused: boolean
  /** get_facts found nothing that applies to the scope, and no tool found a fact that does. */
  notFound: boolean
  /** The scope get_facts resolved, for Start a draft and What an agent would get. */
  scopeUsed: TryItScope | null
  /** The answer stopped at its length limit. */
  cut: boolean
  /**
   * A draft the assistant proposed, as the person confirms it: waiting for them, being saved, or
   * saved with the way to open it. Null when it proposed none, or the person said not now.
   */
  draft: DraftProposal | null
}

/** Where a field of a proposed draft came from, as its mark says it (FR-707). */
export type FieldSource =
  | { kind: 'person' }
  | { kind: 'page'; site: string }
  | { kind: 'suggested' }
  | { kind: 'item'; id: string }
  | { kind: 'gap' }
  | { kind: 'default' }

/** The fields the confirmation shows, in the form's order. */
export type CardField =
  | 'kind'
  | 'title'
  | 'summary'
  | 'scope'
  | 'validity'
  | 'evidence'
  | 'areaId'
  | 'body'
  | 'notToConclude'
  | 'reviewDate'

/**
 * A draft as the confirmation shows it, read from the very call the service signed: what the
 * person confirms is what is saved, as no field can change without the signature failing.
 */
export type DraftCard = {
  /** The accepted item the draft would change; null for a new item. */
  itemId: string | null
  kind: ItemKind | null
  title: string
  summary: string | null
  body: string | null
  notToConclude: string | null
  /** The domain, by name. */
  domain: string | null
  /** Where it applies: metrics, then dimensions with their values, by name. */
  where: string[]
  /** From and to, the last day it applies; `uncertain` when the person was unsure of them. */
  dates: { from: string | null; to: string | null; uncertain: boolean } | null
  reviewDate: string | null
  evidence: {
    url: string
    site: string
    quote: string
    /** The day it was read. */
    readOn: string | null
    /** Read from a web page in this answer: an external source nobody has reviewed. */
    fromPage: boolean
  }[]
  sources: Partial<Record<CardField, FieldSource>>
}

export type DraftProposal = {
  toolCallId: string
  /** The confirmation to answer, while the person has not. */
  approvalId: string | null
  state: 'asking' | 'saving' | 'saved' | 'failed'
  card: DraftCard
  /** The sites of the web pages its evidence was read from in this answer. */
  webSites: string[]
  /** The saved draft, to open in the form, once the service says it is saved. */
  saved: { id: string; number: number; itemId: string | null } | null
}

type Output = Record<string, unknown>
const record = (value: unknown): Output =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Output) : {}
const list = (value: unknown): Output[] => (Array.isArray(value) ? value.map(record) : [])
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const kinds = new Set<string>(['event', 'note', 'guide', 'example', 'issue'])
const kindOf = (value: unknown): ItemKind | null =>
  typeof value === 'string' && kinds.has(value) ? (value as ItemKind) : null

/** The assistant's tool parts: every assistant tool is a dynamic tool on the service. */
export function toolParts(message: AskMessage): DynamicToolUIPart[] {
  return message.parts.filter((part): part is DynamicToolUIPart => part.type === 'dynamic-tool')
}

const words = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
/** "2 facts", "1 fact", "38 facts". */
export const factCount = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'fact' : 'facts'}`
/** "Two facts", for the start of a sentence. */
export const factCountWords = (n: number) =>
  `${words[n] ?? n.toLocaleString('en')} ${n === 1 ? 'fact' : 'facts'}`

/** The scope get_facts used, as chips and days: its window ends the day after its last day. */
export function scopeOfUsed(used: unknown): TryItScope | null {
  const scope = record(used)
  const metrics = Array.isArray(scope.metrics)
    ? scope.metrics.filter((m) => typeof m === 'string')
    : []
  const filters = record(scope.filters)
  let chips = emptyScope
  for (const key of metrics) chips = addToScope(chips, key)
  for (const [dimension, values] of Object.entries(filters)) {
    const named = Array.isArray(values) ? values.filter((v) => typeof v === 'string') : []
    if (!named.length) chips = addToScope(chips, dimension)
    for (const value of named) chips = addToScope(chips, value)
  }
  const window = record(scope.window)
  const start = text(window.start)
  const end = text(window.end)
  const last = end ? lastDay(end) : null
  if (!start && chips === emptyScope) return null
  return { scope: chips, from: start, to: last }
}

/** The day before a date: a window's end is the day after its last day. */
function lastDay(end: string): string {
  const date = new Date(`${end}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** Each fact read in this answer, once, with the strongest verdict any tool gave it. */
function factsOf(parts: DynamicToolUIPart[], titleOf: (id: string) => string | undefined) {
  const facts = new Map<string, FactRead>()
  const rank: Record<FactVerdict, number> = { read: 0, not: 1, partial: 2, applies: 3 }
  const add = (fact: FactRead) => {
    if (!itemId.test(fact.id)) return
    const known = facts.get(fact.id)
    const reviewed = fact.reviewed ?? known?.reviewed ?? null
    if (!known || rank[fact.verdict] > rank[known.verdict])
      facts.set(fact.id, { ...fact, reviewed })
    else if (!known.reviewed && reviewed) facts.set(fact.id, { ...known, reviewed })
  }
  for (const part of parts) {
    if (part.state !== 'output-available') continue
    const output = record(part.output)
    const title = (id: string, fallback: unknown) => titleOf(id) ?? text(fallback) ?? id
    switch (part.toolName) {
      case 'get_facts':
        for (const item of list(output.items)) {
          const id = String(item.id)
          const partial = item.match === 'partial'
          add({
            id,
            title: title(id, item.title),
            kind: kindOf(item.kind),
            verdict: partial ? 'partial' : 'applies',
            reason: partial
              ? (text(item.applies_note) ?? 'It applies only in part.')
              : 'It applies to everything you asked about.',
            reviewed: servedStampOf(item.reviewed),
          })
        }
        break
      case 'explain_item': {
        const id = text(output.id)
        if (!id || output.status === 'not_found') break
        const applies = output.applies === true
        add({
          id,
          title: title(id, output.title),
          kind: null,
          verdict: applies
            ? text(output.reason)?.startsWith('It applies only in part')
              ? 'partial'
              : 'applies'
            : 'not',
          reason: text(output.reason),
          reviewed: null,
        })
        break
      }
      case 'read_item': {
        const item = record(output.item)
        const id = text(item.id)
        if (id)
          add({
            id,
            title: title(id, item.title),
            kind: kindOf(item.kind),
            verdict: 'read',
            reason: null,
            reviewed: servedStampOf(item.reviewed),
          })
        break
      }
      case 'find_facts':
      case 'what_changed':
      case 'domain_overview':
      case 'find_overlaps':
        for (const item of [
          ...list(output.items),
          ...list(output.accepted),
          ...list(output.changes),
          ...list(record(output.needs_a_look).items),
          ...list(record(output.recent_changes).changes),
        ]) {
          const id = String(item.id)
          add({
            id,
            title: title(id, item.title),
            kind: kindOf(item.kind),
            verdict: 'read',
            reason: null,
            reviewed: servedStampOf(item.reviewed),
          })
        }
        break
    }
  }
  // Applies first, then in part, then not, then read; each group in the order it was read.
  return [...facts.values()].sort((a, b) => rank[b.verdict] - rank[a.verdict])
}

/** A domain the assistant named by its id or its name (find_facts takes either). */
const areaName = (id: unknown, areas: readonly { id: string; name: string }[]) =>
  typeof id === 'string'
    ? (areas.find((area) => area.id === id || area.name.toLowerCase() === id.toLowerCase())?.name ??
      null)
    : null

/** The steps in plain words; explanations of several facts read as one step. */
function stepsOf(
  parts: DynamicToolUIPart[],
  facts: FactRead[],
  areas: readonly { id: string; name: string }[],
): StepView[] {
  const steps: StepView[] = []
  const checked = facts.filter((fact) => fact.verdict !== 'read')
  const apply = checked.filter((fact) => fact.verdict !== 'not').length
  const explained = parts.filter((part) => part.toolName === 'explain_item')
  for (const part of parts) {
    const running = part.state === 'input-streaming' || part.state === 'input-available'
    const output = part.state === 'output-available' ? record(part.output) : {}
    const error = text(output.error) ?? (part.state === 'output-error' ? part.errorText : null)
    const failed = error !== null
    const ids = list(output.items).map((item) => String(item.id))
    const base = { id: part.toolCallId, running, failed, facts: ids, object: null }
    switch (part.toolName) {
      case 'get_facts': {
        const counts =
          output.status === 'need_more_detail'
            ? 'needs a metric, a market or dates'
            : `${checked.length.toLocaleString('en')} checked, ${apply ? apply.toLocaleString('en') : 'none'} ${apply === 1 ? 'applies' : 'apply'}`
        steps.push({
          ...base,
          icon: 'search',
          words: running ? 'Looking up facts' : 'Looked up facts',
          counts: running || failed ? null : counts,
        })
        break
      }
      case 'explain_item': {
        // One row for every explanation, where the first one was.
        if (part !== explained[0]) break
        const done = explained.filter((p) => p.state === 'output-available')
        const not = done.filter((p) => record(p.output).applies === false).length
        const busy = explained.some(
          (p) => p.state === 'input-streaming' || p.state === 'input-available',
        )
        const apply = explained.length === 1 ? 'applies' : 'apply'
        steps.push({
          ...base,
          running: busy,
          icon: 'explain',
          words: busy
            ? `Checking whether ${factCount(explained.length)} ${apply}`
            : not === done.length && not > 0
              ? `Explained why ${factCount(not)} ${not === 1 ? 'does' : 'do'} not apply`
              : `Checked whether ${factCount(explained.length)} ${apply}`,
          counts: null,
          facts: explained.map((p) => text(record(p.output).id) ?? '').filter(Boolean),
        })
        break
      }
      case 'read_item': {
        const item = record(output.item)
        steps.push({
          ...base,
          icon: 'read',
          words: running ? 'Reading a fact' : 'Read a fact',
          counts: null,
          facts: text(item.id) ? [String(item.id)] : [],
        })
        break
      }
      case 'find_facts': {
        const total = Number(output.total ?? ids.length)
        const used = record(output.query_used)
        const domains = list(output.domains)
        // A search for one domain's name and nothing else reads as what that domain holds.
        const area =
          areaName(record(part.input).domain, areas) ??
          (domains.length === 1 && !list(used.terms).length && !list(used.words).length
            ? text(domains[0]!.name)
            : null)
        const defined = list(output.definitions).length > 0
        steps.push({
          ...base,
          icon: 'search',
          words: running
            ? 'Searching facts'
            : area
              ? `Read ${factCount(total)} in`
              : defined
                ? 'Read the definition and searched facts'
                : 'Searched facts',
          object: running ? null : area,
          counts:
            running || area
              ? null
              : `${total.toLocaleString('en')} text ${total === 1 ? 'match' : 'matches'}`,
        })
        break
      }
      case 'domain_overview': {
        const domain = text(record(output.domain).name)
        steps.push({
          ...base,
          icon: 'read',
          words: running
            ? 'Reading the domain'
            : domain
              ? 'Read the overview of'
              : 'Read the domains and their names',
          object: running ? null : domain,
          counts: null,
          facts: list(record(output.needs_a_look).items).map((item) => String(item.id)),
        })
        break
      }
      case 'what_changed':
        steps.push({
          ...base,
          icon: 'read',
          // Editions show only on the Editions page: the step names none.
          words: running ? 'Reading what changed' : 'Read what changed',
          object: null,
          counts: null,
          facts: list(output.changes).map((item) => String(item.id)),
        })
        break
      case 'improve_question':
        steps.push({
          ...base,
          icon: 'explain',
          words: running
            ? 'Looking at how the question is worded'
            : 'Looked at how the question is worded',
          counts: null,
        })
        break
      case 'check_draft':
        steps.push({
          ...base,
          icon: 'check',
          words: running ? 'Running the checks' : 'Ran the checks',
          counts: running ? null : text(output.summary),
        })
        break
      case 'find_overlaps':
        steps.push({
          ...base,
          icon: 'search',
          words: running ? 'Looking for facts that overlap' : 'Looked for facts that overlap',
          counts: null,
          facts: list(output.accepted).map((item) => String(item.id)),
        })
        break
      case 'estimate_impact':
        steps.push({
          ...base,
          icon: 'check',
          words: running ? 'Previewing what agents would get' : 'Previewed what agents would get',
          counts: null,
        })
        break
      case 'read_gap':
        steps.push({
          ...base,
          icon: 'read',
          words: running ? 'Reading a reported gap' : 'Read a reported gap',
          counts: null,
        })
        break
      case 'search_help': {
        // The help pages it read from, by title: the same pages as Docs.
        const pages = [...new Set(list(output.results).flatMap((r) => text(r.page) ?? []))]
        steps.push({
          ...base,
          icon: 'read',
          words: running
            ? 'Reading the help pages'
            : pages.length
              ? 'Read the help pages'
              : 'Found nothing in the help pages',
          counts: running || !pages.length ? null : pages.join(', '),
        })
        break
      }
      case 'create_draft': {
        // Saved only once the service says so: a confirmed draft is still being saved.
        const declined =
          part.state === 'output-denied' ||
          (part.state === 'approval-responded' && !part.approval.approved)
        const saving = part.state === 'approval-responded' && part.approval.approved
        steps.push({
          ...base,
          icon: 'draft',
          words:
            part.state === 'approval-requested'
              ? 'Wrote a draft for you to check'
              : declined
                ? 'You didn’t create the draft'
                : saving
                  ? 'Saving the draft'
                  : failed
                    ? 'Tried to save the draft'
                    : 'Saved a draft',
          counts: null,
          running: saving,
        })
        break
      }
      case 'read_source': {
        const site = siteOf(text(output.url) ?? text(record(part.input).url) ?? '')
        steps.push({
          ...base,
          icon: 'web',
          words: running ? 'Reading' : failed ? 'Tried to read' : 'Read',
          object: site,
          counts: null,
        })
        break
      }
      case 'search_web': {
        const found = list(output.results).length
        steps.push({
          ...base,
          icon: 'web',
          words: running
            ? 'Searching the web'
            : failed
              ? 'Tried to search the web'
              : 'Searched the web',
          counts:
            running || failed
              ? null
              : `${found.toLocaleString('en')} ${found === 1 ? 'page' : 'pages'} found`,
        })
        break
      }
      default:
        steps.push({
          ...base,
          icon: 'search',
          words: running ? 'Looking something up' : 'Looked something up',
          counts: null,
        })
    }
  }
  return steps.map((step) => (step.failed ? { ...step, counts: null } : step))
}

/**
 * What a finished trail of steps comes to, for its folded row: how many steps, and the facts and
 * pages they read ("3 steps", "4 facts, 1 page"). Only what the tools returned counts.
 */
export function stepsSummary(steps: readonly StepView[]): { steps: string; read: string | null } {
  const facts = new Set(steps.flatMap((step) => step.facts)).size
  const pages = steps.filter((step) => step.icon === 'web' && step.object && !step.failed).length
  const read = [
    facts ? `${facts.toLocaleString('en')} ${facts === 1 ? 'fact' : 'facts'}` : null,
    pages ? `${pages.toLocaleString('en')} ${pages === 1 ? 'page' : 'pages'}` : null,
  ].filter(Boolean)
  return {
    steps: `${steps.length.toLocaleString('en')} ${steps.length === 1 ? 'step' : 'steps'}`,
    read: read.length ? read.join(', ') : null,
  }
}

/**
 * A removed statement's mention target: the mention grammar (lib/markdown.ts) has no kind for it,
 * so it borrows the domain form with a name no domain has. Only the answer's renderer reads it.
 */
export const REMOVED_TARGET = 'area:heed-removed-'

/** The longest words a mention holds (lib/markdown.ts); a chip shows fewer anyway. */
const LABEL_LIMIT = 120

/**
 * A title as a mention's or a link's words: brackets would end it early, and a pipe would split
 * the table cell it is in.
 */
const label = (title: string) =>
  [...title.replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')'))]
    .slice(0, LABEL_LIMIT)
    .join('')
    .replace(/\|/g, '\\|')

/** A title as a link's words in the copied answer: whole, with only what would end the link early. */
const linkLabel = (title: string) =>
  title.replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')')).replace(/\|/g, '\\|')

/**
 * Puts the words for a removed statement where the notice was. A notice on its own line under a
 * table's row was that row, so it stays a row of the table, across it, and the table holds
 * together.
 */
function placeNotice(text: string, notice: string, words: string): string {
  const out: string[] = []
  for (const line of text.split('\n'))
    out.push(
      line.trim() === notice && /\|/.test(out.at(-1) ?? '')
        ? `| ${words} |`
        : line.split(notice).join(words),
    )
  return out.join('\n')
}

/**
 * The answer as Markdown with chips: each cited id (in brackets, alone or in a list, or bare)
 * becomes an item mention with the fact's title, each removed statement a removed mention.
 */
export function answerMarkup(answer: string, titleOf: (id: string) => string): string {
  let markup = answer
  for (const [reason, notice] of Object.entries(removedNotice))
    markup = placeNotice(
      markup,
      notice,
      `@[${reason}](${REMOVED_TARGET}${reason.replace('_', '-')})`,
    )
  const chip = (id: string) => `@[${label(titleOf(id))}](item:${id})`
  return markup
    .replace(/\[\s*(itm_[a-z0-9]{8,16}(?:\s*,\s*itm_[a-z0-9]{8,16})*)\s*\]/gi, (_, ids: string) =>
      ids
        .split(',')
        .map((id) => chip(id.trim()))
        .join(' '),
    )
    .replace(/(?<![\w(:/])itm_[a-z0-9]{8,16}\b(?![\]])/gi, (id) => chip(id))
}

/** The answer's words: every text part, without the notice a limit or a refusal also sends. */
function answerText(message: AskMessage, limit: AssistantLimit | null, refused: boolean) {
  return message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .filter((words) => words && words !== limit?.message && !(refused && words === REFUSAL_NOTICE))
    .join('\n\n')
}

/**
 * Reads one assistant message. `titleOf` names a fact from the library index, so a chip shows
 * the title the person knows; a fact the index does not hold keeps the title its tool returned.
 */
export function readAnswer(
  message: AskMessage,
  {
    titleOf = () => undefined,
    areas = [],
    nameOf = () => undefined,
  }: {
    titleOf?: (id: string) => string | undefined
    areas?: readonly { id: string; name: string }[]
    /** A vocabulary key's name, for the keys a reason names ("dim:market"). */
    nameOf?: (key: string) => string | undefined
  } = {},
): AnswerView {
  const parts = toolParts(message)
  const data = <K extends keyof AskData>(name: K) =>
    message.parts.find((part) => part.type === `data-${name}`) as { data: AskData[K] } | undefined
  const report = data('citations')?.data ?? null
  const limit = data('limit')?.data ?? null
  const refused = data('refusal')?.data.refused === true
  const facts = factsOf(parts, titleOf).map((fact) =>
    fact.reason ? { ...fact, reason: namedKeys(fact.reason, nameOf) } : fact,
  )
  const known = new Map(facts.map((fact) => [fact.id, fact.title]))
  const plain = answerText(message, limit, refused)
  const outputs = parts.flatMap((part) =>
    part.state === 'output-available' ? [{ tool: part.toolName, output: record(part.output) }] : [],
  )
  const context = outputs.find((entry) => entry.tool === 'get_facts')?.output
  const edition =
    outputs.map((entry) => text(entry.output.edition)).find((value) => value !== null) ?? null
  // Evidence from a page read_source read in this answer: an external source the person sees.
  const read = new Set(
    outputs
      .filter((entry) => entry.tool === 'read_source')
      .flatMap((entry) => [text(entry.output.url), text(entry.output.asked)])
      .filter((url): url is string => url !== null),
  )
  return {
    edition,
    steps: stepsOf(parts, facts, areas),
    markup: answerMarkup(plain, (id) => known.get(id) ?? titleOf(id) ?? id),
    plain,
    facts,
    report,
    limit,
    refused,
    // Nothing applies, even if the answer names nearby facts that do not (A.notfound).
    notFound:
      context?.status === 'no_match' &&
      !facts.some((fact) => fact.verdict === 'applies' || fact.verdict === 'partial') &&
      !limit &&
      !refused,
    scopeUsed: context ? scopeOfUsed(context.scope_used) : null,
    cut: message.metadata?.finishReason === 'length',
    draft: draftProposal(parts, read, areas, nameOf),
  }
}

const sourceKinds: Record<string, FieldSource['kind']> = {
  your_text: 'person',
  suggested: 'suggested',
  default: 'default',
}

/** A source word of create_draft ("your_text", "item:itm_..."), as a mark. */
function fieldSource(word: string | null): FieldSource | null {
  if (!word) return null
  if (word.startsWith('item:')) return { kind: 'item', id: word.slice(5) }
  if (word.startsWith('gap:')) return { kind: 'gap' }
  const kind = sourceKinds[word]
  return kind && kind !== 'page' && kind !== 'item' ? { kind } : null
}

/**
 * The draft the assistant's latest create_draft call proposes, as the person confirms it, and
 * then as it is saved. A call the person declined, or one the service refused before asking,
 * shows no confirmation.
 */
function draftProposal(
  parts: DynamicToolUIPart[],
  read: ReadonlySet<string>,
  areas: readonly { id: string; name: string }[],
  nameOf: (key: string) => string | undefined,
): DraftProposal | null {
  const part = parts.findLast((p) => p.toolName === 'create_draft')
  if (!part) return null
  const state =
    part.state === 'approval-requested'
      ? 'asking'
      : part.state === 'approval-responded'
        ? part.approval.approved
          ? 'saving'
          : null
        : part.state === 'output-available'
          ? text(record(part.output).proposal_id)
            ? 'saved'
            : 'failed'
          : part.state === 'output-error'
            ? 'failed'
            : null
  // Declined, or refused before the person was asked: there was nothing to confirm.
  if (!state || (state === 'failed' && !('approval' in part && part.approval))) return null
  const input = record(part.input)
  const draft = record(input.draft)
  const sources = record(input.sources)
  const named = (key: string) => nameOf(key) ?? key
  const scope = record(draft.scope)
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  const where = [
    ...strings(scope.metrics).map(named),
    ...strings(scope.dimensions).map((key) => `${named(key)}: any value`),
    ...list(scope.dimensionValues).flatMap((row) => {
      const dimension = text(row.dimension)
      const value = text(row.value)
      return dimension && value ? [`${named(dimension)}: ${named(value)}`] : []
    }),
  ]
  const validity = draft.validity === undefined ? null : record(draft.validity)
  const evidence = list(draft.evidence).flatMap((entry) => {
    const url = text(entry.url)
    return url
      ? [
          {
            url,
            site: siteOf(url),
            quote: text(entry.quote) ?? '',
            readOn: text(entry.date),
            fromPage: read.has(url),
          },
        ]
      : []
  })
  const areaId = text(draft.areaId)
  const card: DraftCard = {
    itemId: text(input.item_id),
    kind: kindOf(draft.kind),
    title: text(draft.title) ?? 'A new draft',
    summary: text(draft.summary) ?? text(draft.summaryMarkup),
    body: text(draft.body) ?? text(draft.bodyMarkup),
    notToConclude: text(draft.notToConclude),
    domain: areaId ? (areas.find((area) => area.id === areaId)?.name ?? areaId) : null,
    where,
    dates: validity
      ? {
          from: text(validity.start),
          to: text(validity.end) ? lastDayFromEnd(text(validity.end)) : null,
          uncertain: input.dates_uncertain === true,
        }
      : null,
    reviewDate: text(draft.reviewDate),
    evidence,
    sources: {},
  }
  // The mark of each field: the source the call gave it, keyed by its head ("validity.start"),
  // and for evidence read from a page in this answer, that page.
  for (const [path, word] of Object.entries(sources)) {
    const head = path.split('.')[0]!.replace(/Markup$/, '') as CardField
    const source = fieldSource(text(word))
    if (source && !card.sources[head]) card.sources[head] = source
  }
  const page = evidence.find((entry) => entry.fromPage)
  if (page) card.sources.evidence = { kind: 'page', site: page.site }
  const output = record(part.output)
  const saved = text(output.proposal_id)
  return {
    toolCallId: part.toolCallId,
    approvalId: part.state === 'approval-requested' ? part.approval.id : null,
    state,
    card,
    webSites: [...new Set(evidence.filter((entry) => entry.fromPage).map((entry) => entry.site))],
    saved:
      saved && state === 'saved'
        ? { id: saved, number: Number(output.number), itemId: text(input.item_id) }
        : null,
  }
}

/**
 * The person's question, the scope they sent with it, what of it was carried from the question
 * before (keys, and `window` for the dates), and the day it was read at when it gave no dates.
 */
export function readQuestion(message: AskMessage): {
  text: string
  scope: TryItScope | null
  carried: string[]
  assumedDay: string | null
} {
  const words = message.parts.find((part) => part.type === 'text')
  return {
    text: words?.type === 'text' ? words.text : '',
    scope: message.metadata?.scope ? scopeFromSearch(message.metadata.scope) : null,
    carried: message.metadata?.read?.carried ?? [],
    assumedDay: message.metadata?.assumedDay ?? null,
  }
}

/**
 * What the checked row says after "Checked before you saw it": where the facts the answer names
 * come from, that its quotes match their sources, and what the check removed (the voice review,
 * section 7.4).
 */
export function checkedWords(report: CitationReport): { lead: string; removed: string[] } {
  const named = report.cited.length
  const quoted = report.quoted ?? 0
  const facts =
    named === 0
      ? 'This answer names no fact'
      : named === 1
        ? 'The fact above comes from the library'
        : `All ${named.toLocaleString('en')} facts above come from the library`
  const quotes =
    quoted === 0
      ? ''
      : quoted === 1
        ? ', and the quote matches its source word for word'
        : `, and all ${quoted.toLocaleString('en')} quotes match their sources word for word`
  // Each removal is marked where it was in the answer; this row counts them and says why.
  const removed = (['unknown_item', 'unverified_quote'] as const).flatMap((reason) => {
    const n = report.removed.filter((r) => r.reason === reason).length
    if (!n) return []
    const count =
      n === 1 ? (reason === 'unknown_item' ? 'a sentence' : 'a quote') : n.toLocaleString('en')
    return [
      reason === 'unknown_item'
        ? `Left out ${count}${n === 1 ? '' : ' sentences'} that named a fact I hadn’t read, marked above.`
        : `Left out ${count}${n === 1 ? '' : ' quotes'} I couldn’t find in the facts I read, marked above.`,
    ]
  })
  return { lead: `${facts}${quotes}.`, removed }
}

/** The words of a removed statement's notice. */
export const removedWords: Record<keyof typeof removedNotice, string> = {
  unknown_item: 'I removed a sentence that named a fact I hadn’t read.',
  unverified_quote: 'I removed a quote I couldn’t find in the facts I read.',
}

/**
 * What a limit says to a person: which one, and when it resets, without an amount (the board's
 * "no dollar amount in front of a person").
 */
export function limitWords(
  limit: AssistantLimit,
  formatDay: (day: string) => string,
): { title: string; when: string } {
  const when = limit.resets
    ? `It resets on ${formatDay(limit.resets)}.`
    : 'It resets within 24 hours.'
  switch (limit.kind) {
    case 'person_day':
      return { title: 'You’ve reached today’s limit for the assistant', when }
    case 'feature':
      return { title: 'The assistant has reached its limit for this month', when }
    case 'monthly':
      return { title: 'AI spending has reached its limit for this month', when }
  }
}

/** The answer as Markdown to paste: each fact a link to its page, then what it was about. */
export function answerAsMarkdown(
  answer: AnswerView,
  {
    origin,
    titleOf,
    scopeWords,
  }: { origin: string; titleOf: (id: string) => string; scopeWords: string | null },
): string {
  const link = (id: string) => `[${linkLabel(titleOf(id))}](${origin}/library/${id})`
  let body = answer.plain
  for (const [reason, notice] of Object.entries(removedNotice))
    body = placeNotice(body, notice, `(${removedWords[reason as keyof typeof removedNotice]})`)
  body = body.replace(
    /\[\s*(itm_[a-z0-9]{8,16}(?:\s*,\s*itm_[a-z0-9]{8,16})*)\s*\]/gi,
    (_, ids: string) =>
      ids
        .split(',')
        .map((id) => link(id.trim()))
        .join(', '),
  )
  // Tables as Markdown readers elsewhere read them too (a blank line before and after).
  return [tidyAnswer(body), scopeWords ? `About: ${scopeWords}.` : null]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The line the model reads for the scope picked: get_facts's own fields, as What an agent
 * would get sends them, after a fixed prefix (SCOPE_LINE).
 */
export function scopeLine(scope: TryItScope): string {
  return `${SCOPE_LINE} ${JSON.stringify(tryItInput(scope))}`
}

/**
 * When a fact applies, as its line says it: "from 15 Jun 2026" while it goes on, "1 to 30 Jun 2026"
 * once it has ended. Two facts with the same title differ by this.
 */
export function factDatesWords(fact: {
  validity: { start: string }
  until: string | null
}): string {
  return fact.until
    ? (rangeWords(fact.validity.start, fact.until, formatDay) ?? '')
    : `from ${formatDay(fact.validity.start)}`
}

/** The one sentence of what a fact says: its summary's first sentence that is not its title again. */
export function factSentence(summary: string, title: string): string {
  const sentences = summary.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [summary]
  const same = (sentence: string) =>
    sentence
      .trim()
      .replace(/[.!?]+$/, '')
      .toLowerCase() ===
    title
      .trim()
      .replace(/[.!?]+$/, '')
      .toLowerCase()
  return (sentences.find((sentence) => !same(sentence)) ?? '').trim()
}

/**
 * The day a question without dates was read at, in words: "today, 7 Oct 2026", or "the demo's
 * date, 7 Oct 2026" when the day is not the real one, because a demo or a test fixes the clock.
 * A day within one of the browser's own is today: time zones differ by that much.
 */
export function dayWords(day: string, format: (day: string) => string, now = new Date()): string {
  const own = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const apart =
    Math.abs(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${own}T00:00:00Z`)) / 86_400_000
  return `${apart > 1 ? 'the demo’s date' : 'today'}, ${format(day)}`
}

/**
 * Days as a chip reads them, as short as they stay clear: "1 to 30 Jun 2026", "1 May to 30 Jun
 * 2026", "4 Aug 2026". `format` writes one day ("1 Jun 2026").
 */
export function rangeWords(
  from: string | null,
  to: string | null,
  format: (day: string) => string,
): string | null {
  if (!from) return null
  const last = to && to >= from ? to : from
  if (last === from) return format(from)
  const withoutYear = (day: string) => format(day).replace(/\s\d{4}$/, '')
  if (from.slice(0, 7) === last.slice(0, 7))
    return `${Number(from.slice(8, 10))} to ${format(last)}`
  if (from.slice(0, 4) === last.slice(0, 4)) return `${withoutYear(from)} to ${format(last)}`
  return `${format(from)} to ${format(last)}`
}

/** A suggested question: what it teaches, its words, and the scope it is asked with. */
export type Starter = { label: string; question: string; scope?: TryItScope }

type Named = { key: string; name: string }

/**
 * The empty state's suggested questions (Assistant board, A.empty): five, each named by what it
 * does, filled from what Heed holds so they find something, and with the fact of the page the
 * person is on first. A starter is shown before it is asked, so nothing is sent unseen.
 */
export function starters({
  fact,
  metric,
  market,
  area,
  today,
}: {
  /** A fact to explain: the one on the page, or a recent event. */
  fact: { title: string } | null
  metric: Named | null
  market: Named | null
  area: { name: string } | null
  today: string | null
}): Starter[] {
  const month = today ? lastFullMonth(today) : null
  const list: Starter[] = []
  if (fact)
    list.push({
      label: 'Explain a fact',
      question: `What does “${fact.title}” mean for my numbers?`,
    })
  if (metric && market && month)
    list.push({
      label: 'See what applies',
      question: `Which facts apply to ${metric.name} in ${market.name} in ${month.words}?`,
      scope: {
        scope: addToScope(addToScope(emptyScope, metric.key), market.key),
        from: month.from,
        to: month.to,
      },
    })
  if (area)
    list.push({ label: 'Summarise a domain', question: `What does the ${area.name} domain cover?` })
  list.push({
    label: 'Sharpen a question',
    question: `Make this clearer: why did ${metric ? lowerFirst(metric.name) : 'orders'} drop${market ? ` in ${market.name}` : ''}?`,
  })
  list.push({
    label: 'Write a fact',
    question: `Help me write down a change I know about${market ? ` in ${market.name}` : ''}.`,
  })
  return list
}

const lowerFirst = (words: string) => words.charAt(0).toLowerCase() + words.slice(1)

/** The last whole month before a day: its first and last day, and its name ("September 2026"). */
export function lastFullMonth(today: string): { from: string; to: string; words: string } {
  const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  const end = new Date(first.getTime() - 86_400_000)
  const from = `${end.toISOString().slice(0, 7)}-01`
  const words = end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { from, to: end.toISOString().slice(0, 10), words }
}
