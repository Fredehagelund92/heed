/**
 * Seeing what changed between editions in the mock (Editions design G1, G2 and G3): the same
 * rules as the service's editions engine (src/server/modules/editions/compare.ts), over the
 * mock's editions instead of the service's tables. The mock workflow says which version of an
 * item each edition serves, what that version holds and who made it and why; this file nets
 * them into the three reads, so the Editions pages and the Workbench get the same answers from
 * the mock as from the service (tests/conformance/context-api-writes.ts).
 */
import { refusals } from '../../contract/refusals.ts'
import type * as z from 'zod/mini'
import type {
  changeWhySchema,
  editionComparisonSchema,
  editionCompareInputSchema,
  editionFeedInputSchema,
  editionFeedSchema,
  itemChangeSchema,
  itemComparisonSchema,
} from '../../contract/editions.ts'
import type { Edition } from '../../contract/review.ts'
import { canonicalJson } from '../../domain/canonical.ts'
import {
  changeSentence,
  editionChangeKinds,
  highestRisk,
  isSystemFilled,
  noChanges,
  type ChangeCounts,
  type EditionChangeKind,
} from '../../domain/editions.ts'
import type { ItemKind, RiskLevel } from '../../domain/item.ts'
import { itemVersionDigestInput, type ItemVersion } from '../../domain/item-version.ts'
import { mentionDiff, versionDiff } from '../../domain/review.ts'

/** Who made a change and why (G2). */
export type ChangeWhy = z.infer<typeof changeWhySchema>
type ItemChange = z.infer<typeof itemChangeSchema>
type Comparison = z.infer<typeof editionComparisonSchema>
type ItemComparison = z.infer<typeof itemComparisonSchema>
type Feed = z.infer<typeof editionFeedSchema>

/** One version of an item as an edition serves it. */
export type ServedVersion = {
  version: number
  versionId: string
  /** A "checked, still correct" version (CON-211). */
  recheck: boolean
  title: string
  areaId: string
  kind: ItemKind
  riskLevel: RiskLevel
  /** The version has an audience group: counted, never shown (groups are parked). */
  withheld: boolean
  /** What the version holds, for its field changes; null when the item format refuses it. */
  content: () => ItemVersion | null
  /** What its content and core digests are taken over, as canonical JSON (`versionDigests`). */
  digests: () => VersionDigests
}

export type VersionDigests = { content: string; core: string }

/**
 * What a version's digests are taken over, as the service stores them: a version the item format
 * takes by its normalized content (`itemVersionDigestInput`), else the fields as they are, so two
 * versions holding the same fixture item still read as the same content.
 */
export function versionDigests(
  content: ItemVersion | null,
  fields: Record<string, unknown>,
): VersionDigests {
  if (content) {
    const input = itemVersionDigestInput(content)
    return { content: canonicalJson(input.content), core: canonicalJson(input.core) }
  }
  const { reviewDate: _review, changeMarks: _marks, ...core } = fields
  return { content: canonicalJson(fields), core: canonicalJson(core) }
}

/** What the mock knows of its editions, for the three reads. */
export type EditionWorld = {
  /** Every edition, sealed: the mock seals as it publishes. */
  editions: readonly Edition[]
  /** Items that can differ between two editions, or with what the first edition served (null). */
  candidates: (a: Edition | null, b: Edition) => Iterable<string>
  /** The version of an item an edition serves, or null. */
  served: (edition: Edition, itemId: string) => ServedVersion | null
  /** Who made a version and why; `left` asks for its retirement rather than its acceptance. */
  why: (
    itemId: string,
    version: Pick<ServedVersion, 'version' | 'versionId'>,
    left: boolean,
  ) => ChangeWhy
  areaName: (id: string) => string
  personName: (id: string) => string | null
  /** An item exists at all, served or not. */
  exists: (itemId: string) => boolean
}

/** One item whose served version differs between two states, before who and why are read. */
type ChangeRow = {
  itemId: string
  change: EditionChangeKind
  title: string
  areaId: string
  kind: ItemKind
  riskLevel: RiskLevel
  from: ServedVersion | null
  to: ServedVersion | null
  withheld: boolean
}

const noWhy = (): ChangeWhy => ({
  proposal: null,
  proposerId: null,
  channel: null,
  editedBy: null,
  decisions: [],
})

const leaves = (change: EditionChangeKind) => change === 'retired' || change === 'removed'

