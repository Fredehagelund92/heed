import { rankItems, readQuery, stem, type ReadQuery } from '../../domain/context-search.ts'
import {
  domainReadAs,
  domainReadAsInstruction,
  knownWords,
  matchDomain,
  storedNameNote,
} from '../../domain/domain-match.ts'
import { changeSentence, noChanges, type EditionChangeKind } from '../../domain/editions.ts'
import { audienceAllows, itemKinds, noGroups, type ItemKind } from '../../domain/item.ts'
import { canRead, withholding } from '../../domain/links.ts'
import { proposalAttributes } from '../../domain/proposal-attributes.ts'
import { ownCaveat } from '../../domain/proposal-rules.ts'
import {
  agentInstructions,
  caveatInstruction,
  coverageStatement,
  metricsOf,
  resolve,
  type Resolution,
} from '../../domain/resolver.ts'
import { termShown } from '../../domain/links.ts'
import { assumedDate, extractScope, unknownName } from '../../domain/scope.ts'
import { itemDisplayStatus, needsALook } from '../../domain/status.ts'
import { acceptedByRole, ownerRole } from '../../domain/served-review.ts'
import { fullDayWords } from '../../domain/dates.ts'
import { shiftDate } from '../../domain/validity.ts'
import {
  memberNames,
  memberTokens,
  nameSimilarity,
  normalizeName,
  suggestTerms,
} from '../../domain/vocabulary.ts'
import type { ServingBundle, ServingItem, ServingTerm } from '../modules/editions/index.ts'
import type { Changes, ServingReads, WaitingTerms } from './reads.ts'
import type * as z from 'zod'
import type { changesInput, findInput, overviewInput } from './schemas.ts'
import { changesSaid, refusedSaid, unknownDomainWords } from '../../domain/say.ts'
import { concepts } from '../../domain/words-v1.ts'

/*
  The outcome tools (FR-338 to FR-340): a few task-shaped reads that each answer one thing
  people bring, shared by the MCP server and the assistant. They read the served edition as an
  agent does (FR-314): an item an agent does not get is counted with its reason, never shown.
  They accept the names people use, and a name Heed does not know comes back with the closest
  one and every valid choice, so the caller can recover without guessing. Nothing here calls a
  language model or records demand.
*/

type Area = ServingBundle['areas'][number]
export type FindArgs = z.output<typeof findInput>
export type OverviewArgs = z.output<typeof overviewInput>
export type ChangesArgs = z.output<typeof changesInput>

