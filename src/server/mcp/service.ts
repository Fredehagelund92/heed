import { createHash, randomUUID } from 'node:crypto'
import { replyStatus, stateOfStatus } from '../../domain/answer-state.ts'
import { canonicalJson } from '../../domain/canonical.ts'
import { noGroups } from '../../domain/item.ts'
import { agentKinds, kindFilters } from '../../domain/mcp-text.ts'
import { ownCaveat } from '../../domain/proposal-rules.ts'
import {
  agentInstructions,
  caveatInstruction,
  coverageStatement,
  metricsOf,
  resolve,
  type Resolution,
} from '../../domain/resolver.ts'
import { findArea, rankItems, readQuery } from '../../domain/context-search.ts'
import { noteFindings, topicFor } from '../../domain/gap-reports.ts'
import {
  assumedDate,
  asksDefinition,
  extractScope,
  type ResolvedScope,
} from '../../domain/scope.ts'
import { shiftDate } from '../../domain/validity.ts'
import {
  termEntry,
  termsIn,
  termsNext,
  writtenWords,
  type TermEntry,
} from '../../domain/served-terms.ts'
import {
  acceptedByRole,
  acceptedWords,
  checkedWords,
  ownerRole,
} from '../../domain/served-review.ts'
import type { EditionSource, ServingBundle, ServingItem } from '../modules/editions/index.ts'
import { helpAnswer, repositoryHelp, type HelpLibrary } from '../modules/help/index.ts'
import type { Principal } from './auth.ts'
import { canRead, linkIndex, outgoing, related, termShown, type Link } from '../../domain/links.ts'
import type { AnonymousRecord, AnonymousStore } from './records.ts'
import {
  askedDomains,
  definitionOf,
  domainAbout,
  domainOverview,
  findContext,
  reviewedOutput,
  unknownDomain,
  whatChanged,
  type ChangesArgs,
  type FindArgs,
} from './outcomes.ts'
import type { ServingReads } from './reads.ts'
import {
  appliesWords,
  askedGroups,
  askedMetrics,
  contextSaid,
  contextVoice,
  factVoice,
  failedSaid,
  findSaid,
  gapSaid,
  improveSaid,
  overviewSaid,
  readSaid,
  refusedSaid,
  relatedSaid,
  reportSaid,
  scopeWords,
  searchSaid,
  unreadSaid,
  whenWords,
  type Said,
} from '../../domain/say.ts'
import {
  changesInput,
  contextInput,
  feedbackInput,
  findContextInput,
  findInput,
  gapInput,
  getContextInput,
  helpInput,
  improveInput,
  overviewInput,
  readInput,
  relatedInput,
  reportInput,
  searchInput,
  type ContextInput,
  type GetContextInput,
} from './schemas.ts'
import { toolSchemaDigest, type ServedToolName } from './tools.ts'
import { concepts } from '../../domain/words-v1.ts'
import { productName } from '../brand.ts'

/**
 * FR-346: what serves a cache or an audit, never an answer: the tool schema digest, the serving
 * overlay and the cache hints. They travel in the result's `_meta`, which clients keep from the
 * model (ChatGPT documents it as hidden), so the model reads the sentence and the items. A
 * delivery record takes them from the edition, never from a reply.
 */
export type ResultMeta = {
  tool_schema_digest?: string
  overlay?: string
  ttlMs?: number
  cacheScope?: string
}
const metaFields = ['tool_schema_digest', 'overlay', 'ttlMs', 'cacheScope'] as const
export type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent: Record<string, unknown>
  _meta?: ResultMeta
  isError?: boolean
}
/**
 * FR-347: the page of an item in Heed, for the person who reads an answer to check a cited item in
 * one click: on the web app's address, or a path on it without one. Only the id, which the result
 * shows already: the page applies the audience rules to whoever opens it.
 */
export const itemUrl = (web: string | null, id: string) =>
  `${web ?? ''}/library/${encodeURIComponent(id)}`
/** The page of a definition in Heed, by its name (docs/product.md, section 5): where a person reads a term. */
export const definitionUrl = (web: string | null, name: string) =>
  `${web ?? ''}/definitions/${encodeURIComponent(name)}`
/**
 * One line per delivered item, per section of a help page and per term, after the JSON: where a
 * person opens it in Heed (FR-347, FR-348).
 */
function openLines(output: Record<string, unknown>): string[] {
  const context = output.context
  const listed = [
    ...(Array.isArray(output.items) ? (output.items as unknown[]) : []),
    ...(output.item ? [output.item] : []),
    ...(Array.isArray(context) ? (context as unknown[]) : context ? [context] : []),
    ...(Array.isArray(output.results) ? (output.results as unknown[]) : []),
  ]
  const items = listed.flatMap((item) => {
    const { title, page, section, url, reviewed, checked } = item as Record<string, unknown>
    const name =
      typeof title === 'string'
        ? title
        : typeof page === 'string'
          ? typeof section === 'string'
            ? `${page}, ${section}`
            : page
          : null
    const review = reviewed as Record<string, string> | undefined
    const check = checked as { role: string; date: string } | undefined
    const stamp = review
      ? ` - ${acceptedWords(review.accepted_on!, review.accepted_by!, review.in_edition!)}`
      : check
        ? ` - ${checkedWords(check.date, check.role)}`
        : ''
    return name !== null && typeof url === 'string'
      ? [`Open in ${productName} - ${name.replace(/\s+/g, ' ').trim()}: ${url}${stamp}`]
      : []
  })
  // Each word a person defined that the reply names, where it is written and who wrote it.
  const terms = Array.isArray(output.terms) ? (output.terms as TermEntry[]) : []
  return [
    ...items,
    ...terms.map(
      (term) =>
        `Open in ${productName} - ${term.name}: ${term.url} - ${writtenWords(term.written.date, term.written.role)}`,
    ),
  ]
}
/**
 * A tool's output as a result: its fields for a cache or an audit go to `_meta`, the rest is read,
 * as JSON and, for the items it delivers, a line each that says where to open them.
 */
export const resultFor = (output: Record<string, unknown>, isError = false): ToolResult => {
  const isMeta = (key: string) => (metaFields as readonly string[]).includes(key)
  const shown = Object.fromEntries(Object.entries(output).filter(([key]) => !isMeta(key)))
  const meta = Object.fromEntries(Object.entries(output).filter(([key]) => isMeta(key)))
  const lines = openLines(shown)
  return {
    content: [
      { type: 'text', text: JSON.stringify(shown) },
      ...(lines.length ? [{ type: 'text' as const, text: lines.join('\n') }] : []),
    ],
    structuredContent: shown,
    ...(Object.keys(meta).length ? { _meta: meta } : {}),
    ...(isError ? { isError: true } : {}),
  }
}
/**
 * A result with a note first in it and a line of its own after it: a deprecated id's reply names
 * the tool to use instead, wherever a client reads a result.
 */
