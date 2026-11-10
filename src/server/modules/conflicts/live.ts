import { settleRights, type ConflictPair, type Settler } from '../../../domain/conflicts.ts'
import type { Queryable } from '../../db/database.ts'

/**
 * The live pairs (FR-220), holder first, read from the live edition's own tables: each served
 * version's flag on another served item, once per pair, with the holder pairOf picks (the lower id
 * when it holds the flag). They are the pairs conflictPairs reads from a whole serving bundle,
 * without building one, so an item's page and the library's rows stay as quick with many items
 * as with few. A subquery with the columns `holder` and `other`.
 */
export const livePairs = `(with served as materialized (
     select s.item_id, s.version_id from item_version_service s
      where s.editions @> (select seq from live_edition)),
   flags as (
     select h.item_id as a, c.other_item_id as b
       from served h join item_version_conflicts c on c.version_id = h.version_id
      where c.other_item_id <> h.item_id
        and exists (select 1 from served o where o.item_id = c.other_item_id))
   select distinct on (least(a collate "C", b collate "C"), greatest(a collate "C", b collate "C"))
          a as holder, b as other
     from flags
    order by least(a collate "C", b collate "C"), greatest(a collate "C", b collate "C"),
             a collate "C" > b collate "C")`

/** Each item's own owners, by id; an item with none is answered for by its domain's owners. */
export async function itemOwners(
  tx: Queryable,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  const rows = await tx.query<{ item: string; owners: string[] }>(
    `select o.item_id as item, array_agg(o.person_id::text order by o.person_id) as owners
       from item_owners o join people p on p.id = o.person_id
      where o.item_id = any($1::text[]) and p.deactivated_at is null and p.erased_at is null
      group by o.item_id`,
    [ids],
  )
  return new Map(rows.map((r) => [r.item, r.owners]))
}

/** Each domain's owners now, by id. */
export async function areaOwners(
  tx: Queryable,
  areaIds: readonly string[],
): Promise<Map<string, string[]>> {
  const rows = await tx.query<{ area: string; owners: string[] }>(
    `select a.area_id as area, array_agg(a.person_id::text order by a.person_id) as owners
       from area_assignments a join people p on p.id = a.person_id
      where a.area_id = any($1::text[]) and a.role = 'owner' and a.valid_at @> now()
        and p.deactivated_at is null and p.erased_at is null
      group by a.area_id`,
    [areaIds],
  )
  return new Map(rows.map((r) => [r.area, r.owners]))
}

/** Agent questions that got both items as a Conflict in the 7 days to `today`, by `holder.other`. */
export async function askedOf(
  tx: Queryable,
  today: string,
  pairs: readonly ConflictPair[],
): Promise<Map<string, number>> {
  if (!pairs.length) return new Map()
  const rows = await tx.query<{ holder: string; other: string; n: number }>(
    `select p.holder, p.other,
            (select count(*)::int from deliveries d
              where d.caller = 'agent' and d.answer_state = 'conflict'
                and d.delivered_hour >= $2::date - 6 and d.delivered_hour < $2::date + 1
                and d.delivered @> jsonb_build_array(jsonb_build_object('id', p.holder))
                and d.delivered @> jsonb_build_array(jsonb_build_object('id', p.other))) as n
       from jsonb_to_recordset($1) as p(holder text, other text)`,
    [JSON.stringify(pairs.map((p) => ({ holder: p.holderId, other: p.otherId }))), today],
  )
  return new Map(rows.map((r) => [`${r.holder}.${r.other}`, r.n]))
}

/** One conflict as an item's warning says it: the other item, and what the person may do. */
export type ItemConflict = {
  /** The pair's address, holder first: `holder.other`. */
  key: string
  otherId: string
  /** Whether the person may settle the pair one way or another (settleRights). */
  canSettle: boolean
  /** Agent questions that got both as a Conflict in the last 7 days. */
  asked: number
}

/**
 * The conflicts one item is in, for the person, in the other item's id order: only pairs whose
 * two items they may read (FR-128). Read without the serving bundle.
 */
export async function conflictsOfItem(
  tx: Queryable,
  today: string,
  person: Settler,
  id: string,
): Promise<ItemConflict[]> {
  const rows = await tx.query<{
    holder: string
    other: string
    holderArea: string
    otherArea: string
  }>(
    `select p.holder, p.other, h.area_id as "holderArea", o.area_id as "otherArea"
       from ${livePairs} p
       join v_item_list h on h.id = p.holder and cl_audience_allows(h.audience_groups)
       join v_item_list o on o.id = p.other and cl_audience_allows(o.audience_groups)
      where $1 in (p.holder, p.other)
      order by case when p.holder = $1 then p.other else p.holder end collate "C"`,
    [id],
  )
  if (!rows.length) return []
  const pairs = rows.map((r) => ({ holderId: r.holder, otherId: r.other }))
  // One after another: they share the request's transaction, which runs one query at a time.
  const own = await itemOwners(
    tx,
    rows.flatMap((r) => [r.holder, r.other]),
  )
  const domains = await areaOwners(tx, [
    ...new Set(rows.flatMap((r) => [r.holderArea, r.otherArea])),
  ])
  const asked = await askedOf(tx, today, pairs)
  const settled = (itemId: string, areaId: string) => ({
    id: itemId,
    areaId,
    owners: own.get(itemId) ?? domains.get(areaId) ?? [],
  })
  return rows.map((r) => {
    const key = `${r.holder}.${r.other}`
    const rights = settleRights(
      person,
      settled(r.holder, r.holderArea),
      settled(r.other, r.otherArea),
    )
    return {
      key,
      otherId: r.holder === id ? r.other : r.holder,
      canSettle: Object.values(rights).some(Boolean),
      asked: asked.get(key) ?? 0,
    }
  })
}
