import type { AnswerState } from '@/model/ask'
import type { DomainId, Kind } from '@/model/items'

// A conflict as the app reads it (FR-220): two context items an owner said disagree, the item that
// holds the flag first. Declared by a person, never computed: nothing here reads what the items mean.
// The one-line summary is built from structure, the topic both apply to, never from their words.

/** What agents say: the answer's state and its words. */
export type Said = { state: AnswerState; text: string }

/** One item of a pair. Always true: a pair the person may not read whole is not found. */
export type ConflictSide = {
  id: string
  readable: boolean
  title: string | null
  summary: string | null
  kind: Kind
  domain: DomainId
  domainName: string
  /** Who answers for it, by name. */
  owners: string[]
  /** The version agents get now; a decision names both, and a newer one holds it. */
  version: number
  checkedOn: string | null
  checkedBy: string | null
  source: { url: string; quote: string } | null
}

/** What the person may do with the pair, each checked against the item it changes. */
export type ConflictRights = {
  keepHolder: boolean
  keepOther: boolean
  editHolder: boolean
  editOther: boolean
  keepBoth: boolean
  notConflict: boolean
}

export type SettleOutcome = 'kept_one' | 'kept_both' | 'not_conflict'

/** A decision on a pair, as both items' history keeps it. */
export type ConflictDecision = {
  outcome: SettleOutcome
  keptId: string | null
  reason: string
  quote: string | null
  by: string
  /** The clock time it was made, "10:40". */
  at: string
}

export type Conflict = {
  /** `holderId.otherId`, the pair's address. */
  key: string
  holder: ConflictSide
  other: ConflictSide
  /** What both apply to, in words: "Orders in Norway". */
  topic: string
  /** What both apply to, as their Applies to reads. */
  where: string[]
  /** Agent questions that got the pair as a Conflict in the last 7 days. */
  asked: number
  /** Since when agents get both, as a short date. */
  since: string | null
  /** What agents say now, with only one side, and with the flag removed. */
  said: { now: Said; onlyHolder: Said; onlyOther: Said; withoutFlag: Said } | null
  rights: ConflictRights
  /** Kept as both, and neither changed since: off the conflict lists. */
  keptBoth: ConflictDecision | null
}

/** A row of the Conflicts list. */
export type ConflictRow = {
  key: string
  holder: { id: string; title: string | null; domain: DomainId }
  other: { id: string; title: string | null; domain: DomainId }
  topic: string
  asked: number
  since: string | null
  canSettle: boolean
  mine: boolean
}

export type SettleConflict = {
  holderId: string
  otherId: string
  outcome: SettleOutcome
  /** For kept_one: the item that stays; the other is archived. */
  keepId?: string
  reason: string
  quote?: string
  /** The versions the person saw. */
  versions: { holder: number; other: number }
}

/** The one-line summary: the Conflict state's sentence and the topic. */
export const titleOf = (c: Pick<Conflict, 'topic'>) =>
  c.topic ? `Two items say different things about ${c.topic}.` : 'Two items say different things.'

/** What both apply to and what agents do meanwhile, in one quiet line. */
export const sublineOf = (c: Pick<Conflict, 'where'>) =>
  `${c.where.length ? `Both apply to ${c.where.join(', ')}. ` : ''}Agents get both and say that context disagrees. Nothing is archived until an owner chooses.`

/** What agents say about a pair today: Conflict, both given. */
export const SAID_NOW: Said = {
  state: 'conflict',
  text: 'Two items say different things. Both are given until an owner chooses.',
}

/** The title of an item the person may read, or what a hidden one is called. */
export const sideTitle = (s: Pick<ConflictSide, 'title'>) => s.title ?? 'An item you cannot read'

/** A pair's own page. */
export const conflictPath = (key: string) => `/context/conflicts/${key}`

/** The row for the pair of these two items, whichever of them holds the link. */
export const pairOfItems = <T extends { holder: { id: string }; other: { id: string } }>(
  rows: T[],
  ids: readonly string[] | undefined,
) =>
  ids?.length === 2
    ? rows.find((r) => ids.includes(r.holder.id) && ids.includes(r.other.id))
    : undefined

/** The row for a pair key (`a.b`, either way round). */
export const pairOfKey = <T extends { holder: { id: string }; other: { id: string } }>(
  rows: T[],
  key: string | undefined,
) => pairOfItems(rows, key?.split('.'))
