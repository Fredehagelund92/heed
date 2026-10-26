import { stateOfStatus, stateWords } from './answer-state.ts'
import { fullDayWords, periodWords } from './dates.ts'
import { metricsOf } from './resolver.ts'
import type { ResolvedScope, ScopeIssue } from './scope.ts'
import { concepts } from './words-v1.ts'

/*
  What a read result means, in two parts (FR-344). `say` is for the person: one or two plain
  sentences an AI agent may repeat as they stand, in the voice of docs/design/voice.md and with the
  names of src/domain/words-v1.ts, so an app that passes them on speaks as a colleague would. `next`
  is for the AI agent: the step to take with this result, in the tool and field names it calls.

  Both come first in every result, so an app that drops the server instructions (FR-343) still
  gets what keeps an answer honest: an empty, unreadable, cut or held-back result never reads as
  an absence. They are the system's own text (FR-322), so they never hold a contributor's words
  (FR-329): a fact is named by its kind, never by its title. They never name the product either:
  the AI agent says where it looked, and the product's name may change. Nothing here calls a
  language model, and the mock's replies use the same sentences as the service's.
*/

/** A result's two sentences: what the person hears, and what the AI agent does next. */
export type Said = { say: string; next?: string }

/**
 * The words a reply speaks in: what one written thing is called, and the tools it points to. The
 * six tools of the agent contract point at each other and start with the answer line
 * (`contextVoice`), and call a written thing by the glossary's name (src/domain/words.ts), so they
 * follow when it changes; the deprecated ids, and the assistant and the preview that still call
 * them by those ids, keep the words they had (`factVoice`) until they go.
 */
export type Voice = {
  /** One written thing, and several. */
  item: readonly [string, string]
  get: string
  find: string
  read: string
  /** How an agent tells the owners that nothing is written down. */
  report: string
  /** How an agent gets what a size cut left out. */
  cuts: string
  /** The field that says which part a partial item covers, and the one that names a disagreement. */
  appliesField: string
  disagreesField: string
  /** The reply's first words: its answer line, or nothing. */
  stateFirst: boolean
}
export const factVoice: Voice = {
  item: ['fact', 'facts'],
  get: 'get_facts',
  find: 'find_facts',
  read: 'read_item',
  report: 'call report_gap',
  cuts: 'cut_ids lists the facts left out: call again with response_format concise or a higher max_bytes to get them.',
  appliesField: 'applies_note',
  disagreesField: 'conflicts_with',
  stateFirst: false,
}
export const contextVoice: Voice = {
  item: [concepts.fact.name, `${concepts.fact.name}s`],
  get: 'get_context',
  find: 'find_context',
  read: 'read_context',
  report: 'if the person agrees, call report with kind missing',
  cuts: 'Call again with a higher max_bytes to get them.',
  appliesField: 'applies',
  disagreesField: 'disagrees_with',
  stateFirst: true,
}

/** The absence rule every result that finds nothing gives the AI agent (FR-318). */
export const notProof = 'That does not prove there is no caveat'
/** How far a result went: only what the question asked was checked. */
const onlyThat = 'Only that was checked.'
/** What a result that read nothing tells the person (`need_more_detail`, `check_failed`). */
export const notLookedUp = 'Nothing was looked up yet.'

type Names = { terms: readonly { key: string; name: string }[] }
type Groups = Names & { groupsOfMetric: Readonly<Record<string, readonly string[]>> }

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`
const list = (names: readonly string[], and = 'and') =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`
const nameOf = (bundle: Names, key: string) =>
  bundle.terms.find((term) => term.key === key)?.name ?? key.slice(key.lastIndexOf('/') + 1)
/** "Market" as it reads mid-sentence, "market"; a name with more capitals stays as it is. */
const midSentence = (name: string) =>
  /^[A-Z][a-z]*( [a-z]+)*$/.test(name) ? `${name[0]!.toLowerCase()}${name.slice(1)}` : name
