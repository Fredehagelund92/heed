import { ORPCError } from '@orpc/client'
import {
  EDITION_EXPORT_FORMAT,
  type EditionExport,
  type ExportedTerm,
} from '../../../domain/edition-export.ts'
import type { AreaState } from '../../../domain/item.ts'
import { namedItems } from '../../../domain/mentions.ts'
import type { Queryable } from '../../db/database.ts'
import { hiddenItems } from '../library/index.ts'
import { readVersions } from '../proposals/index.ts'

/**
 * NFR-045 and NFR-093: one sealed edition as a document that converts to canonical JSON, with
 * the digests it was sealed with. Each item is its served version in the item format, mention
 * markup and mention rows included, so the file can be checked offline and imported again.
 */
export async function exportEdition(tx: Queryable, label: string): Promise<EditionExport> {
  const [edition] = await tx.query<EditionExport['edition'] & { digest: string }>(
    `select e.seq::float8 as seq,e.label,e.reason::text as reason,e.note,
       (select r.label from editions r where r.seq=e.restores_seq) as restores,
       e.created_at::text as "createdAt",e.sealed_at::text as "sealedAt",encode(e.digest,'hex') as digest
     from editions e where e.label=$1 and e.sealed_at is not null`,
    [label],
  )
  if (!edition)
    // eslint-disable-next-line heed/plain-words -- shown only on the Editions page
    throw new ORPCError('NOT_FOUND', { message: "We couldn't find this edition." })
  const { digest, ...head } = edition
  const served = await tx.query<{
    itemId: string
    versionId: string
    digest: string
    withheld: boolean
  }>(
    `select item_id as "itemId",version_id::text as "versionId",digest,not open as withheld
     from cl_edition_versions($1::bigint) order by item_id`,
    [head.seq],
  )
  const read = await readVersions(
    tx,
    served.filter((row) => !row.withheld).map((row) => row.versionId),
  )
  // A version that names an item the reader may not receive is withheld whole: its markup cannot
  // be shown without that item, and its digest needs every word of it.
  const hidden = await hiddenItems(
    tx,
    read.flatMap((row) => namedItems(row.version)),
  )
  const versions = new Map(
    read
      .filter((row) => !namedItems(row.version).some((id) => hidden.has(id)))
      .map((row) => [row.id, row]),
  )
  const items: EditionExport['items'] = []
  const withheld: EditionExport['withheld'] = []
  for (const row of served) {
    const stored = versions.get(row.versionId)
    // A version the audience rule hides from the reader keeps only its digest here (0083).
    if (!stored) withheld.push({ id: row.itemId, digest: row.digest })
    else
      items.push({
        id: row.itemId,
        version: stored.versionNo,
        digest: row.digest,
        ...stored.version,
      })
  }
  const vocabulary = await tx.query<ExportedTerm>(
    `select s.term_key as key,t.kind::text as kind,t.parent_key as "parentKey",v.name,v.aliases,
       v.area_id as "areaId",coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C")
         from vocab_term_refs r where r.version_id=v.id),'{}') as "definitionRefs",encode(v.content_digest,'hex') as digest
     from vocab_term_service s join vocab_term_versions v on v.id=s.version_id join vocab_terms t on t.key=s.term_key
     where s.editions @> $1::bigint order by s.term_key`,
    [head.seq],
  )
  const areas = await tx.query<{ id: string; state: AreaState }>(
    `select area_id as id,state::text as state from area_state_service
     where editions @> $1::bigint order by area_id`,
    [head.seq],
  )
  const domains = await tx.query<{ key: string; areaId: string }>(
    `select key,area_id as "areaId" from serving_source_domains($1::bigint) order by key`,
    [head.seq],
  )
  return {
    format: EDITION_EXPORT_FORMAT,
    edition: head,
    digest,
    items,
    withheld,
    vocabulary,
    areas,
    domains,
  }
}