/** Why an agent does not get an item, in words (the resolver's withheld reasons, FR-314). */
export const withheldWords: Record<string, string> = {
  audience: 'it is for another group',
  source_visibility: 'its metrics are hidden from this reader',
  stopped: 'sharing it with AI agents is paused for now',
  high_risk_unverified: 'it is high risk and waits for a check',
  other: 'it is not shared with AI agents yet',
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`
const list = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1)

/**
 * What a domain is, as its owner wrote it (FR-813): the summary line, and with `full` the
 * description too. A domain nobody has described yet has neither.
 */
export function domainAbout(area: Area, full: boolean) {
  return {
    id: area.id,
    name: area.name,
    ...(area.summary ? { summary: area.summary } : {}),
    ...(full && area.description ? { description: area.description } : {}),
  }
}

/**
 * The domains a get_facts question is about: the domain of each asked metric, by name, with
 * what it is. A concise reply names them only: what a domain is does not answer the question,
 * and domain_overview gives it. None when the question names no metric with a domain.
 */
export function askedDomains(
  bundle: ServingBundle,
  scope: Resolution['scope'],
  concise: boolean,
): ReturnType<typeof domainAbout>[] {
  if (!scope) return []
  const ids = new Set(
    scope.metrics
      .flatMap((key) => [key, ...metricsOf(bundle, key)])
      .map((metric) => bundle.metricArea[metric])
      .filter((id): id is string => id !== undefined),
  )
  return bundle.areas
    .filter((area) => ids.has(area.id))
    .sort(byName)
    .map((area) => (concise ? { id: area.id, name: area.name } : domainAbout(area, true)))
}
const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const monthWords = (month: string) =>
  `${months[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`

/** The choice whose names read closest to what was typed, when one is close enough. */
export function closest<T>(input: string, choices: readonly T[], names: (choice: T) => string[]) {
  let best: { choice: T; score: number } | null = null
  for (const choice of choices) {
    const score = Math.max(0, ...names(choice).map((name) => nameSimilarity(input, name)))
    if (score >= 0.3 && (!best || score > best.score)) best = { choice, score }
  }
  return best?.choice ?? null
}

/** The domains as choices: name, id and summary, by name. */
const domainChoices = (bundle: ServingBundle) =>
  [...bundle.areas].sort(byName).map((area) => domainAbout(area, false))

/**
 * A domain the caller named that Heed does not know: the closest one, and every valid choice
 * ("Unknown domain 'sails'. Did you mean Sales (area_sales)?").
 */
export function unknownDomain(input: string, bundle: ServingBundle) {
  const near = closest(input, bundle.areas, (area) => [area.name, area.id])
  const message = `Unknown domain '${input}'.${near ? ` Did you mean ${near.name} (${near.id})?` : ''} Name one of the domains listed.`
  return {
    ...refusedSaid(unknownDomainWords(input, near?.name ?? null), message),
    status: 'need_more_detail',
    message,
    options: [{ field: 'domain', input, options: domainChoices(bundle).map((d) => d.name) }],
    domains: domainChoices(bundle),
  }
}

/**
 * The words Heed knows apart from a domain's own name: its id, the vocabulary and the other
 * domains. A stored name's word that is none of them, beside one that is, looks misspelt.
 */
function wordsBeside(bundle: ServingBundle, area: Area) {
  return knownWords([
    area.id,
    ...bundle.areas.filter((other) => other.id !== area.id).map((other) => other.name),
    ...bundle.terms.flatMap((term) => [term.name, ...term.aliases]),
  ])
}

/** How Heed read words for a domain that are not its stored name, said once, or null. */
export function readAsOf(
  bundle: ServingBundle,
  area: Area,
  wrote: string,
  kind: 'loose' | 'close',
) {
  return domainReadAs(area, wrote, kind, wordsBeside(bundle, area))
}

/**
 * A domain by name or id, read forgivingly ("Stores and Suppliers" for "Stores & Suplliers"), with
 * how it was read when the words are not its name; or the refusal that lists the valid ones.
 */
function domainOf(
  input: string | undefined,
  bundle: ServingBundle,
):
  | { area: Area | null; readAs: ReturnType<typeof readAsOf> }
  | { refusal: ReturnType<typeof unknownDomain> } {
  if (input === undefined) return { area: null, readAs: null }
  const match = matchDomain(input, bundle.areas)
  if (!match) return { refusal: unknownDomain(input, bundle) }
  return {
    area: match.area,
    readAs: match.kind === 'exact' ? null : readAsOf(bundle, match.area, input, match.kind),
  }
}

/** A domain's own vocabulary terms by name: the metrics and dimensions whose domain it is. */
function domainVocabulary(bundle: ServingBundle, area: { id: string }) {
  const names = (kind: ServingTerm['kind']) =>
    bundle.terms
      .filter(
        (term) =>
          term.kind === kind &&
          termShown(bundle, term) &&
          (term.areaId ?? bundle.metricArea[term.key]) === area.id,
      )
      .map((term) => term.name)
      .sort((a, b) => a.localeCompare(b, 'en'))
  return { metrics: names('metric'), dimensions: names('dimension') }
}

/** Where an administrator proposes a source's members as terms. */
const sourcesPath = (sources: readonly string[]) =>
  sources.length === 1
    ? `/admin?section=sources&source=${encodeURIComponent(sources[0]!)}`
    : '/admin?section=sources'

/**
 * The members of a definition source a domain has that are no vocabulary term yet, in words: how
 * many by kind, a few by name, whether they are proposed, and the one next step, for the reader
 * as they are (an administrator proposes them; anyone else is told who can). Null when none.
 */
export function waitingIn(area: { id: string; name: string }, waiting: WaitingTerms | null) {
  const mine = waiting?.members.filter((member) => member.areaId === area.id) ?? []
  if (!waiting || !mine.length) return null
  const metrics = mine.filter((m) => m.kind === 'metric')
  const dimensions = mine.filter((m) => m.kind === 'dimension')
  const proposed = mine.filter((m) => m.proposed)
  const unproposed = mine.filter((m) => !m.proposed)
  const tools = [...new Set(mine.map((m) => m.tool))].sort()
  const kinds = [
    ...(metrics.length ? [plural(metrics.length, 'metric', 'metrics')] : []),
    ...(dimensions.length ? [plural(dimensions.length, 'dimension', 'dimensions')] : []),
  ]
  const examples = [...unproposed, ...proposed]
    .sort((a, b) => Number(a.kind === 'dimension') - Number(b.kind === 'dimension'))
    .slice(0, 4)
    .map((m) => m.name)
  const path = sourcesPath([...new Set(unproposed.map((m) => m.source))].sort())
  const which = unproposed.length === mine.length ? (mine.length === 1 ? 'it' : 'them') : 'the rest'
  const next = unproposed.length
    ? waiting.canPropose
      ? `As an admin, you can see them all and propose ${which} in Administration › Sources (${path}), with Propose names; you, another admin or an owner of the domain then accepts them.`
      : `An admin sees them all and proposes ${which} in Administration › Sources.`
    : null
  return {
    metrics: metrics.length,
    dimensions: dimensions.length,
    // A few by name: they are named in full in Administration, Sources, where they are proposed.
    examples,
    ...(proposed.length ? { proposed: proposed.length } : {}),
    words: [
      `${list(tools)} ${tools.length === 1 ? 'has' : 'have'} ${list(kinds)} mapped to ${area.name} that the library doesn't know by name yet, such as ${list(examples)}.`,
      ...(proposed.length
        ? [
            `${proposed.length === mine.length ? (mine.length === 1 ? 'It is' : 'They are') : `${proposed.length} of them ${proposed.length === 1 ? 'is' : 'are'}`} proposed as ${proposed.length === 1 ? 'a name and waits' : 'names and wait'} for review in Proposals › To review (/proposals?view=review).`,
          ]
        : []),
      ...(next ? [next] : []),
    ].join(' '),
    ...(unproposed.length ? { where: path } : {}),
  }
}

/** What to answer about a domain that holds nothing yet: short, and never the other domains' terms. */
const emptyDomainInstruction =
  'This domain holds no items and no vocabulary terms yet. Answer in one short paragraph of at most two sentences: what it has, what is missing, and the one next step (from waiting_in_source when it is there). Do not list the metrics or items of other domains, and do not repeat this in later answers.'

const areaName = (bundle: ServingBundle, id: string | null | undefined) =>
  (id && bundle.areas.find((area) => area.id === id)?.name) ?? null
const termName = (bundle: ServingBundle, key: string) =>
  bundle.terms.find((term) => term.key === key)?.name ?? key.slice(key.lastIndexOf('/') + 1)

/** Whether a served item is about a vocabulary term: in its scope, or through a metric's group. */
function isAbout(item: ServingItem, term: ServingTerm, bundle: ServingBundle) {
  if (term.kind === 'metric' || term.kind === 'metric_group')
    return (
      item.scope.metrics.includes(term.key) ||
      item.scope.metrics.some((metric) => bundle.groupsOfMetric[metric]?.includes(term.key))
    )
  if (term.kind === 'dimension')
    return (
      item.scope.dimensions.includes(term.key) ||
      item.scope.dimensionValues.some((value) => value.dimension === term.key)
    )
  return item.scope.dimensionValues.some((value) => value.value === term.key)
}

/** Why agents do not get some items, as a count: "is high risk..." for one, "are..." for more. */
const heldWords: Record<string, [string, string]> = {
  source_visibility: [
    'is about metrics this reader may not see',
    'are about metrics this reader may not see',
  ],
  stopped: ['is paused for now', 'are paused for now'],
  high_risk_unverified: [
    'is high risk and waits for a check',
    'are high risk and wait for a check',
  ],
  other: ['is not shared with AI agents', 'are not shared with AI agents'],
}

/**
 * The edition's items about a term, by the one rule the catalogue and the scope picker count with:
 * items for everyone whose scope names it (a dimension, it or any of its values). Agents get those
 * the resolver delivers for their own scope (FR-314); the others are held back, counted by why.
 * A search's domain or kind never narrows them: they describe the term.
 */