/** A sentence that starts with a number or a lowercase word, as it starts a sentence. */
const sentence = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`

/**
 * What the dates the question's words name are, from how Heed read them ("1 Jan to 7 Oct 2026
 * (this year so far; UTC)"): "this year so far". The time zone stays in `dates_read`.
 */
function readNote(readsAs: string | null | undefined): string | null {
  const inside = readsAs ? /\(([^()]*)\)$/.exec(readsAs)?.[1] : undefined
  const what = (inside ?? '').split('; ').filter((part) => part && part !== 'UTC')
  return what.length ? what.join(', ') : null
}

/**
 * A resolved scope as a phrase people say: "Orders in the United Kingdom from 1 to 7 October 2026",
 * "Net revenue by market in September 2026". The metrics, then each dimension's values ("in" the
 * first, "for" the next) or "by" the dimension for every value, then the dates, with what the
 * question's words named ("this year so far"). A reply that says the day it assumed leaves the
 * dates out.
 */
export function scopeWords(
  bundle: Names,
  scope: ResolvedScope,
  dates: { show: boolean; readsAs?: string | null } = { show: true },
): string {
  const parts = scope.metrics.length ? [list(scope.metrics.map((key) => nameOf(bundle, key)))] : []
  for (const [dimension, values] of Object.entries(scope.filters)) {
    const names = values.length
      ? list(values.map((key) => nameOf(bundle, key)))
      : `by ${midSentence(nameOf(bundle, dimension))}`
    parts.push(
      values.length && parts.length ? `${parts.length > 1 ? 'for' : 'in'} ${names}` : names,
    )
  }
  if (dates.show) {
    const note = readNote(dates.readsAs)
    parts.push(`${periodWords(scope.window)}${note ? ` (${note})` : ''}`)
  }
  return parts.join(' ')
}

/**
 * What an item applies to, in words people say: "Orders and Returns in Norway", "Orders by
 * market", "Norway". An item that names nothing applies to its whole domain.
 */
export function appliesWords(
  bundle: Names,
  scope: {
    metrics: readonly string[]
    dimensions?: readonly string[]
    dimensionValues: readonly { dimension: string; value: string }[]
  },
): string {
  const filters: Record<string, string[]> = Object.create(null) as Record<string, string[]>
  for (const dimension of scope.dimensions ?? []) filters[dimension] ??= []
  for (const { dimension, value } of scope.dimensionValues) (filters[dimension] ??= []).push(value)
  const words = scopeWords(
    bundle,
    { metrics: [...scope.metrics], filters, window: { start: '1970-01-01', end: null } },
    { show: false },
  )
  return `${words ? sentence(words) : 'Everything in its domain'}.`
}

/** When an item applies, as a sentence start: "From 4 August 2026 on", "In August 2026". */
export const whenWords = (validity: Parameters<typeof periodWords>[0]) =>
  sentence(periodWords(validity))

/**
 * The metrics a scope asks about, with each metric group opened into its metrics (by name, as the
 * definition source groups them): the keys in the order asked, a group's metrics by name.
 */
export function askedMetrics(bundle: Groups, scope: ResolvedScope): string[] {
  const byName = (a: string, b: string) => {
    const [x, y] = [nameOf(bundle, a), nameOf(bundle, b)]
    return x < y ? -1 : x > y ? 1 : 0
  }
  return [...new Set(scope.metrics.flatMap((key) => metricsOf(bundle, key).sort(byName)))]
}

/** A metric group a question asks about: its name and the names of the metrics it holds. */
export type AskedGroup = { name: string; metrics: readonly string[] }

/** The metric groups a scope asks about, each with the names of its metrics. */
export function askedGroups(bundle: Groups, scope: ResolvedScope): AskedGroup[] {
  return scope.metrics
    .filter((key) => key.startsWith('group:'))
    .map((key) => ({
      name: nameOf(bundle, key),
      metrics: askedMetrics(bundle, { ...scope, metrics: [key] }).map((m) => nameOf(bundle, m)),
    }))
    .filter((group) => group.metrics.length > 0)
}

/**
 * What a metric group holds, "Revenue is a group of 3 metrics: Gross sales, Net revenue and
 * Units sold.", so nobody reads the group as one figure.
 */
const groupWords = (groups: readonly AskedGroup[]) =>
  groups.length
    ? groups
        .map(
          (g) =>
            `${g.name} is a group of ${count(g.metrics.length, 'metric', 'metrics')}: ${list(g.metrics)}.`,
        )
        .join(' ')
    : null

/** At most five of a list of names, and how many more there are. */
const some = (names: readonly string[]) =>
  names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : list(names)

/**
 * What could not be read, for the AI agent: each issue's own message with the closest names and
 * their keys, and the choices when no name is close enough.
 */
export function issueWords(bundle: Names, issues: readonly ScopeIssue[], question?: string) {
  const words = issues.slice(0, 3).map((issue) => {
    if (issue.message)
      return issue.options.length && !issue.message.includes('Did you mean')
        ? `${issue.message} Choices: ${some(issue.options.map((key) => nameOf(bundle, key)))}.`
        : issue.message
    if (issue.field === 'dates')
      return 'The window given is not a period that can be read: pass window with from and to.'
    if (issue.field === 'scope' && issue.input !== question && issue.options.length)
      return `'${issue.input}' names more than one thing: ${list(issue.options.map((key) => nameOf(bundle, key)))}.`
    if (issue.field === 'scope') {
      const examples = issue.options.slice(0, 3).map((key) => nameOf(bundle, key))
      return `The question names no metric, market or other name in the vocabulary${examples.length ? `: name one, such as ${list(examples)}` : ''}.`
    }
    return `'${issue.input}' could not be read.`
  })
  if (issues.length > 3)
    words.push(`${issues.length - 3} more parts could not be read either, as options says.`)
  return words.join(' ')
}

/** What could not be read, for the person: at most two things, in the names people use. */
function issueSay(bundle: Names, issues: readonly ScopeIssue[], question?: string) {
  const words = issues.slice(0, 2).map((issue) => {
    const names = (and: string) =>
      list(
        issue.options.slice(0, 3).map((key) => nameOf(bundle, key)),
        and,
      )
    // improve_question names the whole question when it gives no dates at all.
    if (issue.field === 'dates')
      return issue.input && issue.input !== question
        ? `"${issue.input}" can't be read as dates.`
        : 'The question needs dates, such as September 2026 or last week.'
    // A name nobody knows, with the closest ones when some are close.
    if (issue.message)
      return `"${issue.input}" doesn't match a name in the library.${
        issue.message.includes('Did you mean')
          ? ` Did you mean ${names('or')}?`
          : issue.options.length && issue.options.length <= 3
            ? ` Try ${names('or')}.`
            : ''
      }`
    if (issue.field === 'scope' && issue.input !== question && issue.options.length)
      return `"${issue.input}" could mean ${names('or')}.`
    if (issue.field === 'scope')
      return `The question needs a metric or a market${issue.options.length ? `, such as ${names('or')}` : ''}.`
    return `"${issue.input}" can't be read.`
  })
  const more = issues.length - words.length
  return [
    ...words,
    ...(more > 0 ? [`${count(more, 'other thing needs', 'other things need')} fixing too.`] : []),
  ].join(' ')
}

