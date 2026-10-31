/**
 * The http binding's reading of Context: a context item's page and a draft into the item the
 * screens draw, the service's history into versions, its log of changes to many items into the
 * History log, and the editor's item back into the draft the service publishes. The text's
 * mentions are written both ways: the app's own token, [@ id="context:itm_..." label="..."], and
 * the service's markup, @[words](item:itm_...). Related is the service's related context as
 * links. Pure, so the rules are tested without a service.
 */
import type {
  ItemChange,
  ItemPage as ServiceItemPage,
  ItemVersionEntry,
  RelatedContext,
} from '@contract/context'
import type { ProposalRecord } from '@contract/proposals'
import type { TermVersion } from '@contract/terms'
import type { Draft } from '@domain/draft'
import type { Scope, Vocabulary as ServiceVocabulary } from '@domain/item'
import { defaultNotToConclude } from '@domain/proposal-rules'
import { parseMentions, serializeMentions, type MentionPart } from '@domain/mentions'
import { shiftDate } from '@domain/validity'
import type { Link, LinkEnd, Rel } from '@/lib/links'
import { mentionParts, mentionToken, parseMentionId } from '@/lib/mentions'
import type { Version, VersionKind } from '@/model/history'
import type { Fact, Kind, LogEntry, ScopeTerm } from '@/model/items'
import { dateLabel, whenLabel } from '@/model/validity'
import type { ItemPage } from './client'
import { ownersOf, statusOf, validityOf, type Names } from './http-map'

/* ---------- the words a scope and a mention name ---------- */

/** The live vocabulary both ways: a metric, a dimension or a value by its key and by its name. */
export type Words = {
  /**
   * A scope's key for a name people read: `metric:orders`, `dim:market`, `val:market/norway`. With
   * a dimension's name, only a value of that dimension.
   */
  keyOf: (
    name: string,
    dimension?: string,
  ) => { kind: 'metric' | 'dim' | 'val'; key: string } | undefined
  /** The name people read for a key, or the key's own id when the vocabulary has no name. */
  nameOf: (key: string) => string
  /** A term written in Definitions by its id, as the app names it (by its word), if it is there. */
  termName: (id: string) => string | undefined
  /** A term's id by its word, any case. */
  termId: (name: string) => string | undefined
}

/** A term written in Definitions, as Words reads it: its id and its word. */
export type WrittenWord = { id: string; name: string }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function wordsOf(vocabulary: ServiceVocabulary, terms: readonly WrittenWord[] = []): Words {
  const names = new Map<string, string>()
  for (const m of vocabulary.metrics) names.set(`metric:${m.id}`, m.name)
  for (const d of vocabulary.dimensions) {
    names.set(`dim:${d.id}`, d.name)
    for (const v of d.values) names.set(`val:${d.id}/${v.id}`, v.name)
  }
  return {
    keyOf(name, within) {
      if (within !== undefined) {
        const d = vocabulary.dimensions.find((x) => same(x.name, within))
        const value = d?.values.find((v) => same(v.name, name))
        return d && value ? { kind: 'val', key: `val:${d.id}/${value.id}` } : undefined
      }
      const metric = vocabulary.metrics.find((m) => same(m.name, name))
      if (metric) return { kind: 'metric', key: `metric:${metric.id}` }
      const dimension = vocabulary.dimensions.find((d) => same(d.name, name))
      if (dimension) return { kind: 'dim', key: `dim:${dimension.id}` }
      for (const d of vocabulary.dimensions) {
        const value = d.values.find((v) => same(v.name, name))
        if (value) return { kind: 'val', key: `val:${d.id}/${value.id}` }
      }
      return undefined
    },
    nameOf: (key) => names.get(key) ?? key.split(/[:/]/).at(-1)!,
    termName: (id) => terms.find((t) => t.id === id)?.name,
    termId: (name) => terms.find((t) => same(t.name, name))?.id,
  }
}

/* ---------- mentions ---------- */

/**
 * A service's target as the app's mention id, by the kind and the key the app names it with (a
 * metric by its name, an item by its id): `item:itm_x` is `context:itm_x`, `metric:orders` is
 * `metric:Orders`, a value by its key, so values of two dimensions never mix
 * (`val:market/norway` is `value:market/norway`), and a term written in Definitions `term:<id>` is
 * `term:<its word>`. Empty for a target the app has no mention of, such as a term no longer there.
 */