/**
 * Classifies a pair of versions of one item, as the service does: none before is `added`; none
 * after is `retired` when it `left` in an edition that was not a going back, else `removed`; a
 * recheck with the same core content is `checked`, the same content `resaved`, else `changed`.
 */
function classify(
  itemId: string,
  before: ServedVersion | null,
  after: ServedVersion | null,
  left: () => boolean,
): ChangeRow | null {
  if (before?.versionId === after?.versionId) return null
  const shown = (after ?? before)!
  let change: EditionChangeKind
  if (!before) change = 'added'
  else if (!after) change = left() ? 'retired' : 'removed'
  else {
    const a = before.digests()
    const b = after.digests()
    change =
      after.recheck && a.core === b.core
        ? 'checked'
        : a.content === b.content
          ? 'resaved'
          : 'changed'
  }
  return {
    itemId,
    change,
    title: shown.title,
    areaId: shown.areaId,
    kind: shown.kind,
    riskLevel: shown.riskLevel,
    from: before,
    to: after,
    withheld: Boolean(before?.withheld || after?.withheld),
  }
}

const changeRank = (change: EditionChangeKind) => editionChangeKinds.indexOf(change)
/** Change order (added first), then title, then id: the order every list of changes uses. */
function byChange(a: ChangeRow, b: ChangeRow) {
  return (
    changeRank(a.change) - changeRank(b.change) ||
    a.title.localeCompare(b.title, 'en') ||
    (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)
  )
}

/** How often each value occurs, by value. */
function tally<Value extends string>(values: readonly Value[]): [Value, number][] {
  const counts = new Map<Value, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
}

function countChanges(rows: readonly ChangeRow[]): ChangeCounts {
  const counts = noChanges()
  for (const row of rows) counts[row.change] += 1
  return counts
}

const sortedAreas = (rows: readonly ChangeRow[]) => [...new Set(rows.map((r) => r.areaId))].sort()

const versionRef = (version: ServedVersion | null) =>
  version && { version: version.version, versionId: version.versionId }

function asChange(world: EditionWorld, row: ChangeRow): ItemChange {
  const why =
    row.change === 'removed'
      ? // Going back takes an item out without a decision; the edition says who and why.
        noWhy()
      : leaves(row.change)
        ? world.why(row.itemId, row.from!, true)
        : world.why(row.itemId, row.to!, false)
  return {
    itemId: row.itemId,
    change: row.change,
    title: row.title,
    areaId: row.areaId,
    kind: row.kind,
    riskLevel: row.riskLevel,
    from: versionRef(row.from),
    to: versionRef(row.to),
    why,
  }
}

/** The editions in seq order, each with the one sealed before it (null for the first). */
function ordered(world: EditionWorld) {
  const editions = [...world.editions].sort((a, b) => a.seq - b.seq)
  return editions.map((edition, index) => ({ edition, before: editions[index - 1] ?? null }))
}

function editionByLabel(world: EditionWorld, label: string, refuse: Refuse): Edition {
  return (
    world.editions.find((edition) => edition.label === label) ??
    refuse('not-found', refusals.notFound)
  )
}

type Refuse = (kind: 'not-found', message: string) => never

/** The two editions of a comparison: by default the live edition and the one before it. */
function editionPair(world: EditionWorld, refuse: Refuse, from?: string, to?: string) {
  const later = to
    ? editionByLabel(world, to, refuse)
    : world.editions.find((edition) => edition.live)!
  const earlier = from
    ? editionByLabel(world, from, refuse)
    : (ordered(world).find((step) => step.edition.seq === later.seq)?.before ?? null)
  return { from: earlier, to: later, a: earlier?.seq ?? 0, b: later.seq }
}

/** What an item served in `a` (null: before the first edition) and serves in `b`. */
const servedAt = (world: EditionWorld, edition: Edition | null, id: string) =>
  edition ? world.served(edition, id) : null

/**
 * How one item differs between two editions, netted: from how it was in `from` to how it is in
 * `to`. Going forward, an item that left was retired unless it last left in a going back.
 */
function netChange(
  world: EditionWorld,
  id: string,
  from: Edition | null,
  to: Edition,
): ChangeRow | null {
  const a = from?.seq ?? 0
  const left = () => {
    if (a >= to.seq) return false
    // The last edition in the range where a version of the item stopped being served.
    const ended = ordered(world)
      .filter(({ edition }) => edition.seq > a && edition.seq <= to.seq)
      .findLast(({ edition, before }) => {
        const was = servedAt(world, before, id)
        return was !== null && was.versionId !== world.served(edition, id)?.versionId
      })
    return ended?.edition.reason !== 'rollback'
  }
  return classify(id, servedAt(world, from, id), world.served(to, id), left)
}