/** A reply whose question could not be read (`need_more_detail`): what to fix, and that it read nothing. */
export const unreadSaid = (
  bundle: Names,
  issues: readonly ScopeIssue[],
  question?: string,
): Said => ({
  say: `${notLookedUp} ${issueSay(bundle, issues, question)}`,
  next: `Fix it from options and call again. ${issueWords(bundle, issues, question)}`,
})

/**
 * A reply that names a domain or an edition nobody knows, or another refusal before anything was
 * read: what the person hears, and the AI agent's message with its choices.
 */
export const refusedSaid = (person: string, message: string): Said => ({
  say: `${notLookedUp} ${person}`,
  next: `${message} Fix it from options and call again.`,
})

/** A domain nobody knows, as the person hears it, with the closest one when one is close. */
export const unknownDomainWords = (input: string, near: string | null) =>
  `There's no domain called "${input}".${near ? ` Did you mean ${near}?` : ''}`

/** A reply whose checks could not run (`check_failed`): the AI agent's next step is the reason. */
export const failedSaid = (message: string): Said => ({
  say: "Nothing could be looked up this time, so this says nothing about what's written down.",
  next: message,
})

/**
 * Why a matching fact isn't given to AI agents, by the resolver's reason (FR-314): what one fact
 * and what several do. A reason nobody knows reads as `other`.
 */
export const heldBackWords: Readonly<Record<string, readonly [string, string]>> = {
  audience: ['is for another group', 'are for another group'],
  source_visibility: ["is about metrics you can't see", "are about metrics you can't see"],
  stopped: ['is paused for now', 'are paused for now'],
  high_risk_unverified: [
    'is high risk and waits for a check',
    'are high risk and wait for a check',
  ],
  other: ["isn't shared yet", "aren't shared yet"],
}

/**
 * Facts that match but aren't given to AI agents, counted by why: "2 more facts match but aren't
 * shared with AI agents: 1 is for another group and 1 waits for a check."
 */
