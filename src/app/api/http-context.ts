/**
 * The http binding's reading of Context: a context item's page and a draft into the item the
 * screens draw, the service's history into versions, its log of changes to many items into the
 * History log, and the editor's item back into the draft the service publishes. The text's
 * mentions are written both ways: the app's own token, [@ id="context:itm_..." label="..."], and
 * the service's markup, @[words](item:itm_...). Pure, so the rules are tested without a service.
 */
import type { ItemChange, ItemPage as ServiceItemPage, ItemVersionEntry } from '@contract/context'
import type { ProposalRecord } from '@contract/proposals'
import type { TermVersion } from '@contract/terms'
import type { Draft } from '@domain/draft'
import type { Vocabulary as ServiceVocabulary } from '@domain/item'
import { defaultNotToConclude } from '@domain/proposal-rules'
import { parseMentions, serializeMentions, type MentionPart } from '@domain/mentions'
import { shiftDate } from '@domain/validity'
import { mentionParts, mentionToken, parseMentionId } from '@/lib/mentions'
import type { Version, VersionKind } from '@/model/history'
import type { Fact, Kind, LogEntry } from '@/model/items'
import { dateLabel, whenLabel } from '@/model/validity'
import type { ItemPage } from './client'
import { ownersOf, statusOf, validityOf, type Names } from './http-map'

/* ---------- the words a scope and a mention name ---------- */

/** The live vocabulary both ways: a metric, a dimension or a value by its key and by its name. */
export type Words = {
  /** A scope's key for a name people read: `metric:orders`, `dim:market`, `val:market/norway`. */
  keyOf: (name: string) => { kind: 'metric' | 'dim' | 'val'; key: string } | undefined
  /** The name people read for a key, or the key's own id when the vocabulary has no name. */
  nameOf: (key: string) => string
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function wordsOf(vocabulary: ServiceVocabulary): Words {
  const names = new Map<string, string>()
  for (const m of vocabulary.metrics) names.set(`metric:${m.id}`, m.name)
  for (const d of vocabulary.dimensions) {
    names.set(`dim:${d.id}`, d.name)
    for (const v of d.values) names.set(`val:${d.id}/${v.id}`, v.name)
  }
  return {
    keyOf(name) {
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
  }
}

/* ---------- mentions ---------- */

/**
 * The service's markup as the app's text: each mention as the app's token, by the kind and the
 * key the app names it with (a metric by its name, an item by its id).
 */
export function textFromService(markup: string, words: Words): string {
  return parseMentions(markup)
    .parts.map((part) => {
      if (part.kind === 'text') return part.text
      const [kind, key = ''] = [
        part.target.slice(0, part.target.indexOf(':')),
        part.target.slice(part.target.indexOf(':') + 1),
      ]
      const id =
        kind === 'item'
          ? `context:${key}`
          : kind === 'metric'
            ? `metric:${words.nameOf(part.target)}`
            : kind === 'dim'
              ? `dimension:${words.nameOf(part.target)}`
              : kind === 'val'
                ? `${key.startsWith('market/') ? 'market' : 'dimension'}:${words.nameOf(part.target)}`
                : kind === 'area'
                  ? `domain:${key}`
                  : ''
      return id ? mentionToken({ id, label: part.label }) : part.label
    })
    .join('')
}

/** A mention as the service can keep it, or null: a term or a person is kept as its words. */
function targetOf(id: string, words: Words): string | null {
  const { kind, key } = parseMentionId(id)
  if (kind === 'context') return /^itm_[a-z0-9]{8,16}$/.test(key) ? `item:${key}` : null
  if (kind === 'domain') return `area:${key}`
  if (kind === 'metric' || kind === 'dimension' || kind === 'market') {
    const found = words.keyOf(key)
    if (!found) return null
    if (kind === 'metric' && found.kind !== 'metric') return null
    if (kind === 'market' && found.kind !== 'val') return null
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
    valid,
    when: whenLabel(valid),
    status: statusOf({ status: item.status, trust: page.trust }),
    checkedBy: page.lastChecked ? names.person(page.lastChecked.personId) : '',
    checkedOn: page.lastChecked ? dateLabel(page.lastChecked.on) : '',
    source: evidence?.url ?? '',
    quote: evidence?.quote ?? '',
    dontConclude: item.notToConclude,
    ...(owners ? { owners } : {}),
  }
}

/** A draft that was never published, as the Context list and its page read it. */
export function factOfDraft(
  proposal: Pick<ProposalRecord, 'id' | 'title' | 'areaId' | 'draft' | 'proposerId'>,
  names: Names,
  words: Words,
): Fact {
  const draft = proposal.draft
  const scope = draft.scope ?? { metrics: [], dimensions: [], dimensionValues: [] }
  const where = [
    ...scope.metrics,
    ...scope.dimensions,
    ...scope.dimensionValues.map((v) => v.value),
  ].map(words.nameOf)
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
    where,
    valid,
    when: whenLabel(valid),
    status: 'Draft',
    by: names.person(proposal.proposerId),
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
  if (changed('where')) {
    const keys = fact.where.flatMap((name) => words.keyOf(name) ?? [])
    draft.scope = {
      metrics: keys.filter((k) => k.kind === 'metric').map((k) => k.key),
      dimensions: keys.filter((k) => k.kind === 'dim').map((k) => k.key),
      dimensionValues: keys
        .filter((k) => k.kind === 'val')
        .map((k) => ({ dimension: `dim:${k.key.slice(4, k.key.indexOf('/'))}`, value: k.key })),
    }
  }
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