export function mentionIdOf(target: string, words: Words): string {
  const kind = target.slice(0, target.indexOf(':'))
  const key = target.slice(target.indexOf(':') + 1)
  if (kind === 'item') return `context:${key}`
  if (kind === 'metric') return `metric:${words.nameOf(target)}`
  if (kind === 'dim') return `dimension:${words.nameOf(target)}`
  if (kind === 'val') return `value:${key}`
  if (kind === 'area') return `domain:${key}`
  if (kind === 'term') {
    const name = words.termName(key)
    return name ? `term:${name}` : ''
  }
  return ''
}

/** The service's markup as the app's text: each mention as the app's token. */
export function textFromService(markup: string, words: Words): string {
  return parseMentions(markup)
    .parts.map((part) => {
      if (part.kind === 'text') return part.text
      const id = mentionIdOf(part.target, words)
      return id ? mentionToken({ id, label: part.label }) : part.label
    })
    .join('')
}

/**
 * A mention as the service can keep it, or null: a person, or a word no longer there, is kept as
 * its words. A value is kept by its key; a market named by its word, as older text names it, is
 * found among the markets only.
 */
function targetOf(id: string, words: Words): string | null {
  const { kind, key } = parseMentionId(id)
  if (kind === 'context') return /^itm_[a-z0-9]{8,16}$/.test(key) ? `item:${key}` : null
  if (kind === 'domain') return `area:${key}`
  if (kind === 'value') return /^[a-z0-9_]+\/[a-z0-9_]+$/.test(key) ? `val:${key}` : null
  if (kind === 'term') {
    const id = words.termId(key)
    return id ? `term:${id}` : null
  }
  if (kind === 'metric' || kind === 'dimension' || kind === 'market') {
    const found = words.keyOf(key)
    if (!found) return null
    if (kind === 'metric' && found.kind !== 'metric') return null
    if (kind === 'market' && !found.key.startsWith('val:market/')) return null
    return found.key
  }
  return null
}

/**
 * The app's text as the service keeps it: the words agents read, and the markup with each mention
 * the service can follow, written only when there is one.
 */
export function textToService(text: string, words: Words): { plain: string; markup?: string } {
  const parts: MentionPart[] = mentionParts(text).map((part) => {
    if (typeof part === 'string') return { kind: 'text', text: part }
    const target = targetOf(part.id, words)
    return target
      ? { kind: 'mention', target, label: part.label }
      : { kind: 'text', text: part.label }
  })
  const plain = parts.map((p) => (p.kind === 'text' ? p.text : p.label)).join('')
  return parts.some((p) => p.kind === 'mention')
    ? { plain, markup: serializeMentions(parts) }
    : { plain }
}

/* ---------- what an item applies to ---------- */

const NO_SCOPE: Scope = { metrics: [], dimensions: [], dimensionValues: [] }

/** A scope as "Applies to" holds it: each term by its key, with the name people read. */
export function scopeTermsOf(scope: Scope, words: Words): ScopeTerm[] {
  return [
    ...scope.metrics.map((key) => ({ key, kind: 'metric' as const, name: words.nameOf(key) })),
    ...scope.dimensions.map((key) => ({
      key,
      kind: 'dimension' as const,
      name: words.nameOf(key),
    })),
    ...scope.dimensionValues.map(({ dimension, value }) => ({
      key: value,
      kind: 'value' as const,
      name: words.nameOf(value),
      dimension: words.nameOf(dimension),
    })),
  ]
}

/**
 * A published item's scope by key. An item keeps its terms by their ids (`orders`, `market` and
 * `norway`); a draft and "Applies to" name them by key (`metric:orders`, `val:market/norway`).
 */
export const keyedScope = (scope: Scope): Scope => ({
  metrics: scope.metrics.map((id) => `metric:${id}`),
  dimensions: scope.dimensions.map((id) => `dim:${id}`),
  dimensionValues: scope.dimensionValues.map(({ dimension, value }) => ({
    dimension: `dim:${dimension}`,
    value: `val:${dimension}/${value}`,
  })),
})

/**
 * "Applies to" as the service keeps a scope: each term by its key, never by its name, so two
 * values with the same name in two dimensions stay apart. A term the editor only knows by name
 * (an item whose scope was not read) is found by it.
 */