export function heldBackSay(reasons: readonly string[], more: boolean, voice = factVoice): string {
  const n = reasons.length
  const [one, many] = voice.item
  return `${count(n, more ? `more ${one} matches` : `${one} matches`, more ? `more ${many} match` : `${many} match`)} but ${n === 1 ? "isn't" : "aren't"} shared with AI agents: ${heldBackWhy(reasons)}.`
}

/** Why facts aren't given, in a clause: "it's high risk and waits for a check". */
function heldBackWhy(reasons: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const reason of reasons) {
    const known = reason in heldBackWords ? reason : 'other'
    counts.set(known, (counts.get(known) ?? 0) + 1)
  }
  const n = reasons.length
  const words = (reason: string, k: number) => heldBackWords[reason]![k === 1 ? 0 : 1]
  const why =
    counts.size === 1
      ? `${n === 1 ? 'it' : 'they'} ${words([...counts.keys()][0]!, n)}`
      : list([...counts].map(([reason, k]) => `${k} ${words(reason, k)}`))
  // "it is" reads "it's" in speech; a number before the verb stays as it is.
  return why.replace(/^it is /, "it's ").replace(/^they are /, "they're ")
}

export type ContextSay = {
  status: string
  scope: ResolvedScope | null
  issues: readonly ScopeIssue[]
  question: string
  /** Facts given, after any cut. */
  delivered: number
  /** Facts given that apply to only part of the question (`match: partial`). */
  partial: number
  /** Facts given that need checking: their source changed or their check date passed. */
  unverified?: number
  /** Facts that apply but were left out to fit the size limit. */
  cut: number
  /** Why each held-back fact isn't given, in the resolver's reasons (FR-314). */
  withheld: readonly string[]
  /** The sentence of `assumed_date`, when the question gave no dates. */
  assumed: string | null
  /** How Heed read the dates in the question's words, when it read them there. */
  readsAs?: string | null
  /** The metric groups asked for, with their metrics (`askedGroups`). */
  groups?: readonly AskedGroup[]
  /** Each delivered fact names the asked metrics it is about (`about`). */
  about?: boolean
}

/**
 * get_context's two sentences (get_facts's in the fact voice), for each status: what it read (the
 * metrics, markets and dates) and that it read only that; a match keeps what was cut, held back,
 * needs checking or applies only in part; an absence is never said without the rule and the next
 * step for the AI agent. In the context voice `say` starts with the answer line (FR-349), from the
 * reply's status.
 */