export function termItems(bundle: ServingBundle, term: ServingTerm, today: string) {
  const given: ServingItem[] = []
  const held = new Map<string, number>()
  let about = 0
  for (const item of bundle.items) {
    if (item.status !== 'accepted' || !audienceAllows(item.audience, noGroups)) continue
    if (!isAbout(item, term, bundle)) continue
    about++
    const reason = withholding(bundle, item, today)
    if (reason === null) given.push(item)
    else held.set(reason, (held.get(reason) ?? 0) + 1)
  }
  return { about, given, held }
}

/**
 * What agents get of a term's items, in words: "agents get 366 of them, not the other 4 yet: they
 * are high risk and need a check or a review first". It says what each number counts, so a count
 * of items about the term and a count agents get never read as two answers to one question.
 */
export function agentsGetWords({ about, given, held }: ReturnType<typeof termItems>) {
  const back = about - given.length
  if (!back) return about === 1 ? 'AI agents get it' : 'AI agents get all of them'
  const reasons = [...held]
  const words = (reason: string, n: number) =>
    (heldWords[reason] ?? heldWords.other!)[n === 1 ? 0 : 1]
  const why =
    reasons.length === 1
      ? `${back === 1 ? 'it' : 'they'} ${words(reasons[0]![0], back)}`
      : list(reasons.map(([reason, n]) => `${n.toLocaleString('en')} ${words(reason, n)}`))
  return given.length
    ? `AI agents get ${given.length.toLocaleString('en')} of them, not the other ${back.toLocaleString('en')} yet: ${why}`
    : `AI agents get none of ${about === 1 ? 'it' : 'them'} yet: ${why}`
}

const unverified = (item: ServingItem, today: string) =>
  item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < today)

/**
 * How an item was reviewed before it was served (FR-326): the day it was accepted, the role that
 * accepted it in its domain, never the person, and the edition that first served this version.
 * The result's text says the same in one sentence beside the item's page (`openLines`). None for
 * a version with no acceptance on record, such as the draft a preview shows.
 */
export function reviewedOutput(item: ServingItem, bundle: ServingBundle) {
  const review = item.review
  if (!review) return {}
  const domain = areaName(bundle, review.areaId) ?? review.areaId
  return {
    reviewed: {
      accepted_on: review.acceptedOn,
      accepted_by: acceptedByRole(review.acceptedAs, domain),
      in_edition: review.edition,
    },
  }
}
/** An item in a list: what it is and says, without its body or links. */
function itemLine(bundle: ServingBundle, item: ServingItem, today: string) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    domain: areaName(bundle, item.areaId),
    validity: item.validity,
    ...(unverified(item, today) ? { freshness: 'unverified' } : {}),
    ...(ownCaveat(item.notToConclude) ? { not_to_conclude: ownCaveat(item.notToConclude)! } : {}),
    ...reviewedOutput(item, bundle),
  }
}

/** Counts of items by kind, in words: "3 issues, 5 events and 2 notes". */
function kindWords(items: readonly ServingItem[]) {
  const words: Record<ItemKind, [string, string]> = {
    event: ['event', 'events'],
    issue: ['issue', 'issues'],
    note: ['note', 'notes'],
    guide: ['guide', 'guides'],
    example: ['example', 'examples'],
  }
  return list(
    itemKinds.flatMap((kind) => {
      const count = items.filter((item) => item.kind === kind).length
      return count ? [plural(count, ...words[kind])] : []
    }),
  )
}

const activeIssues = (items: readonly ServingItem[], today: string) =>
  items.filter(
    (item) =>
      item.kind === 'issue' &&
      item.validity.start <= today &&
      (item.validity.end === null || item.validity.end > today),
  ).length

/** The most of a source's own words a reply quotes; Sources keeps as many (`description_copy`). */
export const definitionChars = 500
/** A source's words, at most `definitionChars` long, shortened at a word with "...". */
export function quoted(words: string): { text: string; shortened: boolean } {
  if ([...words].length <= definitionChars) return { text: words, shortened: false }
  const head = [...words].slice(0, definitionChars - 3).join('')
  const cut = head.lastIndexOf(' ')
  return { text: `${(cut > 0 ? head.slice(0, cut) : head).trimEnd()}...`, shortened: true }
}

/**
 * What the definition source says about a term, where that comes from, and what Heed adds: the
 * items about it agents get, beside how many items are about it as the catalogue counts them
 * (`termItems`). The caller shows only a term an agent may see (`termShown`).
 */