export const withNote = (result: ToolResult, note: string): ToolResult => ({
  ...result,
  content: [...result.content, { type: 'text', text: note }],
  structuredContent: { note, ...result.structuredContent },
})
// Reserve space for the JSON-RPC/SSE envelope, the bounded request id and digest metadata.
export const byteSize = (result: ToolResult) => Buffer.byteLength(JSON.stringify(result)) + 384
const hour = (now: Date) => now.toISOString().slice(0, 13) + ':00:00.000Z'
const linkInstructions =
  agentInstructions + ' To follow a useful item link, call read_item with its id.'
/** The same, for the agent contract's tools. */
const contextLinkInstructions =
  agentInstructions + ' To follow a useful link, call read_context with the item id.'
/** FR-322: what a link is and how to follow one, in the reply that lists them. */
export const linkStatement =
  'A link shows what a text refers to. It does not mean the item applies to your question.'
/** What a search that found nothing can try next. */
export const searchHint =
  'No fact matches these words. Try a metric, market or domain name, fewer words, or get_facts for a question with a scope.'
/** Added to the instructions when a reply gives the definitions a question asks for. */
export const definitionInstruction = `For what a metric means, quote definitions: the source's own words, and where they come from. Keep the facts apart as what is added to the definition, and never make up a definition.`
const relatedInstructions =
  agentInstructions +
  ' To read a neighbour item in full, call read_context with its id. A term node gives what its word means, as a person wrote it in Definitions: read the words by it and say whose words they are, but never give it as a checked source. Follow a link only when it helps answer the question.'
const report = (status: Resolution['status'], matched = 0, withheld = 0) => ({
  status,
  matched,
  withheld,
  links_withheld: 0,
  cut: false,
  cut_ids: [] as string[],
  checked: [] as string[],
  statements: [coverageStatement],
})
/** A result's first fields: `say`, and `next` when it has one (FR-344). */
export const saidFields = (said: Said) => ({
  say: said.say,
  ...(said.next ? { next: said.next } : {}),
})
export const failure = (message = 'The checks could not run. Try again shortly.'): ToolResult => {
  const said = failedSaid(message)
  return {
    content: [{ type: 'text', text: `${said.say} ${said.next}` }],
    structuredContent: {
      ...saidFields(said),
      status: 'check_failed',
      check_report: report('check_failed'),
    },
    isError: true,
  }
}

export function scopeOf(
  input: Pick<ContextInput, 'question' | 'metrics' | 'dimension_filters' | 'window'>,
  bundle: ServingBundle,
  today: string,
  options: { datesRequired?: boolean } = {},
) {
  const filters: Record<string, string[]> = Object.create(null) as Record<string, string[]>
  for (const filter of input.dimension_filters ?? [])
    filters[filter.dimension] = [...(filters[filter.dimension] ?? []), ...filter.values]
  return extractScope(
    input.question,
    bundle.terms,
    today,
    {
      ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
      ...(input.dimension_filters === undefined ? {} : { filters }),
      ...(input.window === undefined
        ? {}
        : { window: { start: input.window.from, end: shiftDate(input.window.to, 1) } }),
    },
    options,
  )
}
const domainName = (bundle: ServingBundle, areaId: string) =>
  bundle.areas.find((area) => area.id === areaId)?.name ?? areaId
/** Who looks after an item, as roles (FR-326): its domain's team and the owner of its domain. */
const ownerOutput = (item: ServingItem, bundle: ServingBundle) => ({
  team: item.owner.team,
  role: ownerRole(domainName(bundle, item.areaId)),
})
function itemOutput(
  item: ServingItem,
  bundle: ServingBundle,
  today: string,
  links: Link[],
  url: string,
) {
  const unverified =
    item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < today)
  return {
    id: item.id,
    version: item.version,
    edition: bundle.edition,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    ...(item.body === undefined ? {} : { body: item.body }),
    validity: item.validity,
    claim_level: item.claim,
    risk: item.riskLevel,
    freshness: unverified ? 'unverified' : 'verified',
    ...(unverified ? { unverified_reason: item.checkFlag ?? 'past_review_date' } : {}),
    evidence: item.evidence,
    // Only the contributor's own words: the default is what the claim level already says.
    ...(ownCaveat(item.notToConclude) ? { not_to_conclude: ownCaveat(item.notToConclude)! } : {}),
    owner: ownerOutput(item, bundle),
    ...reviewedOutput(item, bundle),
    links,
    url,
  }
}
/** Who checked an item before agents got it, as a role, and on which day (FR-326). */
function checkedOutput(item: ServingItem, bundle: ServingBundle) {
  const review = item.review
  return review
    ? {
        checked: {
          role: acceptedByRole(review.acceptedAs, domainName(bundle, review.areaId)),
          date: review.acceptedOn,
        },
      }
    : {}
}
/**
 * A context item as the agent contract gives it (docs/product.md, section 10): what it is and
 * says, when and where it applies, who checked it and when, its first source, its don't conclude
 * line, and whether it may be out of date or disagrees with another item in the same reply (the
 * overlap notice, FR-350). It never carries a comment, a report or a saved question: it is built
 * from the served edition only.
 */
export function contextEntry(
  item: ServingItem,
  bundle: ServingBundle,
  today: string,
  url: string,
  extra: { disagrees?: readonly string[] } = {},
) {
  const unverified =
    item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < today)
  const source = item.evidence[0]
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    kind: agentKinds[item.kind],
    when: whenWords(item.validity),
    applies: appliesWords(bundle, item.scope),
    ...checkedOutput(item, bundle),
    ...(source ? { source: { url: source.url, quote: source.quote } } : {}),
    not_to_conclude: item.notToConclude,
    ...(unverified ? { may_be_out_of_date: true } : {}),
    ...(extra.disagrees?.length ? { disagrees_with: [...extra.disagrees] } : {}),
    url,
  }
}
/** The fields a full reply's item has beside the entry: what the entry already says, it leaves out. */
const entryKeys = new Set([
  'id',
  'title',
  'summary',
  'kind',
  'not_to_conclude',
  'url',
  'conflicts_with',
])
/** Added to the instructions when a reply gives the definitions a question asks for, in a voice. */
const definitionsFor = (many: string) =>
  `For what a metric means, quote definitions: the source's own words, and where they come from. Keep the ${many} apart as what is added to the definition, and never make up a definition.`