export function contextSaid(bundle: Names, c: ContextSay, voice = factVoice): Said {
  // Checks that could not run read nothing: never a question to fix (FR-344).
  if (c.status === 'check_failed') {
    const failed = failedSaid('The checks could not run. Try again shortly.')
    return voice.stateFirst ? { ...failed, say: `${stateWords('failed')} ${failed.say}` } : failed
  }
  if (c.status === 'need_more_detail' || !c.scope) return unreadSaid(bundle, c.issues, c.question)
  const scope = scopeWords(bundle, c.scope, { show: !c.assumed, readsAs: c.readsAs ?? null })
  const [one, many] = voice.item
  const applies = (n: number, more = '') =>
    count(n, `${more}${one} applies`, `${more}${many} apply`)
  const say: string[] = []
  const next: string[] = []
  if (c.status === 'no_match' && c.withheld.length) {
    // Facts exist that AI agents don't get: never an absence, and no gap to report.
    const n = c.withheld.length
    say.push(
      `${sentence(applies(n))} to ${scope}, but ${n === 1 ? "it isn't" : "they aren't"} shared with AI agents yet: ${heldBackWhy(c.withheld)}.`,
    )
    next.push(
      `${notProof}: never say nothing is written down. Say that ${n === 1 ? `a ${one} exists` : `${many} exist`} that AI agents don't get yet, which a person can read in the library.`,
    )
  } else if (c.status === 'no_match') {
    say.push(`Nothing is written down for ${scope}.`, onlyThat)
    next.push(
      `${notProof}, and it covers only this question, never the whole topic. Check the names and dates, or call ${voice.find} with the question's words. If nothing applies there either, say nothing is written down for exactly this question, and ${voice.report}.`,
    )
  } else if (c.delivered === 0) {
    say.push(
      `${sentence(applies(c.cut))} to ${scope}, but ${c.cut === 1 ? "it doesn't" : "they don't"} fit in this reply.`,
    )
    next.push(
      voice === factVoice
        ? 'Call again with response_format concise or a higher max_bytes: cut_ids lists the facts left out. Never say nothing is written down.'
        : `${voice.cuts} Never say nothing is written down.`,
    )
  } else {
    say.push(`${sentence(applies(c.delivered))} to ${scope}.`, onlyThat)
    if (c.partial === c.delivered)
      say.push(
        `${c.delivered === 1 ? 'It applies' : 'Each applies'} to only part of that question.`,
      )
    else if (c.partial)
      say.push(
        `${c.partial} of them ${c.partial === 1 ? 'applies' : 'apply'} to only part of that question.`,
      )
    if (c.unverified)
      say.push(
        c.unverified === c.delivered
          ? `${c.delivered === 1 ? 'It' : 'They'} may be out of date.`
          : `${c.unverified} of them may be out of date.`,
      )
    if (c.status === 'conflict') say.push('Some of them disagree.')
    if (c.cut) say.push(`${applies(c.cut, 'more ')} but didn't fit in this reply.`)
    if (c.withheld.length) say.push(heldBackSay(c.withheld, true, voice))
    if (c.partial) next.push(`${voice.appliesField} says which part each partial ${one} covers.`)
    if (c.status === 'conflict')
      next.push(`Give both sides of ${voice.disagreesField} and say they disagree.`)
    if (c.cut) next.push(voice.cuts)
    if (c.about)
      next.push(`Each ${one} names the metrics it is about (about): answer for each metric apart.`)
  }
  // What a group asked for holds, right after what was read for it and how far that went.
  const grouped = groupWords(c.groups ?? [])
  if (grouped) say.splice(say[1] === onlyThat ? 2 : 1, 0, grouped)
  if (c.assumed) say.push(c.assumed)
  // The answer line comes first (FR-349): the label and, but for Checked, its sentence.
  const state = voice.stateFirst ? stateOfStatus(c.status) : null
  if (state) say.unshift(stateWords(state))
  return { say: say.join(' '), ...(next.length ? { next: next.join(' ') } : {}) }
}

/** search_facts's two sentences: a search matches words, so finding nothing proves nothing. */
export function searchSaid(c: {
  status: string
  query: string
  total: number
  shown: number
  area: string | null
}): Said {
  const where = c.area ? ` in ${c.area}` : ''
  // The words are the caller's own: the sentence never repeats them, nor what they may probe.
  const words = c.query.trim() ? 'these words' : 'these filters'
  if (c.status === 'matched')
    return {
      say: `${sentence(count(c.total, 'fact', 'facts'))}${where} ${c.total === 1 ? 'matches' : 'match'} ${words}.${c.shown < c.total ? ` ${c.shown} are on this page.` : ''}`,
      next: `A search matches words: it doesn't say what applies to a metric, market or dates. Call get_facts for that.${c.shown < c.total ? ' next_cursor gives the next page.' : ''}`,
    }
  return {
    say: `No fact${where} matches ${words}.`,
    next: `${notProof}: a search that finds nothing may only have missed the words. Try a metric, market or domain name, fewer words, or get_facts with the metrics, markets and dates.`,
  }
}

