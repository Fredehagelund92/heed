import { ORPCError } from '@orpc/client'
import type { Queryable } from '../../db/database.ts'
import type { Edition } from '../../../contract/review.ts'
import { reconcileSourceFlags } from '../connectors/index.ts'
import { blockedVersions } from './compare.ts'

export type EditionReason =
  | 'proposal_accepted'
  | 'item_retired'
  | 'vocabulary_changed'
  | 'area_map_changed'
  | 'source_rechecked'
  | 'item_restored'
  | 'area_deleted'
  | 'area_restored'
  | 'decision_undone'

/** What one edition changes. Every step is a guarded database function (FR-205). */
export type EditionChange = {
  reason: EditionReason
  note?: string | null
  serve?: readonly string[]
  close?: readonly string[]
  vocabulary?: readonly string[]
  /** Terms to retire, by key: only deleting a domain retires one (0076). */
  retire?: readonly string[]
}

export const editionFields = `e.seq::float8 as seq,e.label,e.reason::text as reason,e.actor_id::text as "actorId",e.note,
  (select r.label from editions r where r.seq=e.restores_seq) as restores,encode(e.digest,'hex') as digest,
  e.sealed_at::text as "sealedAt",e.created_at::text as "createdAt",
  coalesce(e.seq=(select seq from live_edition),false) as live`

/**
 * Serializes every release with one transaction lock on the edition key, the same key submit
 * takes shared, so the live edition a release checked cannot move before it publishes.
 */
export async function lockReleases(tx: Queryable) {
  await tx.query("select pg_advisory_xact_lock(hashtextextended('context_layer.edition',0))")
}

export async function editionBySeq(tx: Queryable, seq: string | number): Promise<Edition> {
  const [row] = await tx.query<Edition>(`select ${editionFields} from editions e where e.seq=$1`, [
    seq,
  ])
  // eslint-disable-next-line heed/plain-words -- shown only on the Editions page
  if (!row) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this edition." })
  return row
}

export async function editionByLabel(tx: Queryable, label: string): Promise<Edition> {
  const [row] = await tx.query<Edition>(
    `select ${editionFields} from editions e where e.label=$1 and e.sealed_at is not null`,
    [label],
  )
  // eslint-disable-next-line heed/plain-words -- shown only on the Editions page
  if (!row) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this edition." })
  return row
}

export async function liveEdition(tx: Queryable): Promise<Edition> {
  const [row] = await tx.query<Edition>(
    `select ${editionFields} from editions e join live_edition l on l.seq=e.seq`,
  )
  if (!row) throw new ORPCError('NOT_FOUND', { message: 'Nothing is shared with agents yet.' })
  return row
}

