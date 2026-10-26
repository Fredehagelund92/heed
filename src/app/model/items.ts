import type { ItemKind } from '@domain/item'
import { whenLabel, type Validity } from './validity'

// A context item as the app's screens read it, from the app's API (src/app/api). Pure types, the
// words for its kinds, and the rules that follow from its fields; the items themselves come from
// a binding.

/** A domain's id: `sales`, `customer_value`. Domains are created and deleted, so any string. */
export type DomainId = string

/** The four kinds the app writes; the item model's fifth, `example`, is not offered. */
export type Kind = Exclude<ItemKind, 'example'>

/** A draft was never published: agents never got it, so it can be deleted. A published item is archived instead. */
export type Status = 'Draft' | 'Live' | 'Needs checking' | 'Archived'

/**
 * The four kinds of context, in plain words most people know, native English or not. The one
 * place their names and hints live; the stored values (event, issue, note, guide) stay as they are.
 */
export const kindLabel: Record<Kind, string> = {
  event: 'Event',
  issue: 'Warning',
  note: 'Rule',
  guide: 'Guide',
}

export const kindHint: Record<Kind, string> = {
  event: 'Something that happened on a date, like a stop or a new rule.',
  issue: 'A limit or problem agents should know, like late or missing data.',
  note: 'A fixed way to read the numbers, like a definition or a house rule.',
  guide: 'What to check before you explain a change.',
}

export type Fact = {
  id: string
  title: string
  summary: string
  body?: string
  domain: DomainId
  kind: Kind
  where: string[]
  /** When it applies, as stored (dates, not words). */
  valid: Validity
  /** Derived from `valid` by whenLabel: the When people read. Never typed by hand. */
  when: string
  status: Status
  checkedBy: string
  checkedOn: string
  source: string
  quote: string
  dontConclude: string
  causes?: boolean
  outOfDate?: string
  disagreesWith?: string
  /** The older context item this one replaced: it stays, archived, and links say so. */
  replaces?: string
  /** Published from a suggestion a sync created: the document it came from. */
  origin?: { tool: 'Google Drive'; folder: string; doc: string; read: string }
  /** Who answers for it, when not its domain's owners: set in the editor or in bulk. */
  owners?: string[]
  /** Who started a draft. */
  by?: string
}

/** What agents get: a published item that isn't archived. */
export const servedToAgents = (f: Pick<Fact, 'status'>) =>
  f.status === 'Live' || f.status === 'Needs checking'

/** A context item as stored: its labels are derived when it loads. */
export type StoredFact = Omit<Fact, 'when'>

/** Adds the labels people read to a stored item. */
export const withWhen = (f: StoredFact): Fact => ({ ...f, when: whenLabel(f.valid) })

/** A metric as the definitions source names it. */
export type Metric = {
  name: string
  group: string
  domain?: DomainId
  facts: number
  note?: 'changed' | 'none'
  definition: string
  /** Other names analysts use, adopted from Cube or added by an owner. */
  otherNames?: string[]
}

/** What a change to many items did, as their History and Settings say it. */
export type LogEntry = {
  id: string
  /** ISO date. */
  on: string
  who: string
  what: 'archived' | 'deleted' | 'moved' | 'kind' | 'owners' | 'checked'
  /** One sentence: "Moved to Marketing." */
  summary: string
  items: { id: string; title: string; domain?: DomainId }[]
}

/** A suggestion someone sent from the editor: it waits for the owner, visibly, until they decide. */
export type Sent = {
  id: string
  factId?: string
  title: string
  by: string
  to: string
  domain: DomainId
  at: string
}
