import type { EditionChangeKind } from '../../domain/editions.ts'
import type { ItemKind } from '../../domain/item.ts'
import type { Clock } from '../clock.ts'
import type { Database, Queryable } from '../db/database.ts'
import { compareEditions, listEditions } from '../modules/editions/index.ts'
import { createGapsService } from '../modules/gaps/index.ts'
import { waitingMembers, type WaitingMember } from '../modules/review/index.ts'

/*
  What domain_overview and what_changed read beside the served edition (FR-339, FR-340): how
  many owners each domain has (served context names the role, never the person, FR-326), the open gaps, the sealed editions and what changed between two of
  them, and the members of the definition sources a domain has that are no vocabulary term yet.
  Every read goes through the service function the API uses (the gaps list with its privacy
  rule, the edition comparison, the vocabulary's candidates), so nothing here decides what a
  reader may see: the outcome tools then keep only what an agent may read of the live edition
  (FR-314).
*/

export type OwnerLine = { areaId: string; count: number }
export type GapLine = {
  ref: string
  status: string
  areaId: string | null
  metrics: string[]
  dimensionValues: string[]
  month: string
  /** Null below the minimum count a reader may see (FR-614). */
  reports: number | null
  noItemCalls: number | null
  lastSeen: string
}
export type EditionLine = { label: string; live: boolean; reason: string; sealedAt: string | null }
export type ChangeLine = {
  itemId: string
  change: EditionChangeKind
  title: string
  areaId: string
  kind: ItemKind
  /** The fields that differ, for a changed item. */
  fields: string[]
}
export type Changes = {
  from: string | null
  to: string
  /** Editions after `from`, up to and including `to`. */
  editions: number
  /** Changed items for everyone, at most `limit` of them; items for a group are left out. */
  items: ChangeLine[]
  /** All changed items for everyone, before the limit. */
  total: number
  vocabulary: number
}

/**
 * The members of the definition sources that domains have and the vocabulary does not yet, and
 * who may propose them as terms: an administrator, in Administration, Sources.
 */
export type WaitingTerms = {
  members: WaitingMember[]
  /** Whether the reader is an administrator, who proposes them. */
  canPropose: boolean
}

export interface ServingReads {
  /** How many active owners each domain has. */
  owners(): Promise<OwnerLine[]>
  /** Open gaps (open, or a proposal made) as the reader may see them, newest first. */
  openGaps(areaId?: string): Promise<GapLine[]>
  /** Sealed editions, newest first. */
  editions(limit: number): Promise<EditionLine[]>
  /** What changed from one sealed edition to another: by default the live one and the one before. */
  changes(input: { from?: string; to?: string; limit: number }): Promise<Changes>
  /** The source members that are no vocabulary term yet, by domain, and who may propose them. */
  waiting(): Promise<WaitingTerms>
}

/** The reads in a transaction already open as a person (the assistant) or as nobody (an agent). */
export function readsIn(tx: Queryable, clock: Clock, personId: string | null): ServingReads {
  return {
    owners: () =>
      tx.query<OwnerLine>(
        `select a.area_id as "areaId", count(distinct a.person_id)::int as count
           from area_assignments a join people p on p.id = a.person_id
          where a.role = 'owner' and a.valid_at @> now()
            and p.deactivated_at is null and p.erased_at is null
          group by a.area_id order by a.area_id`,
      ),
    async openGaps(areaId) {
      // The list only reads: the person decides what it shows, and nobody is written as them.
      const gaps = createGapsService(tx, clock, personId ?? '')
      const listed = [
        ...(await gaps.list({ ...(areaId ? { areaId } : {}), status: 'open', limit: 200 })),
        ...(await gaps.list({
          ...(areaId ? { areaId } : {}),
          status: 'proposal_made',
          limit: 200,
        })),
      ]
      return listed
        .map((gap) => ({
          ref: gap.ref,
          status: gap.status,
          areaId: gap.topic.areaId,
          metrics: gap.topic.metrics,
          dimensionValues: gap.topic.dimensionValues.map((value) => value.value),
          month: gap.topic.month,
          reports: gap.reports,
          noItemCalls: gap.noItemCalls,
          lastSeen: gap.lastSeen,
        }))
        .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0))
    },
    async editions(limit) {
      return (await listEditions(tx, limit)).map((edition) => ({
        label: edition.label,
        live: edition.live,
        reason: edition.reason,
        sealedAt: edition.sealedAt,
      }))
    },
    async changes({ from, to, limit }) {
      const comparison = await compareEditions(tx, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        limit,
      })
      return {
        from: comparison.from?.label ?? null,
        to: comparison.to.label,
        editions: comparison.editions,
        items: comparison.items.map((item) => ({
          itemId: item.itemId,
          change: item.change,
          title: item.title,
          areaId: item.areaId,
          kind: item.kind,
          fields: item.fields,
        })),
        total: comparison.total,
        vocabulary: comparison.vocabulary,
      }
    },
    async waiting() {
      const members = await waitingMembers(tx)
      const [reader] = await tx.query<{ admin: boolean }>('select cl_is_admin_now() as admin')
      return { members, canPropose: reader?.admin === true }
    },
  }
}

/**
 * The reads for an agent over MCP: each in its own transaction that names no person, so the
 * gaps show as they do to any reader (FR-614).
 */
export function createServingReads(database: Database, clock: Clock): ServingReads {
  const run = <T>(read: (reads: ServingReads) => Promise<T>) =>
    database.transaction(null, (tx) => read(readsIn(tx, clock, null)))
  return {
    owners: () => run((reads) => reads.owners()),
    openGaps: (areaId) => run((reads) => reads.openGaps(areaId)),
    editions: (limit) => run((reads) => reads.editions(limit)),
    changes: (input) => run((reads) => reads.changes(input)),
    waiting: () => run((reads) => reads.waiting()),
  }
}