async function announce(tx: Queryable, edition: Edition, action: string, areaId?: string | null) {
  await tx.query(
    `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
    values('edition.published',$1,'edition',$2,$3)`,
    [
      areaId ?? null,
      edition.label,
      JSON.stringify({ seq: edition.seq, label: edition.label, reason: edition.reason }),
    ],
  )
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
    values(cl_person(),case when cl_person() is null then 'system' else 'person' end,$1,$2,'edition',$3,$4)`,
    [
      action,
      areaId ?? null,
      edition.label,
      JSON.stringify({ seq: edition.seq, reason: edition.reason, note: edition.note }),
    ],
  )
}

/**
 * The publish transaction (plan 8.2): open, serve and close, seal with a content digest, and move
 * the live pointer in one statement. The caller holds the release lock and has authorized the
 * change; the database refuses anything without its decisions and passing checks.
 */
export async function publishEdition(
  tx: Queryable,
  change: EditionChange,
  areaId?: string | null,
): Promise<Edition> {
  const [opened] = await tx.query<{ seq: string }>(
    'select edition_open($1,cl_person(),$2)::text as seq',
    [change.reason, change.note ?? null],
  )
  const seq = opened!.seq
  // One statement per kind of change, each row in the order given: an edition that accepts a
  // batch of terms serves hundreds of versions.
  if (change.serve?.length)
    await tx.query(
      'select edition_serve_item_version($1,v) from unnest($2::uuid[]) with ordinality as x(v,n)',
      [seq, change.serve],
    )
  if (change.close?.length)
    await tx.query(
      'select edition_close_item($1,i) from unnest($2::text[]) with ordinality as x(i,n)',
      [seq, change.close],
    )
  if (change.vocabulary?.length)
    await tx.query(
      'select edition_serve_vocab_version($1,v) from unnest($2::uuid[]) with ordinality as x(v,n)',
      [seq, change.vocabulary],
    )
  if (change.retire?.length)
    await tx.query(
      'select edition_close_vocab_term($1,k) from unnest($2::text[]) with ordinality as x(k,n)',
      [seq, change.retire],
    )
  // Every edition carries the domains the definition source gives its terms now (CON-206).
  const [pinned] = await tx.query<{ changed: number }>(
    'select edition_pin_source_domains($1) as changed',
    [seq],
  )
  await tx.query('select edition_seal($1)', [seq])
  await tx.query('select edition_publish($1,cl_person())', [seq])
  const edition = await editionBySeq(tx, seq)
  await announce(tx, edition, 'edition.published', areaId)
  // When the area map changed, a topic seen before its metrics had a domain takes the one they
  // have now.
  if (pinned!.changed > 0 || change.vocabulary?.length || change.retire?.length)
    await tx.query('select cl_topics_adopt_domains()')
  // A recheck or a newer version with current marks clears its flag in the same edition.
  await reconcileSourceFlags(tx, {
    reason: change.reason === 'source_rechecked' ? change.note : null,
  })
  return edition
}

/**
 * FR-215: a change in the area map is a new edition. When the domains the definition source gives
 * differ from the live edition's, an edition takes them; nothing else changes in it. Returns it,
 * or null when the live edition is current (or none is live yet: the first edition pins them).
 */
export async function publishSourceDomains(tx: Queryable): Promise<Edition | null> {
  await lockReleases(tx)
  const [behind] = await tx.query<{ behind: boolean }>(
    'select cl_source_domains_behind() as behind',
  )
  if (!behind?.behind) return null
  return publishEdition(tx, {
    reason: 'area_map_changed',
    note: 'The definition source gave terms other domains',
  })
}

/** FR-217: a new edition whose content equals an earlier one; the history log records it. */
export async function rollbackTo(tx: Queryable, label: string, note: string): Promise<Edition> {
  await lockReleases(tx)
  const target = await editionByLabel(tx, label)
  if (target.live)
    // eslint-disable-next-line heed/plain-words -- shown only on the Editions page
    throw new ORPCError('CONFLICT', { message: 'Agents already get this edition.' })
  // Every version served again passes the serving rules once more (FR-205). Name the ones that
  // would not, instead of letting the database guard fail the whole transaction.
  const blocked = await blockedVersions(tx, target.seq)
  if (blocked.length) {
    const [first] = blocked
    const others =
      blocked.length > 1
        ? ` ${blocked.length - 1} more ${blocked.length === 2 ? 'fact' : 'facts'} can't either.`
        : ''
    throw new ORPCError('CONFLICT', {
      // eslint-disable-next-line heed/plain-words -- shown only on the Editions page
      message: `You can't go back to edition ${label}. ${first!.title === null ? 'A fact' : `"${first!.title}"`} (version ${first!.version}) can't be shared with agents again: ${first!.problem}.${others}`,
      data: { blocked },
    })
  }
  const [restored] = await tx.query<{ seq: string }>(
    'select edition_restore($1,cl_person(),$2)::text as seq',
    [target.seq, note],
  )
  const edition = await editionBySeq(tx, restored!.seq)
  await announce(tx, edition, 'edition.rollback')
  await leaveBin(tx, edition)
  // Versions served again are checked against today's definitions.
  await reconcileSourceFlags(tx)
  return edition
}

/**
 * A rollback serves exactly the edition it goes back to. An item in the Bin (0067) that it serves
 * again leaves the Bin with it, so no item is both served and out of the library.
 */