export function definitionOf(
  bundle: ServingBundle,
  term: ServingTerm,
  today: string,
  /** The words name it only in part ("retention" for Retention rate). */
  inPart = false,
) {
  const items = termItems(bundle, term, today)
  const about = items.given
  const described = term.described ?? null
  // A term in several views is missing or changed when any of its definitions is.
  const definitions = term.definitions
  const state = definitions.some((definition) => definition.missing)
    ? 'missing'
    : about.some((item) =>
          definitions.some(
            (definition) =>
              (bundle.refMarks[item.id]?.[definition.ref] ?? definition.changeMark) !==
              definition.changeMark,
          ),
        )
      ? 'changed'
      : 'current'
  const notes = about
    .filter((item) => item.kind === 'note' || item.kind === 'guide')
    .slice(0, 3)
    .map((item) => ({ id: item.id, kind: item.kind, title: item.title, summary: item.summary }))
  const source = described?.description ? quoted(described.description) : null
  const words = source?.text ?? null
  const origin = described ? 'source' : notes.length ? 'library' : 'none'
  const kind =
    term.kind === 'metric_group'
      ? 'metric group'
      : term.kind === 'dimension'
        ? 'dimension'
        : 'metric'
  const domain = areaName(bundle, term.areaId ?? bundle.metricArea[term.key])
  const group = term.kind === 'metric' && term.parentKey ? termName(bundle, term.parentKey) : null
  const originWords =
    origin === 'source'
      ? [
          words
            ? `${described!.tool} defines it, read through Sources (${described!.source}, ${described!.ref}). These are the source's own words${source!.shortened ? `, shortened to ${definitionChars} characters` : ''}; the calculation stays in ${described!.tool}.`
            : `${described!.tool} defines it (${described!.ref}, read through Sources), but gives no description.`,
          ...(state === 'changed'
            ? [
                `${described!.tool} changed this definition after some facts about it were checked: those facts need checking until an owner of the domain checks them.`,
              ]
            : state === 'missing'
              ? [
                  `${described!.tool} no longer lists this definition: these are the last words read from it, and the facts about it are marked for a check.`,
                ]
              : []),
        ].join(' ')
      : origin === 'library'
        ? `No definition source describes ${term.name}. The library holds notes about it, listed here.`
        : `Neither a definition source nor the library describes ${term.name}.${domain ? ` Ask ${ownerRole(domain)}: they can say what it means.` : ''}`
  const issues = activeIssues(about, today)
  const adds = about.length
    ? `AI agents get ${plural(about.length, 'checked fact', 'checked facts')} about ${term.name} with their data: ${kindWords(about)}.${issues ? ` ${plural(issues, 'issue still applies', 'issues still apply')} today.` : ''}`
    : `AI agents get no facts about ${term.name} yet.`
  // The catalogue's count goes beside it whenever the two differ, with what each one counts.
  const counted =
    items.about > about.length
      ? ` The library holds ${plural(items.about, 'fact', 'facts')} about ${term.name}, the count its catalogue shows; ${agentsGetWords(items)}.`
      : ''
  return {
    term: term.name,
    named: inPart ? 'in part' : 'exactly',
    ...(inPart
      ? {
          named_note: `The words name ${term.name} only in part. Check that it is what was meant before answering with this definition, and say so if it may not be.`,
        }
      : {}),
    key: term.key,
    kind,
    ...(term.aliases.length ? { other_names: term.aliases } : {}),
    ...(group ? { group } : {}),
    ...(domain ? { domain } : {}),
    definition: words,
    origin,
    origin_words: originWords,
    ...(described
      ? {
          source: {
            tool: described.tool,
            name: described.source,
            ref: described.ref,
            ...(described.title ? { title: described.title } : {}),
            state,
          },
        }
      : {}),
    ...(!words && notes.length ? { library: notes } : {}),
    heed_adds: adds + counted,
  }
}

const definedKinds = new Set(['metric', 'metric_group', 'dimension'])
/**
 * Metrics and dimensions a query names by part of their name: a word that is in the name of one
 * of them only ("retention" for Retention rate, "active customer" for Active customers). A word in
 * several names ("rate") names none of them.
 */
function partlyNamed(bundle: ServingBundle, read: ReadQuery): string[] {
  const terms = bundle.terms.filter((term) => definedKinds.has(term.kind))
  const stems = (name: string) => normalizeName(name).split(/\s+/).map(stem)
  return read.used.words.flatMap((word) => {
    const wanted = stem(normalizeName(word))
    const hits = terms.filter((term) =>
      [term.name, ...term.aliases].some((name) => stems(name).includes(wanted)),
    )
    return hits.length === 1 ? [hits[0]!.key] : []
  })
}

/** The terms a query names, as Heed reads them: "Net revenue (metric), Spain (Market)". */
function readAs(bundle: ServingBundle, read: ReadQuery) {
  const named = [
    ...read.used.domains.map((id) => `${areaName(bundle, id) ?? id} (domain)`),
    ...read.used.terms.map((key) => {
      const term = bundle.terms.find((t) => t.key === key)
      if (!term) return key
      const of =
        term.kind === 'dimension_value' && term.parentKey
          ? termName(bundle, term.parentKey)
          : term.kind === 'metric_group'
            ? 'metric group'
            : term.kind
      return `${term.name} (${of})`
    }),
  ]
  return [
    named.length ? `names ${list(named)}` : '',
    read.used.words.length ? `the words ${list(read.used.words.map((w) => `"${w}"`))}` : '',
  ]
    .filter(Boolean)
    .join(', and ')
}

type SourceMember =
  | { member: string; term: string; key: string }
  | { member: string; term: null; message: string; options: { key: string; name: string }[] }
/**
 * The source member names the words hold (`payments.orders`, as the data tool names what an
 * agent just queried), each with the metric or dimension in Heed that points at it, or the
 * closest names when none does (CON-517).
 */
function sourceMembers(bundle: ServingBundle, read: ReadQuery): SourceMember[] {
  const shown = bundle.terms.filter(
    (term) => definedKinds.has(term.kind) && termShown(bundle, term),
  )
  const known = read.concepts.flatMap((concept) =>
    concept.kind === 'named' &&
    memberTokens(concept.phrase, bundle.terms).some((m) => m.name === concept.phrase)
      ? concept.terms.flatMap((key) => {
          const term = shown.find((t) => t.key === key)
          return term && memberNames(term).includes(concept.phrase)
            ? [{ member: concept.phrase, term: term.name, key: term.key }]
            : []
        })
      : [],
  )
  const unknown = read.used.unknown_members.map((member) => {
    const keys = suggestTerms(member, shown).slice(0, 3)
    return {
      member,
      term: null,
      message: unknownName(member, ['metric', 'dimension'], keys, shown),
      options: keys.map((key) => ({ key, name: shown.find((t) => t.key === key)!.name })),
    }
  })
  return [...known, ...unknown]
}