/** find_context's two sentences (find_facts's in the fact voice): found by words, by what the words name, or nothing, and why. */
export function findSaid(
  bundle: Names,
  c: {
    status: string
    foundBy: 'words' | 'scope'
    total: number
    shown: number
    scope: ResolvedScope | null
    assumed: string | null
    readsAs?: string | null
    withheld: number
    definitions: readonly string[]
    area: string | null
  },
  voice = factVoice,
): Said {
  // The words are the caller's own: the sentence never repeats them, nor what they may probe.
  const [one, many] = voice.item
  const where = c.area ? ` in ${c.area}` : ''
  const scope = c.scope
    ? scopeWords(bundle, c.scope, { show: !c.assumed, readsAs: c.readsAs ?? null })
    : null
  const shown = c.shown < c.total ? ` ${c.shown} are shown.` : ''
  const more = c.shown < c.total ? ' Raise limit for more.' : ''
  const defined = c.definitions.length
    ? `The definition of ${list(c.definitions)} is here too, in its source's own words.`
    : null
  const say: string[] = []
  let next: string
  if (c.status === 'matched' && c.foundBy === 'words') {
    say.push(
      `${sentence(count(c.total, one, many))}${where} ${c.total === 1 ? 'matches' : 'match'} these words.${shown}`,
      ...(defined ? [defined] : []),
    )
    next = `These match words, not dates: for what applies to a metric, market and dates, call ${voice.get}.${more}`
  } else if (c.status === 'matched') {
    say.push(
      `${sentence(count(c.total, `${one} applies`, `${many} apply`))}${where} to ${scope}.${shown}`,
      onlyThat,
      ...(defined ? [defined] : []),
    )
    next = `No ${one}'s words matched, so these are the ${many} that apply to what the words name. Call ${voice.get} for other metrics, markets or dates.${more}`
  } else {
    say.push(
      `Nothing written down${where} matches these words${scope ? `, or applies to ${scope}` : ''}.`,
      ...(c.withheld
        ? [
            `${count(c.withheld, `${one} matches`, `${many} match`)} but ${c.withheld === 1 ? "isn't" : "aren't"} shared with AI agents yet.`,
          ]
        : []),
      ...(defined ? [defined] : []),
    )
    next = `${notProof}: a search may only have missed the words, and why says what to try. Call ${voice.get} with the metrics, markets and dates. If nothing applies there either, say nothing is written down for exactly that question, and ${voice.report}.`
  }
  if (c.assumed) say.push(c.assumed)
  return { say: say.join(' '), next }
}

/**
 * domain_overview's two sentences: every domain, or one domain, what its owner says it is (its
 * summary, FR-813), and how many of its facts AI agents get.
 */
export function overviewSaid(c: {
  domain: { name: string; summary?: string } | undefined
  coverage: { items: number; withheld?: number } | undefined
  domains: number
  /** How many metrics are the domain's own. */
  metrics?: number
  /** How the words for the domain were read, when they were not its name. */
  readAs?: { wrote: string; domain: string } | null
  /** The data tool has names for the domain that aren't in the vocabulary yet. */
  waiting?: boolean
}): Said {
  if (!c.domain || !c.coverage)
    return {
      say:
        c.domains === 1
          ? "Here's the one domain, with what it covers and how many facts AI agents get from it."
          : `Here are all ${c.domains} domains, with what each one covers and how many facts AI agents get from it.`,
      next: 'Call domain_overview with a domain for its facts that need checking, its open gaps and its recent changes.',
    }
  const read = c.readAs ? `"${c.readAs.wrote}" is taken to mean ${c.readAs.domain}.` : null
  const what = c.domain.summary
    ? `${c.domain.name}: ${c.domain.summary.replace(/[.!?]$/, '')}.`
    : `${c.domain.name} has no description yet.`
  const { items, withheld = 0 } = c.coverage
  const notShared = (n: number) =>
    `${count(n, 'fact', 'facts')} ${n === 1 ? "isn't" : "aren't"} shared with AI agents yet`
  const gets = items
    ? `AI agents get ${count(items, 'fact', 'facts')} from it${withheld ? `, and ${withheld} more ${withheld === 1 ? "isn't" : "aren't"} shared yet` : ''}.`
    : withheld
      ? `${sentence(notShared(withheld))}.`
      : null
  // No zero counts (voice.md): what a domain doesn't have yet is said in words.
  const own =
    c.metrics === undefined
      ? items || withheld
        ? null
        : 'It has no facts yet.'
      : c.metrics
        ? `It has ${count(c.metrics, 'metric', 'metrics')} of its own${items || withheld ? '' : ', and no facts yet'}.`
        : items || withheld
          ? 'It has no metrics of its own yet.'
          : 'It has no facts and no metrics of its own yet.'
  return {
    say: [read, what, gets, own].filter(Boolean).join(' '),
    ...(c.waiting
      ? {
          next: 'waiting_in_source says which names the data tool has for this domain beyond these, and who can add them. Tell the person when it helps.',
        }
      : {}),
  }
}

/** The changes what_changed counts, by kind of change. */
export type ChangeCounts = Readonly<Record<string, number>>

/**
 * what_changed's sentence: what changed for AI agents since a day, counted in the words people use:
 * "Since 7 October 2026, in Sales: 3 facts added, 2 changed and 1 archived."
 */