/** Said when a metric group was asked for: its metrics are separate figures. */
export const groupInstruction =
  'A metric group was asked for, and say names its metrics: they are separate figures, so answer for each one and say so, or ask which one the person means; never give the group as one figure.'
/** Said in a concise reply: where the rest of an item is (FR-342). */
export const conciseInstruction =
  "This reply is concise: an item's body, evidence, owner and links are left out. Read an item with read_item before you quote its evidence or follow its links."
/** A delivered item in a concise reply: what an answer needs, and how many links it has. */
function conciseItem({
  body: _body,
  edition: _edition,
  evidence: _evidence,
  owner: _owner,
  links,
  ...item
}: ReturnType<typeof itemOutput> & { match: string }) {
  return { ...item, link_count: links.length }
}
/** At most `max` links in their order, besides every link to keep, which a cut leaves to last. */
export function trimLinks(links: readonly Link[], max: number, keep: (link: Link) => boolean) {
  let room = max - links.filter(keep).length
  return links.filter((link) => keep(link) || room-- > 0)
}
/** The instructions, with the caveat rule when an item carries its own caveat (FR-104). */
export const withCaveats = (instructions: string, items: readonly object[]) =>
  items.some((item) => 'not_to_conclude' in item)
    ? `${instructions} ${caveatInstruction}`
    : instructions
/** FR-611: an anonymous note that fails the check of `noteFindings` is refused. */
function safeNote(note: string | undefined, question?: string) {
  if (note && noteFindings(note, question).length) throw new Error('Note contains sensitive text')
  return note
}
function cursorFor(key: string, offset: number) {
  return Buffer.from(JSON.stringify({ key, offset })).toString('base64url')
}
function cursorOffset(cursor: string | undefined, key: string) {
  if (!cursor) return 0
  const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('key' in parsed) ||
    parsed.key !== key ||
    !('offset' in parsed) ||
    !Number.isSafeInteger(parsed.offset) ||
    Number(parsed.offset) < 0
  )
    throw new Error('Invalid or stale cursor')
  return Number(parsed.offset)
}
const pageKey = (bundle: ServingBundle, filter: unknown) =>
  createHash('sha256')
    .update(canonicalJson([bundle.edition, bundle.overlay, filter]))
    .digest('hex')

type Definition = { term: string }
/**
 * The sentences of an outcome tool's reply (FR-344): a name nobody knows, what find_facts found
 * and how, a domain in a line, or what changed. A refusal and what_changed bring their own.
 */
function outcomeSaid(
  name: OutcomeName,
  body: Record<string, unknown>,
  args: unknown,
  bundle: ServingBundle,
): Said {
  if (body.status === 'need_more_detail' || name === 'what_changed')
    return typeof body.say === 'string'
      ? { say: body.say, ...(typeof body.next === 'string' ? { next: body.next } : {}) }
      : refusedSaid('The question needs a clearer metric, market or domain.', String(body.message))
  if (name === 'domain_overview')
    return overviewSaid({
      domain: body.domain as { name: string; summary?: string } | undefined,
      coverage: body.coverage as { items: number; withheld?: number } | undefined,
      domains: (body.domains as unknown[] | undefined)?.length ?? 0,
      metrics: (body.vocabulary as { count: { metrics: number } } | undefined)?.count.metrics,
      readAs: (body.domain_read_as as { wrote: string; domain: string } | undefined) ?? null,
      waiting: body.waiting_in_source !== undefined,
    })
  const find = args as FindArgs
  const check = body.check_report as { withheld: number }
  const v1 = name === 'find_context'
  return findSaid(
    bundle,
    {
      status: String(body.status),
      foundBy: body.found_by === 'scope' ? 'scope' : 'words',
      total: Number(body.total),
      shown: ((v1 ? body.context : body.items) as unknown[]).length,
      scope: (body.scope_used as ResolvedScope | undefined) ?? null,
      assumed: (body.assumed_date as { sentence: string } | undefined)?.sentence ?? null,
      readsAs: (body.dates_read as { reads_as: string } | undefined)?.reads_as ?? null,
      withheld: check.withheld,
      definitions: ((body.definitions as Definition[] | undefined) ?? []).map((d) => d.term),
      area: find.domain === undefined ? null : (findArea(find.domain, bundle.areas)?.name ?? null),
    },
    v1 ? contextVoice : factVoice,
  )
}
/** The tools that read an outcome of the served edition: find_context, and the reads it replaced. */
type OutcomeName = 'find_facts' | 'find_context' | 'domain_overview' | 'what_changed'

/** find_context's arguments as findContext reads them: a kind by the name it is stored as. */
const findArgsOf = ({ kind, ...args }: ReturnType<typeof findContextInput.parse>): FindArgs => ({
  ...args,
  ...(kind ? { kind: kindFilters[kind] } : {}),
})

/** Whether find_facts's words or its domain name a domain, as findContext reads them. */
function namesDomain(bundle: ServingBundle, args: FindArgs) {
  return (
    args.domain !== undefined ||
    readQuery(args.query, bundle.terms, bundle.areas).used.domains.length > 0
  )
}