/** Why nothing was found and what to try, never a bare absence (FR-338). */
function nothingFound(
  bundle: ServingBundle,
  read: ReadQuery,
  area: Area | null,
  withheld: readonly { reason: string }[],
  members: readonly SourceMember[],
  domains: readonly {
    name: string
    items: number
    vocabulary: { metrics: number; dimensions: number }
    waiting_in_source?: { words: string }
  }[] = [],
) {
  const why: string[] = []
  // A domain the words name that holds nothing yet: what it has and what is missing, first.
  for (const d of domains)
    if (!d.items && !d.vocabulary.metrics && !d.vocabulary.dimensions)
      why.push(
        `${d.name} has no facts and no names of its own yet.${d.waiting_in_source ? ` ${d.waiting_in_source.words}` : ''}`,
      )
  for (const member of members) if (member.term === null) why.push(member.message)
  if (!read.concepts.length) {
    if (read.used.ignored.length)
      why.push(
        `${members.length ? 'Every other word' : 'Every word'} is a common word (${list(read.used.ignored.map((w) => `"${w}"`))}), so there was nothing to search for.`,
      )
  } else why.push(`The query was read as ${readAs(bundle, read)}.`)
  if (withheld.length) {
    const reasons = [...new Set(withheld.map((w) => w.reason))].map(
      (reason) =>
        `${withheld.filter((w) => w.reason === reason).length} because ${withheldWords[reason] ?? reason}`,
    )
    why.push(
      `${plural(withheld.length, 'fact matches', 'facts match')}, but AI agents don't get ${withheld.length === 1 ? 'it' : 'them'}: ${list(reasons)}.`,
    )
  } else if (read.concepts.length)
    why.push(
      'No fact that AI agents get has these words in its title, summary or text, or is about the names in them.',
    )
  const tries: string[] = []
  for (const member of members)
    if (member.term === null && member.options.length)
      tries.push(
        `For ${member.member}, call again with the name it has here: ${list(member.options.map((o) => o.name))}, if that is what was queried.`,
      )
  for (const word of read.used.words) {
    const near = closest(
      word,
      [
        ...bundle.terms.map((t) => ({ name: t.name, names: [t.name, ...t.aliases] })),
        ...bundle.areas.map((a) => ({ name: a.name, names: [a.name] })),
      ],
      (choice) => choice.names,
    )
    if (near) tries.push(`"${word}" isn't a name here. Did you mean ${near.name}?`)
  }
  if (read.concepts.length > 2)
    tries.push('Search fewer words: one or two names, such as a metric and a market.')
  const examples = bundle.terms
    .filter(
      (term) =>
        term.kind === 'metric' &&
        (!area || (term.areaId ?? bundle.metricArea[term.key]) === area.id),
    )
    .slice(0, 3)
    .map((term) => term.name)
  if (examples.length)
    tries.push(`Name a metric or a domain known here, such as ${list(examples)}.`)
  tries.push(
    'For what applies to a question with dates, call get_facts with the metrics, the markets and the dates.',
  )
  tries.push(
    'If nothing is written down about it, say so plainly and report it as a gap, so the owners see it was asked.',
  )
  return { why, try: tries }
}

/**
 * find_facts (FR-338): the items whose words or names match, best first; when no words match,
 * the items that apply to the scope the words name (as get_facts matches them), on the dates
 * given or today. It also says what the definition source gives for each metric or dimension the
 * words name, where that definition comes from, and what Heed adds. When nothing is found it says
 * why and what to try.
 */
export function findContext(
  bundle: ServingBundle,
  args: FindArgs,
  today: string,
  /** The source members domains have that are no term yet, when the caller reads them. */
  waiting: WaitingTerms | null = null,
) {
  const domain = domainOf(args.domain, bundle)
  if ('refusal' in domain) return domain.refusal
  const area = domain.area
  const fits = (item: ServingItem) =>
    (!area || item.areaId === area.id) && (!args.kind || item.kind === args.kind)
  const pool = bundle.items.filter(fits)
  const readable = pool.filter((item) => canRead(bundle, item, today))
  const read = readQuery(args.query, bundle.terms, bundle.areas)
  let found: { item: ServingItem; match: string }[] = rankItems(read, readable, bundle.terms).map(
    ({ item, all }) => ({ item, match: all ? 'all' : 'some' }),
  )
  let scoped: Record<string, unknown> | null = null
  let assumed: ReturnType<typeof assumedDate> | null = null
  if (!found.length) {
    // The scope the words name, on the dates the question or the window gives, else today.
    const window = args.window && { start: args.window.from, end: shiftDate(args.window.to, 1) }
    const scope = extractScope(args.query, bundle.terms, today, window ? { window } : {})
    if (scope.status === 'resolved') {
      assumed = scope.assumed ? assumedDate(scope.assumed) : null
      const resolution = resolve(bundle, {
        scope,
        today,
        groups: noGroups,
        hiddenMetrics: [],
        sizeLimit: Number.MAX_SAFE_INTEGER,
        dependenciesAvailable: true,
      })
      const byId = new Map(pool.map((item) => [item.id, item]))
      found = resolution.items.flatMap((match) => {
        const item = byId.get(match.id)
        return item ? [{ item, match: 'scope' }] : []
      })
      const used = resolution.scope ?? scope.scope
      scoped = {
        scope_used: used,
        ...(assumed ? { assumed_date: assumed.note } : {}),
        ...(scope.dates ? { dates_read: scope.dates } : {}),
        note: found.length
          ? `No fact's words matched, so these are the facts that apply to what the words name${assumed ? `, today (${today})` : ''}, as get_facts finds them.`
          : `No fact's words matched, and no fact applies to what the words name${assumed ? ` today (${today})` : ''}.`,
      }
    }
  }
  const exact = new Set(read.used.terms)
  const definitions = [...new Set([...read.used.terms, ...partlyNamed(bundle, read)])]
    .map((key) => bundle.terms.find((term) => term.key === key))
    .filter(
      (term): term is ServingTerm =>
        !!term && definedKinds.has(term.kind) && termShown(bundle, term),
    )
    .slice(0, 5)
    .map((term) => definitionOf(bundle, term, today, !exact.has(term.key)))
  // How Heed read words for a domain that are not its stored name, once per domain.
  const readAs = [
    ...(domain.readAs && area ? [{ id: area.id, note: domain.readAs }] : []),
    ...read.spelled.flatMap((spelt) => {
      const a = bundle.areas.find((x) => x.id === spelt.area)
      const note =
        a && spelt.area !== area?.id ? readAsOf(bundle, a, spelt.wrote, spelt.kind) : null
      return note ? [{ id: spelt.area, note }] : []
    }),
  ]
  const domains = [...new Set([...(area ? [area.id] : []), ...read.used.domains])].flatMap((id) => {
    const a = bundle.areas.find((x) => x.id === id)
    if (!a) return []
    const vocabulary = domainVocabulary(bundle, a)
    const inSource = waitingIn(a, waiting)
    // A stored name that looks misspelt, unless how the words were read says so already.
    const nameNote = readAs.some((r) => r.id === a.id && r.note.misspelt) ? null : storedNameNote(a)
    return [
      {
        ...domainAbout(a, args.response_format !== 'concise'),
        items: bundle.items.filter((i) => i.areaId === a.id && canRead(bundle, i, today)).length,
        vocabulary: {
          metrics: vocabulary.metrics.length,
          dimensions: vocabulary.dimensions.length,
        },
        ...(inSource ? { waiting_in_source: inSource } : {}),
        ...(nameNote ? { name_note: nameNote } : {}),
      },
    ]
  })
  const items = found.slice(0, args.limit).map(({ item, match }) => ({
    ...itemLine(bundle, item, today),
    match,
  }))
  const status = found.length ? 'matched' : 'no_match'
  // What agents do not get is counted by the names the words hold (domains, metrics, markets),
  // as get_facts counts by scope: never by the text of an item an agent cannot read, which
  // would let words probe it. An item for a narrower audience counts as absent (groups are parked).
  // Nor by the item's title: the query's own words never rank an item an agent does not get.
  const named = { ...read, title: '', concepts: read.concepts.filter((c) => c.kind === 'named') }
  const withheld =
    status === 'no_match' && named.concepts.length
      ? rankItems(
          named,
          pool.filter(
            (item) => audienceAllows(item.audience, noGroups) && !readable.includes(item),
          ),
          bundle.terms,
        ).map(({ item }) => ({ reason: withholding(bundle, item, today) ?? 'other' }))
      : []
  const members = sourceMembers(bundle, read)
  return {
    status,
    found_by: scoped ? 'scope' : 'words',
    query_used: read.used,
    ...(members.length ? { members } : {}),
    ...(scoped ?? {}),
    items,
    total: found.length,
    ...(found.length > items.length
      ? { more: `${found.length - items.length} more: raise limit or add a word.` }
      : {}),
    ...(definitions.length ? { definitions } : {}),
    ...(domains.length ? { domains } : {}),
    ...(readAs.length ? { domain_read_as: readAs.map((r) => r.note) } : {}),
    ...(status === 'no_match' ? nothingFound(bundle, read, area, withheld, members, domains) : {}),
    check_report: {
      status,
      matched: found.length,
      withheld: withheld.length,
      links_withheld: 0,
      cut: found.length > items.length,
      cut_ids: [] as string[],
      checked: ['edition', 'audience', 'stop_switch', 'freshness'],
      statements: [coverageStatement, ...(assumed ? [assumed.statement] : [])],
    },
    instructions: `${agentInstructions} Read an item in full with read_item. Quote a definition only as the source words it, and say where it comes from.${assumed ? ` ${assumed.instruction}` : ''}${items.some((item) => 'not_to_conclude' in item) ? ` ${caveatInstruction}` : ''}${readAs.length || domains.some((d) => 'name_note' in d) ? ` ${domainReadAsInstruction}` : ''}${status === 'no_match' && domains.some((d) => !d.items && !d.vocabulary.metrics && !d.vocabulary.dimensions) ? ` ${emptyDomainInstruction}` : ''}`,
  }
}