export function changesSaid(c: {
  /** The day the earlier set of facts was saved, or null when there was none before. */
  since: string | null
  domain: string | null
  counts: ChangeCounts
  /** Changes that aren't shown: in a domain AI agents don't get yet, paused, or for one group. */
  hidden: number
}): Said {
  const words: [string, string][] = [
    ['added', 'added'],
    ['changed', 'changed'],
    ['checked', 'checked again'],
    ['retired', 'archived'],
    ['removed', 'taken back'],
  ]
  const parts = words.flatMap(([key, word]) =>
    c.counts[key] ? [[c.counts[key], word] as const] : [],
  )
  const total = parts.reduce((sum, [n]) => sum + n, 0)
  const since = c.since ? ` since ${fullDayWords(c.since)}` : ''
  const facts = (n: number) => `${count(n, 'fact', 'facts')}${c.domain ? ` in ${c.domain}` : ''}`
  const first =
    total === 0
      ? `Nothing${c.domain ? ` in ${c.domain}` : ''} changed for AI agents${since}.`
      : parts.length === 1
        ? `${sentence(facts(total))} ${total === 1 ? 'was' : 'were'} ${parts[0]![1]}${since}.`
        : `${sentence(facts(total))} changed for AI agents${since}: ${list(parts.map(([n, word]) => `${n} ${word}`))}.`
  const hidden = c.hidden
    ? ` ${count(c.hidden, 'other change', 'other changes')} ${c.hidden === 1 ? "isn't" : "aren't"} shown.`
    : ''
  return {
    say: `${first}${hidden}`,
    next: 'changes lists each one in words; in_heed opens the comparison for the person.',
  }
}

/**
 * read_context's two sentences (read_item's in the fact voice): the one item it gives, or that no
 * item by that id may be read, in the same words for one the caller may not see as for one that
 * does not exist (FR-334). `kind` is the kind as the reply names it.
 */
export const readSaid = (
  item: { kind: string; version: number } | null,
  voice = factVoice,
): Said => {
  const [one, many] = voice.item
  return item
    ? {
        say: `This is the full ${item.kind}, version ${item.version}.`,
        next: `A link shows what a ${one} mentions: it does not mean the ${one} applies to the question.`,
      }
    : {
        say: `There's no ${one} by that id that you can read.`,
        next: `That says nothing about what else is written down: find ${many} with ${voice.find} or ${voice.get}.`,
      }
}

/** get_related's two sentences: what links to the start, or that it may not be read (FR-334). */
export const relatedSaid = (c: { shown: number; total: number; depth: number } | null): Said =>
  c
    ? {
        say: `${sentence(c.shown < c.total ? `${c.shown} of ${count(c.total, 'linked thing', 'linked things')}` : count(c.total, 'thing is', 'things are'))}${c.shown < c.total ? ' are shown' : ' linked to it'}, up to ${count(c.depth, 'step', 'steps')} away.`,
        next: `A link shows what a text refers to: it doesn't mean an item applies to the question, nor prove a cause.${c.shown < c.total ? ' next_cursor gives the next page.' : ''}`,
      }
    : {
        say: "There's nothing by that id that you can read.",
        next: 'That says nothing about what else is written down.',
      }

/** report_gap's sentence: the gap is recorded for its owners, never who asked. */
export const gapSaid = (scope: string, assumed: string | null): Said => ({
  say: `Gap reported for ${scope}. The owners of the domain will see it was asked.${assumed ? ` ${assumed}` : ''}`,
})

/**
 * report's sentence: what was sent, and to which owner when the report names a context item or a
 * scope; never who asked. `to` is the owner as a role ("the owner of Sales").
 */
export function reportSaid(c: {
  kind: 'missing' | 'wrong' | 'unclear' | 'helped'
  to: string | null
  /** What a report of something missing was about, in words, when it named a scope. */
  scope?: string | null
  assumed?: string | null
}): Said {
  const to = c.to ?? 'the owners of the domain'
  const what =
    c.kind === 'helped'
      ? `Sent: it helped. ${sentence(to)} will see it.`
      : c.kind === 'missing'
        ? `Sent: something is missing${c.scope ? ` for ${c.scope}` : ''}. ${sentence(to)} will see it was asked.`
        : `Sent: something is ${c.kind}. ${sentence(to)} will see it.`
  return {
    say: `${what} Who asked is not kept.${c.assumed ? ` ${c.assumed}` : ''}`,
  }
}

/** improve_question's two sentences: how the question reads, and where its suggestions are. */
export const improveSaid = (scope: string): Said => ({
  say: `The question reads as ${scope}.`,
  next: 'suggestions, events and guides say what would make it sharper. For what applies, call get_facts.',
})