export function createToolService(
  source: EditionSource,
  store: AnonymousStore,
  now: () => Date = () => new Date(),
  /** Owners, gaps and editions for domain_overview and what_changed; without them they fail. */
  reads?: ServingReads,
  /** The web app's address, for each delivered item's page (FR-347); without it, a path on it. */
  web: string | null = null,
  /** Heed's help pages for search_help (FR-348); left out, the pages of this checkout. */
  help?: HelpLibrary,
) {
  const urlOf = (id: string) => itemUrl(web, id)
  /**
   * The words of a text that a person defined in Definitions, as the agent contract gives them
   * (src/domain/served-terms.ts): background for reading the words, never a checked source.
   */
  const termsOf = (bundle: ServingBundle, text: string): TermEntry[] =>
    termsIn(text, bundle.terms, bundle.written).map((use) =>
      termEntry(use, {
        domain: (areaId) => domainName(bundle, areaId),
        url: (name) => definitionUrl(web, name),
      }),
    )
  /** A reply's sentences, with what to do with the terms it names. */
  const withTermsNext = (said: Said, terms: readonly unknown[]): Said =>
    terms.length ? { ...said, next: said.next ? `${said.next} ${termsNext}` : termsNext } : said
  /**
   * The outcome tools (FR-338 to FR-340) on the live edition, or for find_facts an edition the
   * caller may select. A result that cannot fit the size limit loses its longest lists first.
   */
  async function outcome(
    name: OutcomeName,
    input: unknown,
    principal: Principal,
    maxBytes: number,
    onEdition: (seq: string) => void,
    today: string,
  ): Promise<ToolResult> {
    const find = name === 'find_facts' || name === 'find_context'
    const args =
      name === 'find_context'
        ? findArgsOf(findContextInput.parse(input))
        : name === 'find_facts'
          ? findInput.parse(input)
          : name === 'domain_overview'
            ? overviewInput.parse(input)
            : changesInput.parse(input)
    const edition = find ? (args as FindArgs).edition : undefined
    // Naming an edition, to read or to compare, needs edition scope, as for get_facts.
    const named =
      name === 'what_changed'
        ? ((args as ChangesArgs).edition ?? (args as ChangesArgs).since)
        : edition
    if (named && !principal.canSelectEdition)
      return failure(
        name === 'what_changed'
          ? 'Comparing named editions requires edition scope. Leave out edition and since for what the live edition changed.'
          : 'Selecting an edition requires edition scope.',
      )
    const bundle = await source.bundle(edition)
    onEdition(bundle.seq)
    const common = {
      edition: bundle.edition,
      overlay: bundle.overlay,
      tool_schema_digest: toolSchemaDigest,
    }
    if (!find && !reads) return failure('This tool is not available here.')
    const found = find
      ? findContext(
          bundle,
          args as FindArgs,
          today,
          // What a domain's source has beyond the vocabulary, read only for a domain named.
          reads && namesDomain(bundle, args as FindArgs) ? await reads.waiting() : null,
          name === 'find_context' ? contextVoice : factVoice,
        )
      : null
    const body: Record<string, unknown> =
      found && name === 'find_context'
        ? contextFound(found, bundle, today)
        : found
          ? cite(found)
          : name === 'domain_overview'
            ? await domainOverview(bundle, args, today, reads!)
            : await whatChanged(bundle, args as ChangesArgs, today, reads!)
    // FR-342: a concise find_facts or find_context leaves out the source details its definitions
    // already say in words.
    const concise = find && (args as FindArgs).response_format === 'concise'
    // find_context names the words of the query that a person defined (FR-138).
    const terms = name === 'find_context' ? termsOf(bundle, (args as FindArgs).query) : []
    const saidNow = (shown: Record<string, unknown>) =>
      withTermsNext(outcomeSaid(name, shown, args, bundle), terms)
    const out: Record<string, unknown> = {
      ...saidFields(saidNow(body)),
      ...common,
      ...(concise ? { response_format: 'concise' } : {}),
      ...body,
      ...(terms.length ? { terms } : {}),
      ...(body.check_report
        ? {}
        : { check_report: report(body.status === 'matched' ? 'matched' : 'need_more_detail') }),
    }
    if (concise && Array.isArray(out.definitions))
      out.definitions = (out.definitions as Record<string, unknown>[]).map(
        ({ source: _source, ...definition }) => definition,
      )
    const limit = Math.min(maxBytes, args.max_bytes)
    // Long lists are shortened from the end, the most useful entries first, until it fits: the
    // longest part of each list that fits is found by halving, so a large list costs few renders.
    for (const key of [
      'items',
      'context',
      'changes',
      'definitions',
      'domains',
      'metrics',
      'dimensions',
    ]) {
      const value = out[key]
      if (!Array.isArray(value) || byteSize(resultFor(out)) <= limit) continue
      const whole = [...(value as unknown[])]
      let fits = 0,
        over = whole.length
      while (over - fits > 1) {
        const middle = Math.floor((fits + over) / 2)
        out[key] = whole.slice(0, middle)
        if (byteSize(resultFor(out)) <= limit) fits = middle
        else over = middle
      }
      out[key] = whole.slice(0, fits)
      out.cut = true
    }
    // A shortened list changes how many are shown, which the sentence says.
    if (out.cut) Object.assign(out, saidFields(saidNow(out)))
    const rendered = resultFor(out)
    return byteSize(rendered) <= limit
      ? rendered
      : failure('The result cannot fit this size limit. Increase max_bytes.')
  }

  /** find_facts's items with their pages in Heed (FR-347). */
  function cite(body: ReturnType<typeof findContext>): Record<string, unknown> {
    return 'items' in body
      ? { ...body, items: body.items.map((item) => ({ ...item, url: urlOf(item.id) })) }
      : body
  }
  /**
   * find_context's reply: what find_facts found, with each item as the agent contract gives it
   * (titles and summaries, never a body) under context, with its page in Heed.
   */
  function contextFound(
    body: ReturnType<typeof findContext>,
    bundle: ServingBundle,
    today: string,
  ): Record<string, unknown> {
    if (!('items' in body)) return body
    const byId = new Map(bundle.items.map((item) => [item.id, item]))
    // A search result names its item and where it applies, without the source's sentence.
    const context = body.items.map((line) => {
      const { source: _source, ...entry } = contextEntry(
        byId.get(line.id)!,
        bundle,
        today,
        urlOf(line.id),
      )
      return { ...entry, match: line.match }
    })
    // context takes the place of items, so the reply reads in the same order.
    return Object.fromEntries(
      Object.entries(body).map(([key, value]): [string, unknown] =>
        key === 'items' ? ['context', context] : [key, value],
      ),
    )
  }

  /**
   * report (replacing report_gap and give_feedback): what the person says about a reply, a context
   * item or a question's scope, recorded as anonymous feedback on the reply (the gap job turns
   * missing, wrong and unclear into a gap for the reply's topic, FR-606 case 3) or as a gap for the
   * scope. It names the owner who will see it, when it can, and never who asked (FR-602).
   */
  async function reportFor(
    input: unknown,
    principal: Principal,
    onEdition: (seq: string) => void,
    today: string,
  ): Promise<ToolResult> {
    const args = reportInput.parse(input)
    const note = safeNote(args.note, args.question)
    const verdict = args.kind === 'helped' ? 'helpful' : args.kind
    const sent = (to: string | null, extra: Record<string, unknown> = {}, said?: Said) =>
      resultFor({
        ...saidFields(said ?? reportSaid({ kind: args.kind, to })),
        status: 'recorded',
        recorded: true,
        ...(to ? { to } : {}),
        ...extra,
      })
    if (args.reply_id !== undefined || args.context_id !== undefined) {
      let area: string | null = null
      let to: string | null = null
      if (args.context_id !== undefined) {
        // A context item is read as an agent reads it: one it may not see answers as one that
        // does not exist (FR-334).
        const bundle = await source.bundle()
        onEdition(bundle.seq)
        const item = bundle.items.find((i) => i.id === args.context_id)
        if (!item || !canRead(bundle, item, today))
          return resultFor({
            ...saidFields(readSaid(null, contextVoice)),
            status: 'no_match',
            recorded: false,
            message: 'Not found',
          })
        area = item.areaId
        to = ownerRole(domainName(bundle, item.areaId))
      }
      await store.feedback(args.reply_id ?? null, verdict, principal.client, note, area)
      return sent(to)
    }
    const scoped =
      args.question !== undefined ||
      args.metrics !== undefined ||
      args.dimension_filters !== undefined
    if (args.kind === 'missing' && scoped) {
      const bundle = await source.bundle()
      onEdition(bundle.seq)
      const scope = scopeOf(
        {
          question: args.question ?? '',
          ...(args.metrics ? { metrics: args.metrics } : {}),
          ...(args.dimension_filters ? { dimension_filters: args.dimension_filters } : {}),
          ...(args.window ? { window: args.window } : {}),
        },
        bundle,
        today,
      )
      if (scope.status !== 'resolved')
        return resultFor({
          ...saidFields(unreadSaid(bundle, scope.issues, args.question)),
          status: 'need_more_detail',
          recorded: false,
          options: scope.issues,
        })
      const topic = topicFor(scope.scope, bundle.metricArea)
      const id = await store.reportGap(topic, note)
      const assumed = scope.assumed ? assumedDate(scope.assumed) : null
      const to = topic.area ? ownerRole(domainName(bundle, topic.area)) : null
      return sent(
        to,
        { gap_id: id },
        reportSaid({
          kind: 'missing',
          to,
          scope: scopeWords(bundle, scope.scope, {
            show: !assumed,
            readsAs: scope.dates?.reads_as ?? null,
          }),
          assumed: assumed?.note.sentence ?? null,
        }),
      )
    }
    return resultFor({
      say: `Nothing was sent yet: it needs to know which answer or ${concepts.fact.name} this is about.`,
      next:
        args.kind === 'missing'
          ? "Call report again with the reply_id of the get_context reply, or context_id; with no reply, pass the question's metrics, markets and dates."
          : 'Call report again with the reply_id of the get_context reply, or the context_id of the item it is about.',
      status: 'need_more_detail',
      recorded: false,
    })
  }

  return async function execute(
    name: ServedToolName,
    input: unknown,
    principal: Principal,
    maxBytes: number,
    record: (r: AnonymousRecord) => void,
    onEdition: (seq: string) => void = () => {},
  ): Promise<ToolResult> {
    const started = performance.now()
    const date = now(),
      today = date.toISOString().slice(0, 10)
    try {
      if (name === 'give_feedback') {
        const args = feedbackInput.parse(input)
        await store.feedback(args.delivery_id, args.verdict, principal.client, safeNote(args.note))
        return resultFor({ recorded: true, check_report: report('matched') })
      }
      if (name === 'report') return await reportFor(input, principal, onEdition, today)
      if (
        name === 'find_facts' ||
        name === 'find_context' ||
        name === 'domain_overview' ||
        name === 'what_changed'
      )
        return await outcome(name, input, principal, maxBytes, onEdition, today)
      // Heed's own help reads no edition: the same pages whatever is live.
      if (name === 'search_help')
        return resultFor(helpAnswer(help ?? repositoryHelp(), helpInput.parse(input).query, web))
      const args =
        name === 'get_facts'
          ? contextInput.parse(input)
          : name === 'get_context'
            ? getContextInput.parse(input)
            : name === 'read_item' || name === 'read_context'
              ? readInput.parse(input)
              : name === 'get_related'
                ? relatedInput.parse(input)
                : name === 'search_facts'
                  ? searchInput.parse(input)
                  : name === 'improve_question'
                    ? improveInput.parse(input)
                    : gapInput.parse(input)
      const edition = 'edition' in args ? args.edition : undefined
      if (edition && !principal.canSelectEdition)
        return failure('Selecting an edition requires edition scope.')
      const bundle = await source.bundle(edition)
      onEdition(bundle.seq)
      const common = {
        edition: bundle.edition,
        overlay: bundle.overlay,
        tool_schema_digest: toolSchemaDigest,
      }
      const limit = Math.min(maxBytes, 'max_bytes' in args ? args.max_bytes : 100000)
      if (
        name === 'get_facts' ||
        name === 'get_context' ||
        name === 'improve_question' ||
        name === 'report_gap'
      ) {
        const scoped = args as ContextInput | GetContextInput
        // get_context speaks the agent contract (docs/product.md, section 10); get_facts, its
        // deprecated id, keeps its reply for one release.
        const v1 = name === 'get_context'
        // improve_question coaches a question, so it says the dates are missing (FR-307); the
        // others read a question without dates at today, and say so.
        const scope = scopeOf(scoped, bundle, today, {
          datesRequired: name === 'improve_question',
        })
        const assumed =
          scope.status === 'resolved' && scope.assumed ? assumedDate(scope.assumed) : null
        // How Heed read the dates in the question's words, said with the scope (FR-304).
        const read = (scope.status === 'resolved' && scope.dates) || null
        const resolution = resolve(bundle, {
          scope,
          today,
          groups: noGroups,
          hiddenMetrics: [],
          sizeLimit: Number.MAX_SAFE_INTEGER,
          dependenciesAvailable: true,
        })
        const base = report(
          resolution.status,
          resolution.report.matched,
          resolution.report.withheld,
        )
        const check = {
          ...base,
          checked: resolution.report.checked,
          statements: [...base.statements, ...(assumed ? [assumed.statement] : [])],
        }
        if (name === 'report_gap') {
          if (scope.status !== 'resolved')
            return resultFor({
              ...saidFields(unreadSaid(bundle, scope.issues, scoped.question)),
              ...common,
              status: 'need_more_detail',
              options: scope.issues,
              check_report: check,
            })
          const note = safeNote(gapInput.parse(input).note, scoped.question)
          const id = await store.reportGap(topicFor(scope.scope, bundle.metricArea), note)
          return resultFor({
            ...saidFields(
              gapSaid(
                scopeWords(bundle, scope.scope, {
                  show: !assumed,
                  readsAs: read?.reads_as ?? null,
                }),
                assumed ? assumed.note.sentence : null,
              ),
            ),
            ...common,
            recorded: true,
            gap_id: id,
            ...(assumed ? { assumed_date: assumed.note } : {}),
            ...(read ? { dates_read: read } : {}),
            check_report: check,
          })
        }
        if (name === 'improve_question') {
          return resultFor({
            ...saidFields(
              resolution.scope
                ? improveSaid(
                    scopeWords(bundle, resolution.scope, {
                      show: true,
                      readsAs: read?.reads_as ?? null,
                    }),
                  )
                : unreadSaid(bundle, resolution.issues, scoped.question),
            ),
            ...common,
            status: resolution.status,
            options: resolution.issues,
            scope_used: resolution.scope,
            ...(read ? { dates_read: read } : {}),
            check_report: check,
            suggestions: [
              'Name the metric definition and the date range.',
              'Specify the market and compare it with an unaffected market and earlier dates.',
            ],
            events: resolution.items
              .filter((m) => bundle.items.find((i) => i.id === m.id)?.kind === 'event')
              .slice(0, 20)
              .map((m) => ({ id: m.id })),
            guides: resolution.items
              .filter((m) => bundle.items.find((i) => i.id === m.id)?.kind === 'guide')
              .slice(0, 20)
              .map((m) => ({ id: m.id })),
            instructions: linkInstructions,
          })
        }
        const index = linkIndex(bundle)
        // A link that names where an asked metric is defined is the last one a cut takes.
        const asked = new Set(
          (resolution.scope?.metrics ?? []).flatMap((key) => [key, ...metricsOf(bundle, key)]),
        )
        const origin = (link: Link) =>
          link.target.source_ref !== undefined && asked.has(link.target.id)
        // A metric group asked for, or several metrics: each item names the ones it is about, so a
        // model never gives them as one figure. A reply about one metric stays as it is.
        const groups = resolution.scope ? askedGroups(bundle, resolution.scope) : []
        const metrics = resolution.scope ? askedMetrics(bundle, resolution.scope) : []
        const aboutOf = (item: ServingItem) => {
          const own = new Set(item.scope.metrics.flatMap((key) => metricsOf(bundle, key)))
          return metrics
            .filter((key) => !own.size || own.has(key))
            .map((key) => bundle.terms.find((t) => t.key === key)?.name ?? key)
        }
        const items = resolution.items.map((match) => {
          const item = index.item(match.id) as ServingItem
          const linked = outgoing(bundle, item, today, resolution.scope?.window, index)
          check.links_withheld += linked.withheld
          return {
            // At most 8 links an item (FR-331), even with more that name a definition.
            ...itemOutput(
              item,
              bundle,
              today,
              trimLinks(linked.links, 8, origin).slice(0, 8),
              urlOf(item.id),
            ),
            match: match.match,
            ...(metrics.length > 1 ? { about: aboutOf(item) } : {}),
            ...(match.restrictions.length
              ? {
                  applies_note: match.restrictions
                    .map((r) => `Applies to ${r.dimension}: ${r.values.join(', ')} only.`)
                    .join(' '),
                }
              : {}),
          }
        })
        // A definition question gets the definitions first: the source's words, where they come
        // from and what Heed adds, as find_facts gives them (FR-338). A cut never takes them.
        const defined =
          resolution.scope && asksDefinition(scoped.question)
            ? [...asked]
                .flatMap((key) => {
                  const term = bundle.terms.find((t) => t.key === key)
                  return term && termShown(bundle, term) ? [term] : []
                })
                .slice(0, 5)
            : []
        const definitions = defined.map((term) => definitionOf(bundle, term, today))
        // The words of the question a person defined (FR-138): what they mean here, never a
        // checked source, so they change neither the items nor the answer state.
        const terms = v1 ? termsOf(bundle, scoped.question) : []
        const delivery = randomUUID()
        const concise = scoped.response_format === 'concise'
        const instructions = withCaveats(
          [
            v1 ? contextLinkInstructions : linkInstructions,
            ...(definitions.length
              ? [v1 ? definitionsFor(`${concepts.fact.name}s`) : definitionInstruction]
              : []),
            ...(groups.length ? [groupInstruction] : []),
            ...(assumed ? [assumed.instruction] : []),
          ].join(' '),
          v1 ? [{ not_to_conclude: true }] : items,
        )
        const dated = {
          ...(assumed ? { assumed_date: assumed.note } : {}),
          ...(read ? { dates_read: read } : {}),
        }
        // The domains the question is about, with what their owners wrote about them (FR-813).
        const domains = askedDomains(bundle, resolution.scope, concise)
        // The reply's status, which carries the answer state (FR-349), as the items stand after
        // any cut: get_facts keeps the resolver's.
        // A value the question asks about, such as one of two markets, that no item given applies
        // to: an item applies to it when it names no value of that dimension, or names it.
        const uncovered = () =>
          Object.entries(resolution.scope?.filters ?? {}).some(([dimension, values]) =>
            values.some(
              (value) =>
                !items.some((item) => {
                  const own = (index.item(item.id) as ServingItem).scope.dimensionValues.filter(
                    (row) => row.dimension === dimension,
                  )
                  return !own.length || own.some((row) => row.value === value)
                }),
            ),
          )
        const statusNow = () =>
          v1
            ? replyStatus({
                status: resolution.status,
                items: items.map((item) => ({
                  match: item.match,
                  unverified: item.freshness === 'unverified',
                })),
                uncovered: uncovered(),
                assumed: !!assumed,
              })
            : resolution.status
        // FR-344: what the reply read and did not, as it stands after any cut.
        const said = () =>
          withTermsNext(
            contextSaid(
              bundle,
              {
                status: statusNow(),
                scope: resolution.scope,
                issues: resolution.issues,
                question: scoped.question,
                delivered: items.length,
                partial: items.filter((item) => item.match === 'partial').length,
                unverified: items.filter((item) => item.freshness === 'unverified').length,
                cut: check.cut_ids.length,
                withheld: resolution.withheld.map((w) => w.reason),
                assumed: assumed?.note.sentence ?? null,
                readsAs: read?.reads_as ?? null,
                groups,
                about: metrics.length > 1,
              },
              v1 ? contextVoice : factVoice,
            ),
            terms,
          )
        // What was looked up, in words, for the agent contract's reply.
        const askedWords = resolution.scope
          ? scopeWords(bundle, resolution.scope, { show: true, readsAs: read?.reads_as ?? null })
          : null
        // Each item as the agent contract gives it, from the items as they stand after any cut:
        // an item disagrees only with another item in the same reply.
        const entries = (full: boolean) => {
          const ids = new Set(items.map((item) => item.id))
          return items.map((item) => {
            const serving = index.item(item.id) as ServingItem
            const entry = contextEntry(serving, bundle, today, item.url, {
              disagrees: serving.conflicts.filter((id) => ids.has(id)),
            })
            const about = item.about ? { about: item.about } : {}
            if (!full) return { ...entry, ...about }
            const rest = Object.fromEntries(
              Object.entries(item).filter(([key]) => !entryKeys.has(key)),
            )
            return { ...entry, ...rest }
          })
        }
        const renderV1 = () => {
          const head = {
            status: statusNow(),
            ...saidFields(said()),
            asked: askedWords,
          }
          return concise
            ? resultFor({
                ...head,
                context: entries(false),
                ...(terms.length ? { terms } : {}),
                ...(definitions.length ? { definitions } : {}),
                reply_id: delivery,
                ...common,
              })
            : resultFor({
                ...head,
                context: entries(true),
                ...(terms.length ? { terms } : {}),
                reply_id: delivery,
                ...common,
                response_format: 'full',
                scope_used: resolution.scope,
                ...dated,
                ...(domains.length ? { domains } : {}),
                ...(definitions.length ? { definitions } : {}),
                options: resolution.issues,
                check_report: check,
                instructions,
              })
        }
        const out = {
          ...common,
          status: resolution.status,
          delivery_id: delivery,
          scope_used: resolution.scope,
          ...dated,
          ...(domains.length ? { domains } : {}),
          ...(definitions.length ? { definitions } : {}),
          items,
          options: resolution.issues,
          check_report: check,
          instructions,
        }
        // FR-342: the concise reply, without what read_item gives for one item.
        const renderLegacy = () =>
          concise
            ? resultFor({
                ...saidFields(said()),
                ...common,
                response_format: 'concise',
                status: out.status,
                delivery_id: delivery,
                scope_used: out.scope_used,
                ...dated,
                ...(domains.length ? { domains } : {}),
                ...(definitions.length ? { definitions } : {}),
                items: items.map(conciseItem),
                options: out.options,
                check_report: check,
                instructions: `${instructions} ${conciseInstruction}`,
              })
            : resultFor({ ...saidFields(said()), ...out })
        const render = () => (v1 ? renderV1() : renderLegacy())
        const cutItem = () => {
          check.cut = true
          check.cut_ids.push(items.pop()!.id)
        }
        // Items past max_items go first, so their links never cost the delivered items theirs.
        while (items.length > scoped.max_items) cutItem()
        // What a domain is, in full, is background: it goes before any link or item; its summary
        // line stays (FR-321).
        if (byteSize(render()) > limit) for (const domain of domains) delete domain.description
        for (const max of [5, 0])
          if (byteSize(render()) > limit)
            for (const item of items) {
              const kept = trimLinks(item.links, max, origin)
              if (kept.length < item.links.length) check.cut = true
              item.links = kept
            }
        if (byteSize(render()) > limit)
          for (const item of items) {
            if (item.links.length) check.cut = true
            item.links = []
          }
        while (items.length && byteSize(render()) > limit) cutItem()
        const deliveredIds = new Set(items.map((i) => i.id))
        // get_facts names a conflict on the item; get_context says disagrees_with in its entry.
        if (!v1)
          for (const item of items) {
            const conflicts = bundle.items
              .find((i) => i.id === item.id)!
              .conflicts.filter((id) => deliveredIds.has(id))
            if (conflicts.length) Object.assign(item, { conflicts_with: conflicts })
          }
        const output = render()
        if (byteSize(output) > limit)
          return failure('The required report cannot fit this size limit. Increase max_bytes.')
        record({
          kind: 'delivery',
          value: {
            id: delivery,
            hour: hour(date),
            client: principal.client,
            caller: principal.caller,
            edition: bundle.seq,
            overlay: bundle.overlay,
            digest: toolSchemaDigest,
            topic: resolution.scope ? topicFor(resolution.scope, bundle.metricArea) : null,
            scope: resolution.scope
              ? { ...resolution.scope, today, max_items: scoped.max_items, max_bytes: limit }
              : null,
            status: resolution.status,
            // What Observability counts (FR-620): the state the reply gave, as it was given.
            state: stateOfStatus(statusNow()),
            delivered: items.map((i, rank) => ({
              id: i.id,
              v: i.version,
              rank,
              label: i.freshness,
            })),
            withheld: resolution.withheld,
            cut: check.cut,
            bytes: byteSize(output),
            duration: Math.round(performance.now() - started),
          },
        })
        return output
      }
      if (name === 'read_item' || name === 'read_context') {
        // read_context speaks the agent contract; read_item, its deprecated id, keeps its reply.
        const v1 = name === 'read_context'
        const voice = v1 ? contextVoice : factVoice
        const read = readInput.parse(input)
        const item = bundle.items.find((i) => i.id === read.id)
        if (!item || !canRead(bundle, item, today))
          return resultFor({
            ...saidFields(readSaid(null, voice)),
            ...common,
            status: 'no_match',
            message: 'Not found',
            check_report: report('no_match'),
          })
        const links = outgoing(bundle, item, today)
        const backlinks = bundle.links
          .filter((l) => l.to_id === item.id && l.rel === 'mentions')
          .map((l) => bundle.items.find((i) => i.id === l.from_item))
          .filter((i): i is ServingItem => !!i && canRead(bundle, i, today))
          .filter((i, index, all) => all.findIndex((p) => p.id === i.id) === index)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
        const key = pageKey(bundle, { tool: name, id: read.id }),
          offset = cursorOffset(read.cursor, key)
        const page = backlinks.slice(offset, offset + 20).map((i) => ({ id: i.id, title: i.title }))
        const shown = itemOutput(item, bundle, today, links.links, urlOf(item.id))
        // The whole item as the agent contract gives it, then what read_item gave beside that.
        const whole = v1
          ? {
              ...contextEntry(item, bundle, today, urlOf(item.id)),
              ...Object.fromEntries(Object.entries(shown).filter(([k]) => !entryKeys.has(k))),
            }
          : shown
        // The words of the item a person defined (FR-138), as the agent contract gives them.
        const terms = v1
          ? termsOf(bundle, [item.title, item.summary, item.body ?? ''].join('\n'))
          : []
        const out = {
          ...saidFields(
            withTermsNext(
              readSaid(v1 ? { kind: agentKinds[item.kind], version: item.version } : item, voice),
              terms,
            ),
          ),
          ...common,
          status: 'matched',
          [v1 ? 'context' : 'item']: whole,
          ...(terms.length ? { terms } : {}),
          backlinks: { count: backlinks.length, items: page },
          next_cursor:
            offset + page.length < backlinks.length ? cursorFor(key, offset + page.length) : null,
          ttlMs: 0,
          cacheScope: 'private',
          check_report: { ...report('matched', 1), links_withheld: links.withheld },
          instructions: withCaveats(v1 ? contextLinkInstructions : linkInstructions, [whole]),
        }
        const rendered = resultFor(out)
        return byteSize(rendered) <= limit
          ? rendered
          : failure('The item cannot fit this size limit. Increase max_bytes.')
      }
      if (name === 'get_related') {
        const ask = relatedInput.parse(input)
        const graph = related(bundle, {
          id: ask.id,
          relations: ask.relations,
          depth: ask.depth,
          today,
          window: ask.window && { start: ask.window.from, end: shiftDate(ask.window.to, 1) },
        })
        // A start the caller may not see answers exactly like one that does not exist (FR-334).
        if (!graph.found)
          return resultFor({
            ...saidFields(relatedSaid(null)),
            ...common,
            status: 'no_match',
            message: 'Not found',
            check_report: report('no_match'),
          })
        const key = pageKey(bundle, {
            tool: name,
            id: ask.id,
            relations: ask.relations ? [...new Set(ask.relations)].sort() : null,
            depth: ask.depth,
            window: ask.window ?? null,
          }),
          offset = cursorOffset(ask.cursor, key)
        const page = graph.nodes.slice(offset, offset + ask.max_nodes)
        const render = () => {
          const end = offset + page.length
          return resultFor({
            ...saidFields(
              relatedSaid({ shown: page.length, total: graph.nodes.length, depth: ask.depth }),
            ),
            ...common,
            status: 'matched',
            root: graph.root,
            depth: ask.depth,
            nodes: page,
            // An edge is on the page that lists its later end, so paging never repeats one.
            edges: graph.edges
              .filter((e) => e.after >= offset && e.after < end)
              .map(({ after: _after, ...edge }) => edge),
            counts: graph.counts,
            next_cursor: end < graph.nodes.length ? cursorFor(key, end) : null,
            ttlMs: 0,
            cacheScope: 'private',
            check_report: {
              ...report('matched', page.length),
              links_withheld: graph.withheld,
              statements: [linkStatement],
            },
            instructions: relatedInstructions,
          })
        }
        do {
          const rendered = render()
          if (byteSize(rendered) <= limit) return rendered
          page.pop()
        } while (page.length)
        return failure('The neighbours cannot fit this size limit. Increase max_bytes.')
      }
      const search = searchInput.parse(input)
      // A domain by its id or its name (FR-332's forms): an agent knows names, not ids.
      const area = search.area === undefined ? null : findArea(search.area, bundle.areas)
      if (search.area !== undefined && !area) {
        const refusal = unknownDomain(search.area, bundle)
        return resultFor({
          ...saidFields(refusal),
          ...common,
          status: 'need_more_detail',
          message: refusal.message,
          items: [],
          options: [
            { field: 'area', input: search.area, options: bundle.areas.map((a) => a.id).sort() },
          ],
          domains: bundle.areas.map((a) => ({ id: a.id, name: a.name })),
          check_report: report('need_more_detail'),
        })
      }
      const key = pageKey(bundle, {
          tool: name,
          query: search.query,
          kind: search.kind ?? null,
          area: area?.id ?? null,
          mentions: search.mentions ?? null,
        }),
        offset = cursorOffset(search.cursor, key)
      const index = linkIndex(bundle)
      const read = readQuery(search.query, bundle.terms, bundle.areas)
      const visible = bundle.items.filter(
        (item) =>
          (!search.kind || item.kind === search.kind) &&
          (!area || item.areaId === area.id) &&
          (!search.mentions ||
            outgoing(bundle, item, today, undefined, index).links.some(
              (l) => l.rel === 'mentions' && l.target.id === search.mentions,
            )) &&
          canRead(bundle, item, today),
      )
      const candidates = rankItems(read, visible, bundle.terms)
      const page = candidates.slice(offset, offset + search.limit).map(({ item: i, all }) => ({
        id: i.id,
        version: i.version,
        kind: i.kind,
        title: i.title,
        summary: i.summary,
        owner: ownerOutput(i, bundle),
        ...reviewedOutput(i, bundle),
        link_counts: outgoing(bundle, i, today, undefined, index).links.length,
        ...(read.concepts.length ? { match: all ? 'all' : 'some' } : {}),
        url: urlOf(i.id),
      }))
      // The domains the search is about, so "what does Sales cover" has an answer even when
      // no item text says "Sales".
      const domains = [...new Set([...(area ? [area.id] : []), ...read.used.domains])].flatMap(
        (id) => {
          const a = bundle.areas.find((x) => x.id === id)
          if (!a) return []
          return [
            {
              ...domainAbout(a, false),
              items: bundle.items.filter((i) => i.areaId === a.id && canRead(bundle, i, today))
                .length,
            },
          ]
        },
      )
      const sayFor = () =>
        searchSaid({
          status: candidates.length ? 'matched' : 'no_match',
          query: search.query,
          total: candidates.length,
          shown: page.length,
          area: area?.name ?? null,
        })
      const out = {
        ...saidFields(sayFor()),
        ...common,
        status: candidates.length ? 'matched' : 'no_match',
        items: page,
        query_used: read.used,
        ...(domains.length ? { domains } : {}),
        next_cursor: null as string | null,
        ttlMs: 0,
        cacheScope: 'private',
        check_report: {
          ...report(candidates.length ? 'matched' : 'no_match', candidates.length),
          ...(candidates.length ? {} : { statements: [coverageStatement, searchHint] }),
        },
      }
      do {
        Object.assign(out, saidFields(sayFor()))
        out.next_cursor =
          offset + page.length < candidates.length ? cursorFor(key, offset + page.length) : null
        if (byteSize(resultFor(out)) <= limit) return resultFor(out)
        page.pop()
      } while (page.length)
      return failure('A search result cannot fit this size limit. Increase max_bytes.')
    } catch {
      return failure()
    }
  }
}