/** Why an item needs a look, in words, or null (the Library's "Needs a look", A8). */
function lookReason(item: ServingItem, today: string): string | null {
  const status = itemDisplayStatus({ ...item, status: 'accepted' }, today)
  if (!needsALook(status)) return null
  if (status === 'stale')
    return item.reviewDate
      ? `Its check date, ${fullDayWords(item.reviewDate)}, has passed.`
      : 'Its check date has passed.'
  if (status === 'source_missing') return 'Its definition is gone from the source.'
  return 'Its source definition changed, so it waits for a check.'
}

/** A gap's topic in words: "Net revenue, Spain, October 2026". */
function gapTopic(
  bundle: ServingBundle,
  gap: { metrics: string[]; dimensionValues: string[]; month: string },
) {
  return [
    ...gap.metrics.map((key) => termName(bundle, key)),
    ...gap.dimensionValues.map((key) => termName(bundle, key)),
    monthWords(gap.month),
  ].join(', ')
}

/** The domains of an edition with a line on each, and the names of its metrics and dimensions. */
export function editionDomains(bundle: ServingBundle, today: string) {
  const name = new Map(bundle.terms.map((t) => [t.key, t.name]))
  const shown = bundle.items.filter((i) => canRead(bundle, i, today))
  return {
    edition: bundle.edition,
    domains: bundle.areas
      .map((area) => {
        const items = shown.filter((i) => i.areaId === area.id)
        const counts = new Map<string, number>()
        for (const item of items)
          for (const metric of item.scope.metrics) counts.set(metric, (counts.get(metric) ?? 0) + 1)
        const top = [...counts]
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .slice(0, 4)
          .map(([key]) => name.get(key) ?? key)
        return {
          ...domainAbout(area, false),
          items: items.length,
          holds: `${plural(items.length, 'item', 'items')}${top.length ? `, mostly about ${top.join(', ')}` : ''}.`,
        }
      })
      .sort(byName),
    metrics: bundle.terms
      .filter((t) => t.kind === 'metric' && termShown(bundle, t))
      .map((t) => {
        const domain = areaName(bundle, t.areaId ?? bundle.metricArea[t.key])
        return {
          key: t.key,
          name: t.name,
          ...(domain ? { domain } : {}),
          ...(t.parentKey ? { group: name.get(t.parentKey) ?? t.parentKey } : {}),
          ...(t.aliases.length ? { other_names: t.aliases } : {}),
        }
      })
      .sort(byName),
    dimensions: bundle.terms
      .filter((t) => t.kind === 'dimension' && termShown(bundle, t))
      .map((dimension) => {
        const values = bundle.terms.filter(
          (t) =>
            t.kind === 'dimension_value' && t.parentKey === dimension.key && termShown(bundle, t),
        )
        return {
          key: dimension.key,
          name: dimension.name,
          value_count: values.length,
          ...(values.length <= LISTED_VALUES
            ? { values: values.map((v) => v.name).sort() }
            : { note: 'Too many values to list: name one in find_facts or get_facts.' }),
        }
      })
      .sort(byName),
  }
}
/** A dimension with more values than this lists only its count: search them by name. */
const LISTED_VALUES = 30