export function scopeOfTerms(terms: readonly ScopeTerm[], words: Words): Scope {
  const keys = terms.flatMap((t) => t.key || (words.keyOf(t.name, t.dimension)?.key ?? []))
  return {
    metrics: keys.filter((k) => k.startsWith('metric:') || k.startsWith('group:')),
    dimensions: keys.filter((k) => k.startsWith('dim:')),
    dimensionValues: keys
      .filter((k) => k.startsWith('val:'))
      .map((k) => ({ dimension: `dim:${k.slice(4, k.indexOf('/'))}`, value: k })),
  }
}

/* ---------- related ---------- */

/** How a neighbour relates, in Related's words; scope and domain membership are not links there. */
const relOf: Partial<Record<string, Rel>> = {
  replaces: 'replaces',
  replaced_by: 'replaced_by',
  conflicts_with: 'disagrees',
  mentions: 'mentions',
  mentioned_by: 'mentioned_by',
}

/** A neighbour's node as the app names it: an item by its id, a definition by its name. */
const targetOfNode = (node: RelatedContext['nodes'][number]): string =>
  node.type === 'item' ? `item:${node.id}` : node.type === 'area' ? `area:${node.id}` : node.id

/**
 * The service's related context as Related draws it: the links in the text both ways and the
 * owners' relations, in the service's order (the one agents follow). What an item applies to is
 * its scope, shown on the item, so it is no link here. Anything but a neighbour in service is
 * retired: shown, never followed. A neighbour in another domain says whose it is.
 */
export function linksOfRelated(related: RelatedContext, words: Words): Link[] {
  return related.nodes.flatMap((node) => {
    const rel = relOf[node.relation]
    const id = mentionIdOf(targetOfNode(node), words)
    if (!rel || !id) return []
    const { kind } = parseMentionId(id)
    // A domain is its own.
    const domain = node.type === 'area' ? node.id : node.areaId
    const to: LinkEnd = {
      id,
      kind,
      label: node.label,
      retired: node.status !== 'current',
      ...(domain ? { domain } : {}),
    }
    const otherDomain = !!related.areaId && !!domain && domain !== related.areaId
    return [{ rel, to, otherDomain }]
  })
}

/* ---------- the service's day ---------- */

/**
 * The day a time falls on in the service's calendar. The service may keep a day of its own (a
 * demo pins it): a time it stamped is that many days from the clock's day.
 */
export const serviceDay = (at: string, shift: number) => shiftDate(at.slice(0, 10), shift)

/** How many days the service's today is from the clock's day, as an index read it. */
export function dayShiftOf(index: { today: string; loadedAt: string }): number {
  return Math.round(
    (Date.parse(index.today) - Date.parse(index.loadedAt.slice(0, 10))) / 86_400_000,
  )
}

/* ---------- a context item ---------- */

/** The four kinds the app writes; an item of the fifth, `example`, is not one the app shows. */
const kindOf = (kind: string): Kind | null =>
  kind === 'event' || kind === 'issue' || kind === 'note' || kind === 'guide' ? kind : null

/** The text of an item or a draft as the app writes it: the markup when there is one. */
const text = (plain: string | undefined, markup: string | undefined, words: Words) =>
  markup !== undefined ? textFromService(markup, words) : (plain ?? '')

/** A published item as its page reads it: its text, where it comes from and what not to conclude. */
export function factOfPage(page: ServiceItemPage, names: Names, words: Words): Fact | null {
  const item = page.item
  const kind = kindOf(item.kind)
  if (!kind) return null
  const valid = validityOf(item)
  const evidence = item.evidence[0]
  const body = text(item.body, item.bodyMarkup, words)
  const owners = ownersOf(
    { owners: page.owners, ownerId: item.ownerId, areaId: item.areaId },
    names,
  )
  return {
    id: item.id,
    title: item.title,
    summary: text(item.summary, item.summaryMarkup, words),
    ...(body ? { body } : {}),
    domain: item.areaId,
    kind,
    where: page.chips,
    scope: scopeTermsOf(keyedScope(item.scope), words),
    valid,
    when: whenLabel(valid),
    status: statusOf({ status: item.status, trust: page.trust }),
    checkedBy: page.lastChecked ? names.person(page.lastChecked.personId) : '',
    checkedOn: page.lastChecked ? dateLabel(page.lastChecked.on) : '',
    source: evidence?.url ?? '',
    quote: evidence?.quote ?? '',
    dontConclude: item.notToConclude,
    ...(owners ? { owners } : {}),
    // The item it is in a conflict with, either way round (FR-220): its page and peek say so.
    ...(page.conflicts[0] ? { disagreesWith: page.conflicts[0] } : {}),
  }
}

