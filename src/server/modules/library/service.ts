import type { LibraryIndex, LibraryItem, SearchResults } from '../../../contract/index.ts'
import { SEARCH_GROUP_MAX } from '../../../contract/index.ts'
import type { ContextItem } from '../../../domain/item.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { forReader } from './audience.ts'

/**
 * The library read model: accepted and retired items as the front end shows them, from
 * `v_item_api` (one row per item, its current version). Read only.
 *
 * Audience rule (FR-128, NFR-029, `cl_audience_allows`): an item the rule hides from the reader
 * behaves as if it did not exist, and so does a mention of it in an item they may read. Groups
 * are parked in the first version, so a person reads only items for everyone.
 */
export interface LibraryService {
  getItem(id: string): Promise<ContextItem | null>
  getIndex(): Promise<LibraryIndex>
  /** One item's index row; null for one the person cannot read or that is not in the library. */
  getIndexRow(id: string): Promise<LibraryItem | null>
  /**
   * Search everywhere (the command palette): items the person may read, definitions, domains and
   * people whose names have the words, at most SEARCH_GROUP_MAX of each, best match first.
   */
  search(q: string): Promise<SearchResults>
}

/**
 * The library index's items, for everyone, in id order: one expression, so the catalogue reads
 * them in the same statement as its terms. v_item_index builds only the index's fields, not each
 * item's whole document (0057).
 */
export const libraryIndexItems = `(select coalesce(jsonb_agg(entry order by id collate "C"), '[]')
  from v_item_index where cl_audience_allows(audience_groups))`

/** Escapes LIKE wildcards, so the words are matched literally. */
const likePattern = (words: string) => `%${words.replace(/[\\%_]/g, '\\$&')}%`