/** Every item whose served version differs between two editions, each once. */
function rangeChanges(world: EditionWorld, from: Edition | null, to: Edition): ChangeRow[] {
  return [...new Set(world.candidates(from, to))].sort().flatMap((id) => {
    const row = netChange(world, id, from, to)
    return row ? [row] : []
  })
}

/** What one edition changed against the edition sealed before it. */
function editionChanges(world: EditionWorld, edition: Edition, before: Edition | null) {
  return [...new Set(world.candidates(before, edition))].sort().flatMap((id) => {
    const row = classify(
      id,
      servedAt(world, before, id),
      world.served(edition, id),
      () => edition.reason !== 'rollback',
    )
    return row ? [row] : []
  })
}

const fieldNames = (row: ChangeRow): string[] => {
  if (row.change !== 'changed' && row.change !== 'checked') return []
  const before = row.from!.content()
  const after = row.to!.content()
  return before && after ? versionDiff(before, after).map((change) => change.field) : []
}

/**
 * G1, net change: every item that differs between two editions, once, with counts over all of
 * them for the filter menus and a page of the ones that match. `items` narrows the changed items,
 * their counts and the withheld count to those items, as the Workbench asks about the items of
 * one test question. The mock keeps no vocabulary versions, so no vocabulary term ever differs.
 */
export function compareEditions(
  world: EditionWorld,
  input: z.infer<typeof editionCompareInputSchema>,
  refuse: Refuse,
  { items }: { items?: readonly string[] } = {},
): Comparison {
  const { from, to, a, b } = editionPair(world, refuse, input.from, input.to)
  const only = items ? new Set(items) : null
  const changed = rangeChanges(world, from, to).filter((row) => !only || only.has(row.itemId))
  const rows = changed.filter((row) => !row.withheld).sort(byChange)
  const editions = world.editions.filter(
    (edition) => edition.seq > Math.min(a, b) && edition.seq <= Math.max(a, b),
  ).length
  const matching = rows.filter(
    (row) =>
      (!input.change || row.change === input.change) &&
      (!input.areaId || row.areaId === input.areaId) &&
      (!input.kind || row.kind === input.kind) &&
      (!input.riskLevel || row.riskLevel === input.riskLevel),
  )
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const counts = countChanges(rows)
  return {
    from,
    to,
    editions,
    backwards: a > b,
    sentence: changeSentence({
      reason: null,
      counts,
      only: rows.length === 1 ? rows[0]! : null,
      areas: sortedAreas(rows).map(world.areaName),
      vocabulary: 0,
      withheld: changed.length - rows.length,
      editions,
    }),
    facets: {
      change: counts,
      areas: tally(rows.map((row) => row.areaId)).map(([areaId, count]) => ({ areaId, count })),
      kinds: tally(rows.map((row) => row.kind)).map(([kind, count]) => ({ kind, count })),
      risks: tally(rows.map((row) => row.riskLevel)).map(([riskLevel, count]) => ({
        riskLevel,
        count,
      })),
    },
    vocabulary: 0,
    withheld: changed.length - rows.length,
    total: matching.length,
    limit,
    offset,
    items: matching
      .slice(offset, offset + limit)
      .map((row) => ({ ...asChange(world, row), fields: fieldNames(row) })),
  }
}

/** The field changes of one item, from the earlier state to the later one. */
function fieldChanges(before: ItemVersion | null, after: ItemVersion | null) {
  if (after) return versionDiff(before, after)
  // An item that left: every field it had, going to nothing.
  return before
    ? versionDiff(null, before).map(({ field, after: value }) => ({
        field,
        before: value,
        after: null,
      }))
    : []
}

/**
 * G1 and G2 for one item: its field changes between two editions, its mentions added and
 * removed, and each edition in between that changed it, with who and why at each step.
 */
