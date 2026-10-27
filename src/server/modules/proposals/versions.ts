import type { ItemVersion } from '../../../domain/item-version.ts'
import { itemVersionDigests } from '../../../domain/item-version.ts'
import type { Queryable } from '../../db/database.ts'

export async function insertVersion(
  tx: Queryable,
  itemId: string,
  version: ItemVersion,
  previous: string | null,
  options: { recheck?: boolean; editedBy?: string } = {},
) {
  const digests = await itemVersionDigests(version)
  const [number] = await tx.query<{ n: number }>('select cl_next_item_version($1) as n', [itemId])
  const [row] = await tx.query<{ id: string }>(
    `insert into item_versions
    (item_id,version_no,supersedes_version_id,area_id,title,summary,body,summary_markup,body_markup,
     risk,claim,claim_authority,claim_quote,owner_id,proposer_id,created_via,valid_from,valid_until,
     review_date,not_to_conclude,content_digest,core_digest,is_recheck,edited_by,kind)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,decode($21,'hex'),decode($22,'hex'),$23,$24,$25) returning id`,
    [
      itemId,
      number!.n,
      previous,
      version.areaId,
      version.title,
      version.summary,
      version.body ?? null,
      version.summaryMarkup ?? null,
      version.bodyMarkup ?? null,
      version.riskLevel,
      version.claimLevel,
      version.claimAuthority ?? null,
      version.claimQuote ?? null,
      version.ownerId,
      version.proposerId,
      version.createdVia,
      version.validity.start,
      version.validity.end,
      version.reviewDate,
      version.notToConclude,
      digests.content,
      digests.core,
      options.recheck ?? false,
      options.editedBy ?? null,
      version.kind,
    ],
  )
  const id = row!.id
  for (const key of version.scope.metrics)
    await tx.query('insert into item_version_metrics values($1,$2)', [id, key])
  for (const key of version.scope.dimensions)
    await tx.query('insert into item_version_dimensions values($1,$2)', [id, key])
  for (const value of version.scope.dimensionValues)
    await tx.query('insert into item_version_dimension_values values($1,$2,$3)', [
      id,
      value.dimension,
      value.value,
    ])
  for (const [position, evidence] of version.evidence.entries())
    await tx.query(
      'insert into item_version_evidence(version_id,position,url,quote,read_on) values($1,$2,$3,$4,$5)',
      [id, position, evidence.url, evidence.quote, evidence.date],
    )
  for (const ref of version.references)
    await tx.query('insert into item_version_refs values($1,$2,$3)', [
      id,
      ref,
      version.changeMarks[ref],
    ])
  for (const target of version.replaces)
    await tx.query('insert into item_version_replaces values($1,$2)', [id, target])
  for (const target of version.conflicts)
    await tx.query('insert into item_version_conflicts(version_id,other_item_id) values($1,$2)', [
      id,
      target,
    ])
  for (const m of version.mentions)
    await tx.query(
      'insert into item_version_mentions(version_id,field,position,label,term_key,item_id,area_id) values($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        m.field,
        m.position,
        m.label,
        /^(metric|dim|val):/.test(m.target) ? m.target : null,
        m.target.startsWith('item:') ? m.target.slice(5) : null,
        m.target.startsWith('area:') ? m.target.slice(5) : null,
      ],
    )
  return { id, digest: digests.content }
}

export type StoredVersion = {
  id: string
  itemId: string
  versionNo: number
  supersedes: string | null
  isRecheck: boolean
  /** Groups are parked: a version with audience groups is not reviewable here. */
  audienceGroups: string[] | null
  digest: string
  version: ItemVersion
}

/** One stored version, under the reader's row security, in the shape it was submitted in. */
export async function readVersion(tx: Queryable, id: string): Promise<StoredVersion | null> {
  const [row] = await readVersions(tx, [id])
  return row ?? null
}

/** Stored versions under the reader's row security; a version the reader may not see is left out. */
export function readVersions(tx: Queryable, ids: readonly string[]): Promise<StoredVersion[]> {
  return tx.query<StoredVersion>(
    `select v.id::text,v.item_id as "itemId",v.version_no as "versionNo",
      v.supersedes_version_id::text as supersedes,v.is_recheck as "isRecheck",
      v.audience_groups as "audienceGroups",encode(v.content_digest,'hex') as digest,
      jsonb_build_object(
      'kind',v.kind,'areaId',v.area_id,'title',v.title,'summary',v.summary,
      'mentions',coalesce((select jsonb_agg(jsonb_build_object('field',m.field,'position',m.position,
        'target',coalesce(m.term_key,'item:'||m.item_id,'area:'||m.area_id),'label',m.label) order by m.field,m.position)
        from item_version_mentions m where m.version_id=v.id),'[]'),
      'scope',jsonb_build_object(
        'metrics',coalesce((select jsonb_agg(metric_key order by metric_key) from item_version_metrics where version_id=v.id),'[]'),
        'dimensions',coalesce((select jsonb_agg(dimension_key order by dimension_key) from item_version_dimensions where version_id=v.id),'[]'),
        'dimensionValues',coalesce((select jsonb_agg(jsonb_build_object('dimension',dimension_key,'value',value_key) order by value_key) from item_version_dimension_values where version_id=v.id),'[]')),
      'validity',jsonb_build_object('start',v.valid_from,'end',v.valid_until),'reviewDate',v.review_date,
      'evidence',coalesce((select jsonb_agg(jsonb_build_object('url',url,'quote',quote,'date',read_on) order by position) from item_version_evidence where version_id=v.id),'[]'),
      'references',coalesce((select jsonb_agg(definition_ref order by definition_ref) from item_version_refs where version_id=v.id),'[]'),
      'changeMarks',coalesce((select jsonb_object_agg(definition_ref,change_mark) from item_version_refs where version_id=v.id),'{}'),
      'claimLevel',v.claim,'riskLevel',v.risk,'audience',jsonb_build_object('kind','everyone'),
      'ownerId',v.owner_id,'proposerId',v.proposer_id,'createdVia',v.created_via,'notToConclude',v.not_to_conclude,
      'replaces',coalesce((select jsonb_agg(replaced_item_id order by replaced_item_id) from item_version_replaces where version_id=v.id),'[]'),
      'conflicts',coalesce((select jsonb_agg(other_item_id order by other_item_id) from item_version_conflicts where version_id=v.id),'[]')) ||
      jsonb_strip_nulls(jsonb_build_object('body',v.body,'summaryMarkup',v.summary_markup,'bodyMarkup',v.body_markup,
        'claimAuthority',v.claim_authority,'claimQuote',v.claim_quote)) as version
    from item_versions v where v.id=any($1::uuid[]) order by v.item_id,v.version_no`,
    [ids],
  )
}