/** A draft that was never published, as the Context list and its page read it. */
export function factOfDraft(
  proposal: Pick<ProposalRecord, 'id' | 'title' | 'areaId' | 'draft' | 'proposerId'>,
  names: Names,
  words: Words,
): Fact {
  const draft = proposal.draft
  const scope = scopeTermsOf(draft.scope ?? NO_SCOPE, words)
  const valid = draft.validity
    ? validityOf({ validity: draft.validity, reviewQuestion: 'still_correct' })
    : {}
  const evidence = draft.evidence?.[0]
  const body = text(draft.body, draft.bodyMarkup, words)
  return {
    id: proposal.id,
    title: draft.title || proposal.title || 'Untitled draft',
    summary: text(draft.summary, draft.summaryMarkup, words),
    ...(body ? { body } : {}),
    domain: draft.areaId ?? proposal.areaId ?? '',
    kind: kindOf(draft.kind ?? 'note') ?? 'note',
    where: scope.map((t) => t.name),
    scope,
    valid,
    when: whenLabel(valid),
    status: 'Draft',
    by: proposal.proposerId === null ? '' : names.person(proposal.proposerId),
    checkedBy: '',
    checkedOn: '',
    source: evidence?.url ?? '',
    quote: evidence?.quote ?? '',
    dontConclude: draft.notToConclude ?? '',
  }
}

/* ---------- history ---------- */

/** A field as the app's difference names it. */
const FIELD: Record<string, string> = { Text: 'What agents should know' }

/** One sentence: what a version changed. */
function summaryOf(entry: ItemVersionEntry): string {
  switch (entry.kind) {
    case 'published':
      return 'Published.'
    case 'checked':
      return 'Checked against the source: still true.'
    case 'moved':
      return `Moved from ${entry.before} to ${entry.after}.`
    case 'retyped':
      return `Changed from ${entry.before} to ${entry.after}.`
    case 'dates':
      return 'Changed when it applies.'
    case 'link':
      return 'Changed the source.'
    case 'wording':
      return entry.field === 'Title'
        ? 'Changed the title.'
        : entry.field === 'Text'
          ? 'Reworded what agents should know.'
          : "Changed what agents shouldn't conclude."
    case 'archived':
      return entry.after || 'Archived: agents stop getting it.'
    case 'owners':
      return entry.after || 'Changed the owners.'
    case 'conflict':
      // A settled conflict says what was decided and why; a version that set or removed the flag says which.
      if (entry.field !== 'Disagrees with') return entry.after
      return entry.after.split('\n').filter(Boolean).length >
        entry.before.split('\n').filter(Boolean).length
        ? 'Marked as disagreeing with another item.'
        : 'Removed the Conflict flag.'
  }
}

/**
 * An item's history as the app lists it, newest first, each numbered in turn: the archives and
 * owner changes between the versions are rows of their own. A row's number is its place, so
 * `versionAt` finds the service's version a row restores.
 */
export function historyOf(
  entries: readonly ItemVersionEntry[],
  names: Names,
  shift: number,
): Version[] {
  return entries.map((entry, index) => ({
    v: entries.length - index,
    who: entry.personId ? names.person(entry.personId) : 'Someone',
    on: shiftDate(entry.on, shift),
    kind: entry.kind satisfies VersionKind,
    summary: summaryOf(entry),
    field: FIELD[entry.field] ?? entry.field,
    before: entry.before,
    after: entry.after,
    ...(entry.agent
      ? { sentBy: `${entry.agent.name} for ${names.person(entry.agent.personId)}` }
      : {}),
  }))
}

/** The service's version a history row is, by the row's number; null for one that is no version. */
export function versionAt(entries: readonly ItemVersionEntry[], v: number): number | null {
  return entries[entries.length - v]?.version ?? null
}