async function leaveBin(tx: Queryable, edition: Edition) {
  const rows = await tx.query<{
    itemId: string
    areaId: string
    versionId: string
    title: string | null
  }>(
    `update item_bin b set restored_by=cl_person(),restored_at=now(),restored_via='rollback',restored_edition=$1
      where b.restored_at is null
        and exists (select 1 from item_version_service s where s.item_id=b.item_id and s.editions @> $1::bigint)
      returning b.item_id as "itemId",b.area_id as "areaId",b.version_id::text as "versionId",
        -- The history log names no item the audience rule hides (0083).
        (select v.title from item_versions v where v.id=b.version_id and cl_version_open(v.id)) as title`,
    [edition.seq],
  )
  for (const row of rows)
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values(cl_person(),'person','item.restored',$1,'item',$2,$3)`,
      [
        row.areaId,
        row.itemId,
        JSON.stringify({
          title: row.title,
          versionId: row.versionId,
          edition: edition.label,
          via: 'rollback',
        }),
      ],
    )
}

export async function listEditions(tx: Queryable, limit = 50, offset = 0): Promise<Edition[]> {
  return tx.query<Edition>(
    `select ${editionFields} from editions e where e.sealed_at is not null
     order by e.seq desc limit $1 offset $2`,
    [limit, offset],
  )
}

type Stop = {
  seq: number
  at: string
  scope: 'all' | 'area' | 'item'
  areaId: string | null
  itemId: string | null
  reason: string | null
}

export function activeStops(tx: Queryable): Promise<Stop[]> {
  return tx.query<Stop>(
    `select seq::float8 as seq,at::text as at,scope,area_id as "areaId",item_id as "itemId",reason
       from v_overlay_on where kind='stop_on' order by seq`,
  )
}

/**
 * The stop switch (FR-805) is an overlay event, not an edition: serving reads the overlay counter
 * on every call, so it takes effect for the next request on every instance.
 */
export async function setStop(
  tx: Queryable,
  input: {
    scope: 'all' | 'area' | 'item'
    areaId?: string | undefined
    itemId?: string | undefined
    on: boolean
    reason: string
  },
): Promise<Stop[]> {
  const areaId = input.scope === 'area' ? input.areaId : undefined
  const itemId = input.scope === 'item' ? input.itemId : undefined
  if (
    (input.scope === 'area') !== (input.areaId !== undefined) ||
    (input.scope === 'item') !== (input.itemId !== undefined)
  )
    throw new ORPCError('BAD_REQUEST', { message: 'Name either the domain or the fact to stop.' })
  const exists =
    input.scope === 'all'
      ? true
      : (
          await tx.query(
            input.scope === 'area'
              ? 'select 1 from areas where id=$1'
              : 'select 1 from items where id=$1',
            [areaId ?? itemId],
          )
        ).length > 0
  if (!exists)
    throw new ORPCError('NOT_FOUND', {
      message: "We couldn't find this domain or fact. Someone may have deleted it.",
    })
  const active = (await activeStops(tx)).some(
    (s) =>
      s.scope === input.scope && s.areaId === (areaId ?? null) && s.itemId === (itemId ?? null),
  )
  if (active !== input.on) {
    const [event] = await tx.query<{ seq: string }>(
      `insert into overlay_events(kind,scope,area_id,item_id,reason,actor_id)
       values($1,$2,$3,$4,$5,cl_person()) returning seq::text`,
      [
        input.on ? 'stop_on' : 'stop_off',
        input.scope,
        areaId ?? null,
        itemId ?? null,
        input.reason,
      ],
    )
    await tx.query(
      `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
       values('serving.changed',$1,'overlay',$2,$3)`,
      [areaId ?? null, event!.seq, JSON.stringify({ seq: event!.seq, stop: input.on })],
    )
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
       values(cl_person(),'person',$1,$2,$3,$4,$5)`,
      [
        input.on ? 'stop.on' : 'stop.off',
        areaId ?? null,
        input.scope,
        itemId ?? areaId ?? 'all',
        JSON.stringify({ reason: input.reason }),
      ],
    )
  }
  return activeStops(tx)
}
