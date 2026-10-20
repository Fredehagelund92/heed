import type { Scope } from '@domain/item'
import { shiftDate } from '@domain/validity'
import type { PreviewReply, TryIt, TryItInput } from '@/api/client'
import { namedKeys, readAgentReply, type ReplyItem } from '@/lib/agent-reply'
import { addToScope, scopeKeys } from '@/lib/mention-targets'
import type { TryItSearch } from '@/lib/search-params'

/*
  What an agent would get (Try it): a typed scope (metrics, market or product values, and the
  first and last day) in, get_context's reply on the live edition out, with no model and nothing
  recorded. The scope lives in the address on the page, so a link shows the same reply.
*/

/** A scope to try: the chips and the dates, both days included. */
export type TryItScope = { scope: Scope; from: string | null; to: string | null }

export const emptyScope: Scope = { metrics: [], dimensions: [], dimensionValues: [] }

/** How many days the dates cover when a person has not chosen any: the last 30, today included. */
export const DEFAULT_DAYS = 30

/** The last 30 days, today included: the dates a scope starts with. */
export function defaultWindow(today: string): { from: string; to: string } {
  return { from: shiftDate(today, 1 - DEFAULT_DAYS), to: today }
}

/** The scope keys of an `about` param, in order, each once. */
export function keysOf(about: string | undefined): string[] {
  return [...new Set(about ? about.split(',') : [])]
}

/** The scope an address holds, or null when it names nothing to try. */
export function scopeFromSearch(search: Pick<TryItSearch, 'about' | 'from' | 'to'>) {
  const keys = keysOf(search.about)
  if (!keys.length && !search.from && !search.to) return null
  const scope = keys.reduce(addToScope, emptyScope)
  const from = search.from ?? null
  const to = search.to ?? null
  // A last day before the first reads as one day, the first.
  return { scope, from, to: from && to && to < from ? from : to } satisfies TryItScope
}

/** The address of a scope: its keys and its days, nothing for what it leaves empty. */
export function searchOf(tried: TryItScope): Pick<TryItSearch, 'about' | 'from' | 'to'> {
  const keys = scopeKeys(tried.scope)
  return {
    about: keys.length ? keys.join(',') : undefined,
    from: tried.from ?? undefined,
    to: tried.to ?? undefined,
  }
}

/** Whether a scope has something to try: a metric or a value. The dates may still be missing. */
export const hasTerms = (scope: Scope) =>
  scope.metrics.length + scope.dimensions.length + scope.dimensionValues.length > 0

/** The request: metrics, the values grouped by their dimension, and the days, both included. */
export function tryItInput({ scope, from, to }: TryItScope): TryItInput {
  const values = new Map<string, string[]>()
  // A dimension with any value is named without a value, as get_context reads it.
  for (const dimension of scope.dimensions) values.set(dimension, [])
  for (const { dimension, value } of scope.dimensionValues)
    values.set(dimension, [...(values.get(dimension) ?? []), value])
  return {
    ...(scope.metrics.length ? { metrics: scope.metrics } : {}),
    ...(values.size
      ? { dimension_filters: [...values].map(([dimension, list]) => ({ dimension, values: list })) }
      : {}),
    ...(from ? { window: { from, to: to && to >= from ? to : from } } : {}),
  }
}

/** Whether two scopes ask the same thing (the chips in any order, the same days). */
export function sameScope(a: TryItScope, b: TryItScope): boolean {
  const keys = (tried: TryItScope) => [...scopeKeys(tried.scope)].sort().join(',')
  return keys(a) === keys(b) && a.from === b.from && a.to === b.to
}

/** One delivered fact as the list shows it: the reply's fields, its rank and how it matched. */
export type DeliveredFact = ReplyItem & {
  rank: number
  match: 'exact' | 'partial'
  /** Delivered facts it conflicts with, by id. */
  conflictsWith: string[]
}

/** Something the scope needs before an agent gets facts: what to add or change, in words. */
export type ScopeNeed = { field: 'dates' | 'scope' | 'term'; words: string }

