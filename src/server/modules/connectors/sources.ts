import type * as z from 'zod/mini'
import type { FlaggedItem, sourceListSchema, StaleLink } from '../../../contract/sources.ts'
import type { Queryable } from '../../db/database.ts'

type ListInput = z.infer<typeof sourceListSchema>

/** The owner's two source lists, read inside the request's transaction. */
export function createSourcesService(tx: Queryable) {
  return {
    /** Live items flagged by a source change, oldest flag first: the needs-check list. */
    flags({ areaId, limit = 200 }: ListInput): Promise<FlaggedItem[]> {
      return tx.query<FlaggedItem>(
        `select o.item_id as "itemId", l.title, l.area_id as "areaId", o.flag::text as flag,
           to_char(o.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as since, o.reason,
           coalesce((select jsonb_agg(jsonb_build_object('ref', r.definition_ref, 'name', d.name,
               'status', case when d.missing_since_snapshot is null then 'changed' else 'missing' end,
               'renamedTo', d.renamed_to) order by r.definition_ref)
             from item_version_refs r join definitions d on d.ref = r.definition_ref
            where r.version_id = l.version_id and case when o.flag = 'source_missing'
              then d.missing_since_snapshot is not null
              else d.missing_since_snapshot is null and d.change_mark <> r.change_mark end), '[]') as definitions
         from v_overlay_on o join v_item_list l on l.id = o.item_id
        where o.kind = 'flag_on' and l.status = 'accepted' and cl_audience_allows(l.audience_groups)
          and ($1::text is null or l.area_id = $1)
        order by o.at, o.item_id, o.flag limit $2`,
        [areaId ?? null, limit],
      )
    },

    /** Mentions in live items whose target went stale, by area and item: the stale-link list. */
    staleLinks({ areaId, limit = 200 }: ListInput): Promise<StaleLink[]> {
      return tx.query<StaleLink>(
        `select s.item_id as "itemId", s.title, s.area_id as "areaId", s.field::text as field,
           s.position, s.label as words,
           json_build_object('type', s.target_type, 'key', s.target, 'status', s.status,
             'definition', s.definition_ref, 'renamedTo', s.renamed_to,
             'replacedBy', case when cl_item_open(s.replaced_by) then s.replaced_by end) as target
         from v_stale_links s join v_item_list l on l.id = s.item_id
        where cl_audience_allows(l.audience_groups) and ($1::text is null or s.area_id = $1)
          -- A mention of an item the audience rule hides names nothing the reader may see.
          and (s.target_type <> 'item' or cl_item_open(substr(s.target, 6)))
        order by s.area_id, s.item_id, s.field, s.position limit $2`,
        [areaId ?? null, limit],
      )
    },
  }
}
export type SourcesService = ReturnType<typeof createSourcesService>