/** A term's versions as the app lists them, newest first: what each write made of it. */
export function termHistoryOf(
  versions: readonly TermVersion[],
  person: (id: string) => string,
  shift: number,
): Version[] {
  const sorted = [...versions].sort((a, b) => b.revision - a.revision)
  return sorted.map((version, index) => {
    const before = sorted[index + 1]
    const words = (v: TermVersion | undefined) =>
      v ? (v.sameAs ? `Another name for ${v.sameAs}` : (v.meaning ?? '')) : ''
    const kind: VersionKind =
      version.change === 'created' || version.change === 'restored'
        ? 'published'
        : version.change === 'moved'
          ? 'moved'
          : version.change === 'deleted'
            ? 'archived'
            : 'wording'
    const summary = {
      created: 'Written.',
      edited: before && before.name !== version.name ? `Renamed from ${before.name}.` : 'Reworded.',
      moved: 'Moved to another domain.',
      deleted: 'Deleted.',
      restored: 'Brought back.',
    }[version.change]
    return {
      v: version.revision,
      who: person(version.personId),
      on: serviceDay(version.at, shift),
      kind,
      summary,
      field: 'Meaning',
      before: words(before),
      after: words(version),
    }
  })
}

/* ---------- changes to many items ---------- */

/** The service's log of changes to many items as the History log reads it: those still in force. */
export function logOf(changes: readonly ItemChange[], names: Names, shift: number): LogEntry[] {
  return changes
    .filter((c) => !c.undone)
    .map((c) => ({
      id: c.id,
      on: serviceDay(c.at, shift),
      who: names.person(c.personId),
      what: c.action,
      summary: c.summary,
      items: c.items.map((i) => ({ id: i.id, title: i.title, domain: i.areaId })),
    }))
}

/* ---------- the editor's item, as a draft ---------- */

/** The last day an item applies as the service keeps it: the first day it no longer applies. */
const endOf = (until: string | undefined) => (until ? shiftDate(until, 1) : null)

/**
 * What the editor wrote as the draft the service publishes. A change names only the fields it
 * changes from `before`, the item as its page read it; the service keeps the rest. The domain's
 * owners answer for it unless the item has its own.
 */
export function draftOf(fact: Fact, words: Words, today: string, before?: Fact): Draft {
  const changed = <K extends keyof Fact>(key: K) =>
    !before || JSON.stringify(fact[key] ?? null) !== JSON.stringify(before[key] ?? null)
  const draft: Draft = {}
  if (changed('domain')) draft.areaId = fact.domain
  if (changed('kind')) draft.kind = fact.kind
  if (changed('title')) draft.title = fact.title
  if (changed('summary')) {
    const summary = textToService(fact.summary, words)
    draft.summary = summary.plain
    if (summary.markup) draft.summaryMarkup = summary.markup
  }
  if (changed('body')) {
    const body = textToService(fact.body ?? '', words)
    draft.body = body.plain
    if (body.markup) draft.bodyMarkup = body.markup
  }
  // By key when the editor read the scope; an item read only as names is written by them.
  const keys = (f?: Fact) => JSON.stringify(f?.scope?.map((t) => t.key || t.name) ?? null)
  if (fact.scope ? keys(fact) !== keys(before) : changed('where'))
    draft.scope = scopeOfTerms(
      fact.scope ?? fact.where.map((name) => ({ key: '', kind: 'value', name })),
      words,
    )
  if (changed('valid'))
    draft.validity = { start: fact.valid.from ?? today, end: endOf(fact.valid.until) }
  if (changed('source') || changed('quote'))
    draft.evidence = fact.source ? [{ url: fact.source, quote: fact.quote, date: today }] : []
  if (changed('dontConclude')) draft.notToConclude = fact.dontConclude || defaultNotToConclude
  return draft
}

/** The words a draft read from text has, as the editor's item: every field it could read. */
export function factOfReadDraft(draft: Draft, names: Names, words: Words): Fact {
  return factOfDraft({ id: 'draft', title: '', areaId: null, draft, proposerId: '' }, names, words)
}

/** What the item page answers: the item and its versions, or null for one the app does not show. */
export function itemPageOf(
  page: ServiceItemPage,
  names: Names,
  words: Words,
  shift: number,
): ItemPage | null {
  const item = factOfPage(page, names, words)
  return item ? { item, history: historyOf(page.history, names, shift) } : null
}