export function compareItem(
  world: EditionWorld,
  input: { id: string; from?: string | undefined; to?: string | undefined },
  refuse: Refuse,
): ItemComparison {
  if (!world.exists(input.id)) return refuse('not-found', "We couldn't find this fact.")
  const { from, to, a, b } = editionPair(world, refuse, input.from, input.to)
  const row = netChange(world, input.id, from, to)
  const steps = ordered(world)
    .filter(({ edition }) => edition.seq > Math.min(a, b) && edition.seq <= Math.max(a, b))
    .flatMap(({ edition, before }) => {
      const step = classify(
        input.id,
        servedAt(world, before, input.id),
        world.served(edition, input.id),
        () => edition.reason !== 'rollback',
      )
      return step ? [{ edition, step }] : []
    })
  // Like the edition export, nothing of a version with an audience group is shown.
  if (row?.withheld || steps.some(({ step }) => step.withheld))
    return refuse('not-found', "We couldn't find this fact.")
  const before = row?.from?.content() ?? null
  const after = row?.to?.content() ?? null
  return {
    from: from?.label ?? null,
    to: to.label,
    backwards: a > b,
    change: row ? asChange(world, row) : null,
    fields: fieldChanges(before, after).map((change) => ({
      ...change,
      systemFilled: isSystemFilled(change.field),
    })),
    mentions: mentionDiff(before?.mentions ?? [], after?.mentions ?? []),
    steps: steps.map(({ edition, step }) => {
      const { from: stepFrom, to: stepTo, change, why } = asChange(world, step)
      return { edition, change, from: stepFrom, to: stepTo, why }
    }),
  }
}

/** Editions made by decisions on their items, whose decisions say who and why. */
const decidedBy: readonly string[] = ['proposal_accepted', 'item_retired', 'source_rechecked']

/** How many of an edition's items the feed lists; the rest are counted in `more`. */
const FEED_ITEMS = 10

/**
 * G3: editions newest first, each with what it changed, in counts and in one sentence that says
 * who did it and why. Cursor paging by edition.
 */
export function editionFeed(
  world: EditionWorld,
  input: z.infer<typeof editionFeedInputSchema>,
  refuse: Refuse,
): Feed {
  const limit = input.limit ?? 20
  const before = input.before ? editionByLabel(world, input.before, refuse) : null
  const after = input.after ? editionByLabel(world, input.after, refuse) : null
  const through = input.through ? editionByLabel(world, input.through, refuse) : null
  const page = ordered(world)
    .filter(
      ({ edition }) =>
        (!before || edition.seq < before.seq) &&
        (!after || edition.seq > after.seq) &&
        (!through || edition.seq <= through.seq),
    )
    .reverse()
    .slice(0, limit + 1)
  const next = page.length > limit ? page[limit - 1]!.edition.label : null
  return {
    next,
    entries: page.slice(0, limit).map(({ edition, before: previous }) => {
      const changed = editionChanges(world, edition, previous)
      const changes = changed.filter((row) => !row.withheld).sort(byChange)
      const items = changes.slice(0, FEED_ITEMS).map((row) => asChange(world, row))
      // A decision made this edition when it accepted, retired or checked items; going back or
      // changing an area brings no decision of its own, only the edition's actor and note.
      const made = decidedBy.includes(edition.reason)
        ? items
            .flatMap((item) => item.why.decisions)
            .sort((x, y) => (x.decidedAt < y.decidedAt ? -1 : x.decidedAt > y.decidedAt ? 1 : 0))
        : []
      const actorId = edition.actorId ?? made.at(-1)?.decidedBy ?? null
      const deciding = made.filter((decision) => decision.capacity !== 'approver')
      const why = edition.note ?? deciding.at(-1)?.reason ?? made.at(-1)?.reason ?? null
      const proposers = [...new Set(items.map((item) => item.why.proposerId).filter(Boolean))]
      const counts = countChanges(changes)
      const areas = sortedAreas(changes)
      const named = (id: string | null | undefined) => (id ? world.personName(id) : null)
      return {
        edition,
        sentence: changeSentence({
          reason: edition.reason,
          restores: edition.restores,
          actor: named(actorId),
          proposer:
            proposers.length === 1 && changes.length === items.length ? named(proposers[0]) : null,
          why,
          counts,
          only: changes.length === 1 ? changes[0]! : null,
          areas: areas.map(world.areaName),
          vocabulary: 0,
          withheld: changed.length - changes.length,
        }),
        counts,
        areas,
        highestRisk: highestRisk(changes.map((change) => change.riskLevel)),
        vocabulary: 0,
        actorId,
        why,
        items,
        more: changes.length - items.length,
        withheld: changed.length - changes.length,
      }
    }),
  }
}