/** Where in Heed a person finds the full view of a domain. */
const inHeed = (areaId: string) => ({
  library: `/library?area=${areaId}`,
  needs_a_look: `/library?view=attention&area=${areaId}`,
  gaps: `/gaps?area=${areaId}`,
  what_changed: `/editions/compare?area=${areaId}`,
})

/**
 * domain_overview (FR-339): with no domain, every domain with its summary line, owners, how
 * many items agents get, what needs a look and the open gaps, and the names Heed knows. With a
 * domain, that domain in full: what its owner wrote about it, its owners, what it covers, the
 * items that need a look, its open gaps and its recent changes. An item agents do not get is
 * counted, never shown.
 */
export async function domainOverview(
  bundle: ServingBundle,
  args: OverviewArgs,
  today: string,
  reads: ServingReads,
) {
  const domain = domainOf(args.domain, bundle)
  if ('refusal' in domain) return domain.refusal
  const area = domain.area
  // One connection runs one query at a time, so these follow each other.
  const owners = await reads.owners()
  const gaps = await reads.openGaps(area?.id)
  const waiting = await reads.waiting()
  const readable = bundle.items.filter((item) => canRead(bundle, item, today))
  // Roles, never names (FR-326): how many owners a domain has, and who reviews its items.
  const ownersOf = (domain: { id: string; name: string }) => {
    const count = owners.find((s) => s.areaId === domain.id)?.count ?? 0
    return { count, reviewed_by: count ? ownerRole(domain.name) : `an ${concepts.admin.name}` }
  }
  if (!area) {
    const overview = editionDomains(bundle, today)
    return {
      status: 'matched',
      domains: overview.domains.map((line) => {
        const items = readable.filter((item) => item.areaId === line.id)
        const vocabulary = domainVocabulary(bundle, line)
        const inSource = waitingIn(line, waiting)
        return {
          ...line,
          owners: ownersOf(line),
          needs_a_look: items.filter((item) => lookReason(item, today)).length,
          open_gaps: gaps.filter((gap) => gap.areaId === line.id).length,
          vocabulary: {
            metrics: vocabulary.metrics.length,
            dimensions: vocabulary.dimensions.length,
          },
          ...(inSource
            ? {
                not_in_vocabulary_yet: {
                  metrics: inSource.metrics,
                  dimensions: inSource.dimensions,
                },
              }
            : {}),
        }
      }),
      metrics: overview.metrics,
      dimensions: overview.dimensions,
      next: 'Call domain_overview with a domain for its facts that need checking, its open gaps and its recent changes.',
    }
  }
  // An item for a narrower audience counts as absent, as in the library (groups are parked).
  const all = bundle.items.filter(
    (item) => item.areaId === area.id && audienceAllows(item.audience, noGroups),
  )
  const items = readable.filter((item) => item.areaId === area.id)
  const metrics = new Map<string, number>()
  for (const item of items)
    for (const metric of item.scope.metrics) metrics.set(metric, (metrics.get(metric) ?? 0) + 1)
  const looks = items.flatMap((item) => {
    const why = lookReason(item, today)
    return why ? [{ id: item.id, kind: item.kind, title: item.title, why }] : []
  })
  const recent = await reads.editions(11)
  const since = recent.length > 1 ? recent.at(-1)!.label : undefined
  const changes = since ? await reads.changes({ from: since, limit: 200 }) : null
  const changed = changes ? changeLines(bundle, changes, area, today) : null
  const vocabulary = domainVocabulary(bundle, area)
  const inSource = waitingIn(area, waiting)
  const empty = !items.length && !vocabulary.metrics.length && !vocabulary.dimensions.length
  const nameNote = storedNameNote(area)
  const listed = (names: string[]) => names.slice(0, 30)
  return {
    status: 'matched',
    domain: {
      ...domainAbout(area, true),
      ...(area.team ? { team: area.team } : {}),
    },
    ...(domain.readAs ? { domain_read_as: domain.readAs } : {}),
    ...(nameNote && !domain.readAs?.misspelt ? { name_note: nameNote } : {}),
    owners: ownersOf(area),
    // The domain's own metrics and dimensions: the vocabulary terms whose domain it is.
    vocabulary: {
      count: { metrics: vocabulary.metrics.length, dimensions: vocabulary.dimensions.length },
      metrics: listed(vocabulary.metrics),
      dimensions: listed(vocabulary.dimensions),
      ...(vocabulary.metrics.length > 30 || vocabulary.dimensions.length > 30
        ? {
            note: `${plural(vocabulary.metrics.length, 'metric', 'metrics')} and ${plural(vocabulary.dimensions.length, 'dimension', 'dimensions')} in all; the first 30 of each by name. The Catalogue (/catalogue) lists them all.`,
          }
        : {}),
    },
    ...(inSource ? { waiting_in_source: inSource } : {}),
    coverage: {
      items: items.length,
      ...(items.length ? { kinds: kindWords(items) } : {}),
      active_issues: activeIssues(items, today),
      metrics: [...metrics]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, 10)
        .map(([key, count]) => ({ name: termName(bundle, key), items: count })),
      ...(all.length > items.length
        ? {
            withheld: all.length - items.length,
            withheld_note: `${plural(all.length - items.length, 'fact is', 'facts are')} not shared with AI agents: paused, or high risk and waiting for a check. People can read them in the library.`,
          }
        : {}),
    },
    needs_a_look: { count: looks.length, items: looks.slice(0, 10) },
    open_gaps: {
      count: gaps.length,
      gaps: gaps.slice(0, 10).map((gap) => ({
        id: gap.ref,
        topic: gapTopic(bundle, gap),
        status: gap.status === 'proposal_made' ? 'a draft is open for it' : 'open',
        ...(gap.noItemCalls === null ? {} : { agent_calls_that_found_nothing: gap.noItemCalls }),
        ...(gap.reports === null ? {} : { reports: gap.reports }),
        last_seen: gap.lastSeen,
      })),
    },
    ...(changed
      ? {
          recent_changes: {
            since: changes!.from,
            edition: changes!.to,
            sentence: changed.sentence,
            changes: changed.lines.slice(0, 5),
          },
        }
      : {}),
    in_heed: inHeed(area.id),
    ...(empty || domain.readAs || nameNote
      ? {
          instructions: [
            ...(domain.readAs || nameNote ? [domainReadAsInstruction] : []),
            ...(empty ? [emptyDomainInstruction] : []),
          ].join(' '),
        }
      : {}),
  }
}

