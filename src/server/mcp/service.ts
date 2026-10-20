import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson } from '../../domain/canonical.ts'
import { noGroups } from '../../domain/item.ts'
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
import { acceptedWords, ownerRole } from '../../domain/served-review.ts'
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
  askedGroups,
  askedMetrics,
  contextSaid,
  failedSaid,
  findSaid,
  gapSaid,
  improveSaid,
  overviewSaid,
  readSaid,
  refusedSaid,
  relatedSaid,
  scopeWords,
  searchSaid,
  unreadSaid,
  type Said,
} from '../../domain/say.ts'
import {
  changesInput,
  contextInput,
  feedbackInput,
  findInput,
  gapInput,
  helpInput,
  improveInput,
  overviewInput,
  readInput,
  relatedInput,
  searchInput,
  type ContextInput,
} from './schemas.ts'
import { toolSchemaDigest, type ServedToolName } from './tools.ts'
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
/**
 * One line per delivered item, or per section of a help page, after the JSON: where a person
 * opens it in Heed (FR-347, FR-348).
 */
function openLines(output: Record<string, unknown>): string[] {
  const listed = [
    ...(Array.isArray(output.items) ? (output.items as unknown[]) : []),
    ...(output.item ? [output.item] : []),
    ...(Array.isArray(output.results) ? (output.results as unknown[]) : []),
  ]
  return listed.flatMap((item) => {
    const { title, page, section, url, reviewed } = item as Record<string, unknown>
    const name =
      typeof title === 'string'
        ? title
        : typeof page === 'string'
          ? typeof section === 'string'
            ? `${page}, ${section}`
            : page
          : null
    const review = reviewed as Record<string, string> | undefined
    const stamp = review
      ? ` - ${acceptedWords(review.accepted_on!, review.accepted_by!, review.in_edition!)}`
      : ''
    return name !== null && typeof url === 'string'
      ? [`Open in ${productName} - ${name.replace(/\s+/g, ' ').trim()}: ${url}${stamp}`]
      : []
  })
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
// Reserve space for the JSON-RPC/SSE envelope, the bounded request id and digest metadata.
export const byteSize = (result: ToolResult) => Buffer.byteLength(JSON.stringify(result)) + 384
const hour = (now: Date) => now.toISOString().slice(0, 13) + ':00:00.000Z'
const linkInstructions =
  agentInstructions + ' To follow a useful item link, call read_item with its id.'
/** FR-322: what a link is and how to follow one, in the reply that lists them. */
export const linkStatement =
  'A link shows what a text refers to. It does not mean the item applies to your question.'
/** What a search that found nothing can try next. */
export const searchHint =
  'No fact matches these words. Try a metric, market or domain name, fewer words, or get_context for a question with a scope.'
/** Added to the instructions when a reply gives the definitions a question asks for. */
export const definitionInstruction = `For what a metric means, quote definitions: the source's own words, and where they come from. Keep the facts apart as what is added to the definition, and never make up a definition.`
const relatedInstructions =
  agentInstructions +
  ' To read a neighbour item in full, call read_item with its id. Follow a link only when it helps answer the question.'
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
 * The sentences of an outcome tool's reply (FR-344): a name nobody knows, what find_context found
 * and how, a domain in a line, or what changed. A refusal and what_changed bring their own.
 */
function outcomeSaid(
  name: 'find_context' | 'domain_overview' | 'what_changed',
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
  return findSaid(bundle, {
    status: String(body.status),
    foundBy: body.found_by === 'scope' ? 'scope' : 'words',
    total: Number(body.total),
    shown: (body.items as unknown[]).length,
    scope: (body.scope_used as ResolvedScope | undefined) ?? null,
    assumed: (body.assumed_date as { sentence: string } | undefined)?.sentence ?? null,
    readsAs: (body.dates_read as { reads_as: string } | undefined)?.reads_as ?? null,
    withheld: check.withheld,
    definitions: ((body.definitions as Definition[] | undefined) ?? []).map((d) => d.term),
    area: find.domain === undefined ? null : (findArea(find.domain, bundle.areas)?.name ?? null),
  })
}

/** Whether find_context's words or its domain name a domain, as findContext reads them. */
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
   * The outcome tools (FR-338 to FR-340) on the live edition, or for find_context an edition the
   * caller may select. A result that cannot fit the size limit loses its longest lists first.
   */
  async function outcome(
    name: 'find_context' | 'domain_overview' | 'what_changed',
    input: unknown,
    principal: Principal,
    maxBytes: number,
    onEdition: (seq: string) => void,
    today: string,
  ): Promise<ToolResult> {
    const args =
      name === 'find_context'
        ? findInput.parse(input)
        : name === 'domain_overview'
          ? overviewInput.parse(input)
          : changesInput.parse(input)
    const edition = name === 'find_context' ? (args as FindArgs).edition : undefined
    // Naming an edition, to read or to compare, needs edition scope, as for get_context.
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
    if (name !== 'find_context' && !reads) return failure('This tool is not available here.')
    const body: Record<string, unknown> =
      name === 'find_context'
        ? cite(
            findContext(
              bundle,
              args as FindArgs,
              today,
              // What a domain's source has beyond the vocabulary, read only for a domain named.
              reads && namesDomain(bundle, args as FindArgs) ? await reads.waiting() : null,
            ),
          )
        : name === 'domain_overview'
          ? await domainOverview(bundle, args, today, reads!)
          : await whatChanged(bundle, args as ChangesArgs, today, reads!)
    // FR-342: a concise find_context leaves out the source details its definitions already say
    // in words.
    const concise = name === 'find_context' && (args as FindArgs).response_format === 'concise'
    const out: Record<string, unknown> = {
      ...saidFields(outcomeSaid(name, body, args, bundle)),
      ...common,
      ...(concise ? { response_format: 'concise' } : {}),
      ...body,
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
    for (const key of ['items', 'changes', 'definitions', 'domains', 'metrics', 'dimensions']) {
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
    if (out.cut) Object.assign(out, saidFields(outcomeSaid(name, out, args, bundle)))
    const rendered = resultFor(out)
    return byteSize(rendered) <= limit
      ? rendered
      : failure('The result cannot fit this size limit. Increase max_bytes.')
  }

  /** find_context's items with their pages in Heed (FR-347). */
  function cite(body: ReturnType<typeof findContext>): Record<string, unknown> {
    return 'items' in body
      ? { ...body, items: body.items.map((item) => ({ ...item, url: urlOf(item.id) })) }
      : body
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
      if (name === 'find_context' || name === 'domain_overview' || name === 'what_changed')
        return await outcome(name, input, principal, maxBytes, onEdition, today)
      // Heed's own help reads no edition: the same pages whatever is live.
      if (name === 'search_help')
        return resultFor(helpAnswer(help ?? repositoryHelp(), helpInput.parse(input).query, web))
      const args =
        name === 'get_context'
          ? contextInput.parse(input)
          : name === 'read_item'
            ? readInput.parse(input)
            : name === 'get_related'
              ? relatedInput.parse(input)
              : name === 'search_context'
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
      if (name === 'get_context' || name === 'improve_question' || name === 'report_gap') {
        const scoped = args as ContextInput
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
        // from and what Heed adds, as find_context gives them (FR-338). A cut never takes them.
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
        const delivery = randomUUID()
        const concise = scoped.response_format === 'concise'
        const instructions = withCaveats(
          [
            linkInstructions,
            ...(definitions.length ? [definitionInstruction] : []),
            ...(groups.length ? [groupInstruction] : []),
            ...(assumed ? [assumed.instruction] : []),
          ].join(' '),
          items,
        )
        const dated = {
          ...(assumed ? { assumed_date: assumed.note } : {}),
          ...(read ? { dates_read: read } : {}),
        }
        // The domains the question is about, with what their owners wrote about them (FR-813).
        const domains = askedDomains(bundle, resolution.scope, concise)
        // FR-344: what the reply read and did not, as it stands after any cut.
        const said = () =>
          contextSaid(bundle, {
            status: resolution.status,
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
          })
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
        const render = () =>
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
      if (name === 'read_item') {
        const read = readInput.parse(input)
        const item = bundle.items.find((i) => i.id === read.id)
        if (!item || !canRead(bundle, item, today))
          return resultFor({
            ...saidFields(readSaid(null)),
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
        const out = {
          ...saidFields(readSaid(item)),
          ...common,
          status: 'matched',
          item: shown,
          backlinks: { count: backlinks.length, items: page },
          next_cursor:
            offset + page.length < backlinks.length ? cursorFor(key, offset + page.length) : null,
          ttlMs: 0,
          cacheScope: 'private',
          check_report: { ...report('matched', 1), links_withheld: links.withheld },
          instructions: withCaveats(linkInstructions, [shown]),
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