export type TriedReply = {
  status: PreviewReply['status']
  /** What the AI app may tell the person, word for word (`say`, FR-344). */
  say: string | null
  /** The step the AI app is told to take next (`next`): for it, not the person. */
  next: string | null
  /** The edition the reply came from; null when the checks could not run. */
  edition: string | null
  delivered: DeliveredFact[]
  /** Facts that apply but are not delivered: another audience, stopped, or high risk and not checked. */
  heldBack: number
  /** Facts that apply but did not fit the size limit. */
  cut: number
  /** Links the agent may not follow. */
  linksHeldBack: number
  /** The instructions the agent is told, word for word. */
  instructions: string | null
  /** What every reply says about coverage. */
  statements: string[]
  /** The first characters of the digest of the tool descriptions, which an agent can check. */
  digest: string | null
  needs: ScopeNeed[]
  /** The day the reply was read at because no dates were chosen: today, which the agent says. */
  assumedDay: string | null
  bytes: number
  limit: number
}

/** The reply in the fields Try it shows. `nameOf` gives a term's name, by its key. */
export function readTryIt(
  tried: TryIt,
  nameOf: (key: string) => string | undefined = () => undefined,
) {
  const { result } = tried
  const reply = readAgentReply(result, nameOf)
  const raw = new Map((result.items ?? []).map((item) => [item.id, item]))
  const delivered = ('items' in reply ? reply.items : []).map((item, index): DeliveredFact => ({
    ...item,
    rank: index + 1,
    match: raw.get(item.id)?.match ?? 'exact',
    conflictsWith: raw.get(item.id)?.conflicts_with ?? [],
  }))
  return {
    status: result.status,
    say: result.say ?? null,
    next: result.next ?? null,
    edition: result.edition ?? null,
    delivered,
    heldBack: result.check_report.withheld,
    cut: result.check_report.cut_ids.length,
    linksHeldBack: result.check_report.links_withheld,
    instructions: result.instructions ?? null,
    statements: result.check_report.statements,
    digest: result.tool_schema_digest ? result.tool_schema_digest.slice(0, 8) : null,
    needs: (result.options ?? []).map((option) => needOf(option, nameOf)),
    assumedDay: result.assumed_date?.date ?? null,
    bytes: tried.bytes,
    limit: tried.limit,
  } satisfies TriedReply
}

function needOf(
  option: NonNullable<PreviewReply['options']>[number],
  nameOf: (key: string) => string | undefined,
): ScopeNeed {
  if (option.field === 'dates')
    return { field: 'dates', words: 'Add the first and last day the question is about.' }
  if (option.field === 'scope')
    return { field: 'scope', words: 'Add a metric, a market or a product.' }
  return {
    field: 'term',
    words: `${namedKeys(option.input, nameOf)} isn't a name we know yet.`,
  }
}

/** A size in kilobytes, as people read it: "3.1 KB", "100 KB". */
export function formatKb(bytes: number): string {
  const kb = bytes / 1000
  return `${kb >= 10 ? Math.round(kb).toLocaleString('en') : kb.toFixed(1)} KB`
}

/** The counts in one line, without zero counts: "2 facts, 1 held back, 3 left out to fit". */
export function countWords(reply: Pick<TriedReply, 'delivered' | 'heldBack' | 'cut'>): string {
  const facts = reply.delivered.length
  return [
    `${facts.toLocaleString('en')} ${facts === 1 ? 'fact' : 'facts'}`,
    ...(reply.heldBack ? [`${reply.heldBack.toLocaleString('en')} held back`] : []),
    ...(reply.cut ? [`${reply.cut.toLocaleString('en')} left out to fit`] : []),
  ].join(', ')
}

/** The days as a person reads them: "8 Sep 2026 to 7 Oct 2026", or one day. */
export function daysWords(from: string | null, to: string | null, format: (day: string) => string) {
  if (!from) return null
  if (!to || to === from) return format(from)
  return `${format(from)} to ${format(to)}`
}

/**
 * A scope in words for a report about it: "Orders, Norway, 1 Sept 2026 to 30 Sept 2026".
 * `nameOf` gives a term's name by its key; an unknown key keeps its own words.
 */
export function scopeWords(
  tried: TryItScope,
  nameOf: (key: string) => string | undefined,
  format: (day: string) => string,
): string {
  const terms = scopeKeys(tried.scope).map(
    (key) => nameOf(key) ?? key.slice(key.lastIndexOf(key.includes('/') ? '/' : ':') + 1),
  )
  const days = daysWords(tried.from, tried.to, format)
  return [...terms, ...(days ? [days] : [])].join(', ')
}

/** The address of a new draft about this scope: Add context with the chips and the first day. */
export function draftSearch(tried: TryItScope): { about?: string; from?: string } {
  const keys = scopeKeys(tried.scope)
  return {
    ...(keys.length ? { about: keys.join(',') } : {}),
    ...(tried.from ? { from: tried.from } : {}),
  }
}