export function createLibraryService(database: Queryable, clock: Clock): LibraryService {
  /**
   * The library index's rows, or one item's (`id`): each row is the item's index entry with what
   * the list's columns read from it.
   */
  async function indexRows(id: string | null): Promise<LibraryItem[]> {
    const today = clock.today()
    // Each row is the item's index entry with what the list's columns read from it: the last
    // acceptance of its version (a recheck is one; the rule of cl_version_review), its trust
    // today by the rule of itemTrust in src/domain/status.ts, and its scope by name. Each is read
    // in one pass over its table, joined by version.
    const [row] = await database.query<{ items: LibraryItem[] }>(
      `with listed as materialized (
         select i.id, i.entry, v.id as version_id
           from v_item_index i
           join item_versions v on v.item_id = i.id and v.version_no = (i.entry->>'version')::int
          where cl_audience_allows(i.audience_groups) and ($2::text is null or i.id = $2)),
       checked as (
         select distinct on (d.item_version_id) d.item_version_id as version_id,
                (d.decided_at at time zone 'UTC')::date as day, d.decided_by
           from decisions d join listed on listed.version_id = d.item_version_id
          where d.outcome = 'accept' and d.capacity <> 'approver'
          order by d.item_version_id, d.decided_at desc, d.id desc),
       names as materialized (
         select t.key, t.name from serving_vocabulary((select seq from live_edition)) t),
       keys as (
         select 1 as part, m.version_id, m.metric_key as key, substr(m.metric_key, 8) as id
           from item_version_metrics m join listed using (version_id)
         union all
         select 2, d.version_id, d.dimension_key, substr(d.dimension_key, 5)
           from item_version_dimensions d join listed using (version_id)
         union all
         select 3, d.version_id, d.value_key, split_part(d.value_key, '/', 2)
           from item_version_dimension_values d join listed using (version_id)),
       chips as (
         select k.version_id,
                jsonb_agg(coalesce(n.name, k.id) order by k.part, k.key collate "C") as names
           from keys k left join names n on n.key = k.key
          group by k.version_id)
       select coalesce(jsonb_agg(l.entry || jsonb_build_object(
                'lastChecked', case when c.version_id is null then null else jsonb_build_object(
                  'on', to_char(c.day, 'YYYY-MM-DD'), 'personId', c.decided_by::text) end,
                'trust', case when l.entry->>'status' = 'retired'
                                or (l.entry->'validity'->>'end')::date <= $1::date then 'ended'
                              when l.entry->>'checkFlag' is not null
                                or (l.entry->>'reviewDate')::date < $1::date then 'needs_check'
                              else 'current' end,
                'chips', coalesce(ch.names, '[]'),
                'owners', coalesce(o.ids, '[]'),
                'opened', exists (select 1 from item_reads r
                                   where r.person_id = cl_person() and r.item_id = l.id))
                order by l.id collate "C"), '[]') as items
         from listed l
         left join checked c on c.version_id = l.version_id
         left join chips ch on ch.version_id = l.version_id
         left join (select item_id, jsonb_agg(person_id::text order by person_id) as ids
                      from item_owners group by item_id) o on o.item_id = l.id`,
      [today, id],
    )
    return row?.items ?? []
  }

  return {
    async getItem(id) {
      const [row] = await database.query<{ doc: ContextItem }>(
        'select doc from v_item_api where id = $1 and cl_audience_allows(audience_groups)',
        [id],
      )
      return row ? ((await forReader(database, [row.doc]))[0] ?? null) : null
    },

    async getIndex() {
      return {
        items: await indexRows(null),
        loadedAt: clock.now().toISOString(),
        today: clock.today(),
      }
    },
    async getIndexRow(id) {
      return (await indexRows(id))[0] ?? null
    },

    async search(q) {
      const words = q.trim()
      if (!words) return { items: [], definitions: [], domains: [], people: [] }
      // An item matches on its words (the title, summary and body search vector) or on part of a
      // word in its title or summary, as people type; the rest match on part of a name. A name
      // that starts with the words comes first in each group.
      const [row] = await database.query<SearchResults>(
        `with q as (select $1::text as anywhere, $2::text as start,
                           websearch_to_tsquery('simple', $3) as words),
         items as (
           select a.id, a.kind::text as kind, a.area_id as "areaId", a.status::text as status,
                  a.title, a.summary, a.title ilike q.start as starts, ts_rank(v.search, q.words) as rank
             from v_item_list a join item_versions v on v.id = a.version_id cross join q
            where cl_audience_allows(a.audience_groups)
              and (v.search @@ q.words or a.title ilike q.anywhere or a.summary ilike q.anywhere)
            order by starts desc, rank desc, a.title collate "en-x-icu", a.id collate "C"
            limit $4),
         definitions as (
           select t.key, case t.kind when 'metric' then 'metric' else 'dimension' end as kind,
                  t.name, coalesce(t.aliases, '{}') as aliases, t.name ilike q.start as starts
             from serving_vocabulary((select seq from live_edition)) t cross join q
            where t.kind in ('metric', 'dimension')
              and (t.name ilike q.anywhere or exists (select 1 from unnest(t.aliases) x where x ilike q.anywhere))
            order by starts desc, t.name collate "en-x-icu", t.key collate "C"
            limit $4),
         domains as (
           select a.id, a.name, a.name ilike q.start as starts
             from areas a cross join q
            where a.archived_at is null and a.name ilike q.anywhere
            order by starts desc, a.name collate "en-x-icu", a.id collate "C"
            limit $4),
         people as (
           select p.id::text as id, p.display_name as name, p.display_name ilike q.start as starts
             from people p cross join q
            where p.deactivated_at is null and p.erased_at is null and p.display_name ilike q.anywhere
            order by starts desc, p.display_name collate "en-x-icu", p.id
            limit $4)
         select
           (select coalesce(json_agg(json_build_object('id', i.id, 'kind', i.kind, 'areaId', i."areaId",
                     'status', i.status, 'title', i.title, 'summary', i.summary)
                     order by i.starts desc, i.rank desc, i.title collate "en-x-icu", i.id collate "C"), '[]')
              from items i) as items,
           (select coalesce(json_agg(json_build_object('key', d.key, 'kind', d.kind, 'name', d.name,
                     'aliases', d.aliases) order by d.starts desc, d.name collate "en-x-icu", d.key collate "C"), '[]')
              from definitions d) as definitions,
           (select coalesce(json_agg(json_build_object('id', d.id, 'name', d.name)
                     order by d.starts desc, d.name collate "en-x-icu", d.id collate "C"), '[]')
              from domains d) as domains,
           (select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name)
                     order by p.starts desc, p.name collate "en-x-icu", p.id), '[]')
              from people p) as people`,
        [likePattern(words), `${likePattern(words).slice(1)}`, words, SEARCH_GROUP_MAX],
      )
      return row ?? { items: [], definitions: [], domains: [], people: [] }
    },
  }
}