const changeVerbs: Record<EditionChangeKind, string> = {
  added: 'Added',
  changed: 'Changed',
  checked: 'Checked against its source, still correct',
  resaved: 'Saved again with nothing different',
  retired: 'Archived',
  removed: 'Taken back (an earlier set of facts was restored)',
}

/** What each field change means, in words: "when it applies and what not to conclude". */
function fieldWords(fields: readonly string[]) {
  const words = [
    ...new Set(
      fields
        .filter((field) => field !== 'changeMarks' && field !== 'references')
        .map(
          (field) =>
            (proposalAttributes as Record<string, { words: string } | undefined>)[field]?.words ??
            field,
        ),
    ),
  ]
  return words.length ? list(words) : null
}

/**
 * The changes an agent may read, in plain words: an item in service now with its title, one that
 * left without its text (its domain must still be live), and a count of the rest.
 */
function changeLines(bundle: ServingBundle, changes: Changes, area: Area | null, today: string) {
  const inScope = changes.items.filter((change) => !area || change.areaId === area.id)
  const lines: Record<string, unknown>[] = []
  const counts = noChanges()
  let hidden = 0
  let only: { title: string } | null = null
  for (const change of inScope) {
    const now = bundle.items.find((item) => item.id === change.itemId)
    const left = change.change === 'retired' || change.change === 'removed'
    const domain = areaName(bundle, change.areaId)
    if (now && !left && canRead(bundle, now, today)) {
      const what = change.change === 'changed' ? fieldWords(change.fields) : null
      lines.push({
        id: change.itemId,
        change: change.change,
        kind: change.kind,
        title: now.title,
        domain,
        words: `${changeVerbs[change.change]} "${now.title}" (${change.kind}${domain ? `, ${domain}` : ''})${what ? `: ${what}` : ''}.`,
      })
      only = { title: now.title }
    } else if (left) {
      lines.push({
        id: change.itemId,
        change: change.change,
        kind: change.kind,
        domain,
        words: `${changeVerbs[change.change]} ${/^[aeiou]/.test(change.kind) ? 'an' : 'a'} ${change.kind} in ${domain ?? 'a domain'}. AI agents no longer get it, so its text isn't shown.`,
      })
      only = null
    } else {
      hidden += 1
      continue
    }
    counts[change.change] += 1
  }
  const areas = [...new Set(lines.map((line) => line.domain as string | null))].filter(
    (name): name is string => !!name,
  )
  const sentence = [
    changeSentence({
      reason: null,
      counts,
      only: lines.length === 1 ? only : null,
      areas: areas.sort(),
      vocabulary: area ? 0 : changes.vocabulary,
      withheld: 0,
      editions: changes.editions,
    }),
    ...(hidden
      ? [
          `${plural(hidden, 'other change is', 'other changes are')} not shown: in a domain AI agents don't get yet, paused, or for one group only.`,
        ]
      : []),
  ].join(' ')
  return { lines, hidden, sentence, counts }
}

/** An edition number Heed does not know: the closest one, and the recent ones to choose from. */
function unknownEdition(input: string, editions: readonly { label: string; live: boolean }[]) {
  const near = closest(input, editions, (edition) => [edition.label])
  const named = (edition: { label: string; live: boolean }) =>
    `${edition.label}${edition.live ? ' (live)' : ''}`
  const message = `Unknown edition '${input}'.${near ? ` Did you mean ${named(near)}?` : ''} Name one of the editions listed, or leave it out for the live edition.`
  return {
    // The person named an edition, so the sentence may say the word back (words.ts).
    ...refusedSaid(
      `There's no edition called "${input}".${near ? ` Did you mean ${near.label}?` : ''}`,
      message,
    ),
    status: 'need_more_detail',
    message,
    options: [{ field: 'edition', input, options: editions.map((e) => e.label) }],
    editions: editions.map((edition) => ({ label: edition.label, live: edition.live })),
  }
}

/**
 * what_changed (FR-340): what changed between two sealed editions, by default the live edition
 * and the one before, in plain words, reusing the edition comparison. Only what an agent may
 * read of the live edition is named; the rest is counted.
 */
export async function whatChanged(
  bundle: ServingBundle,
  args: ChangesArgs,
  today: string,
  reads: ServingReads,
) {
  const domain = domainOf(args.domain, bundle)
  if ('refusal' in domain) return domain.refusal
  const area = domain.area
  const recent = await reads.editions(20)
  // An edition number that is not among the recent ones may be older: the comparison says.
  const malformed = [args.edition, args.since].find(
    (label) => label !== undefined && !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(label),
  )
  if (malformed !== undefined) return unknownEdition(malformed, recent)
  let changes: Changes
  try {
    changes = await reads.changes({
      ...(args.since ? { from: args.since } : {}),
      ...(args.edition ? { to: args.edition } : {}),
      limit: 200,
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'NOT_FOUND') {
      const missing = [args.edition, args.since].find(
        (label) => label !== undefined && !recent.some((edition) => edition.label === label),
      )
      if (missing !== undefined) return unknownEdition(missing, recent)
    }
    throw error
  }
  const { lines, hidden, sentence, counts } = changeLines(bundle, changes, area, today)
  const shown = lines.slice(0, args.limit)
  return {
    // A set of facts is saved as an edition labelled by its day: "2026-10-07.2".
    ...changesSaid({
      since: changes.from ? changes.from.slice(0, 10) : null,
      domain: area?.name ?? null,
      counts,
      hidden,
    }),
    status: 'matched',
    edition: changes.to,
    since: changes.from,
    editions_between: changes.editions,
    ...(area ? { domain: area.name } : {}),
    sentence,
    changes: shown,
    ...(lines.length > shown.length ? { more: lines.length - shown.length } : {}),
    ...(hidden ? { not_shown: hidden } : {}),
    ...(changes.total > changes.items.length
      ? { note: `Only the first ${changes.items.length} of ${changes.total} changes were read.` }
      : {}),
    in_heed: `/editions/compare?${new URLSearchParams({
      ...(changes.from ? { since: changes.from } : {}),
      until: changes.to,
      ...(area ? { area: area.id } : {}),
    }).toString()}`,
  }
}
