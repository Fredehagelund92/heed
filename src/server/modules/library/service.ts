import type {
  HistoryEntry,
  ItemLinks,
  ItemSort,
  ItemsPage,
  LibraryFreshness,
  LibraryIndex,
  LibraryItem,
  ListItemsParams,
} from '../../../contract/index.ts'
import { INCOMING_LINKS_MAX } from '../../../contract/index.ts'
import type { ItemReview } from '../../../contract/review.ts'
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
  listItems(params: ListItemsParams): Promise<ItemsPage>
  getItem(id: string): Promise<ContextItem | null>
  getIndex(): Promise<LibraryIndex>
  /** How much of the library was current today and on the same weekday of the weeks before. */
  getFreshness(weeks?: number): Promise<LibraryFreshness>
  /** Newest first; null for an item the person cannot read, or in the Bin unless they open it. */
  getHistory(id: string): Promise<HistoryEntry[] | null>
  getLinks(id: string): Promise<ItemLinks | null>
  /**
   * How the live edition's version of each item was reviewed (FR-326): who accepted it, when, in
   * which edition, and the checks it passed, for the review stamp behind sign-in. Items the
   * person may not read, and items the live edition does not serve, are left out.
   */
  getReviews(ids: readonly string[]): Promise<ItemReview[]>
}

const DEFAULT_LIMIT = 50

/**
 * The library index's items, for everyone, in id order: one expression, so the catalogue reads
 * them in the same statement as its terms. v_item_index builds only the index's fields, not each
 * item's whole document (0057).
 */
export const libraryIndexItems = `(select coalesce(jsonb_agg(entry order by id collate "C"), '[]')
  from v_item_index where cl_audience_allows(audience_groups))`

// Ids order by code point, as the contract and the mock do. Titles use ICU English collation,
// which matches the browser's `localeCompare(…, 'en')`.
const orderBy: Record<ItemSort, string> = {
  updated: 'a.updated_at desc, a.id collate "C"',
  title: 'a.title collate "en-x-icu", a.id collate "C"',
  start: 'a.valid_from desc, a.id collate "C"',
}

/** The column of `item_version_mentions` that holds a target, by its prefix. */
function mentionColumn(target: string): { column: string; value: string } {
  const [prefix = '', rest = ''] = target.split(/:(.*)/s)
  if (prefix === 'item') return { column: 'item_id', value: rest }
  if (prefix === 'area') return { column: 'area_id', value: rest }
  return { column: 'term_key', value: target }
}

/** Escapes LIKE wildcards, so the words are matched literally. */
const likePattern = (words: string) => `%${words.replace(/[\\%_]/g, '\\$&')}%`

export function createLibraryService(database: Queryable, clock: Clock): LibraryService {
  const readable = async (id: string) =>
    (
      await database.query(
        'select 1 from v_item_list where id = $1 and cl_audience_allows(audience_groups)',
        [id],
      )
    ).length > 0

  const inBinForAdministrator = async (id: string) =>
    (
      await database.query(
        `select 1 from item_bin b where b.item_id = $1 and b.restored_at is null and cl_is_admin_now()`,
        [id],
      )
    ).length > 0

  return {
    async listItems({
      q,
      areaId,
      kind,
      mentions,
      sort = 'updated',
      limit = DEFAULT_LIMIT,
      offset = 0,
    }) {
      const values: unknown[] = []
      const where = ['cl_audience_allows(a.audience_groups)']
      const add = (value: unknown) => `$${values.push(value)}`
      if (areaId !== undefined) where.push(`a.area_id = ${add(areaId)}`)
      if (kind !== undefined) where.push(`a.kind = ${add(kind)}::item_kind`)
      const words = q?.trim()
      if (words) {
        const pattern = add(likePattern(words))
        where.push(`(a.title ilike ${pattern} or a.summary ilike ${pattern})`)
      }
      if (mentions !== undefined) {
        const { column, value } = mentionColumn(mentions)
        const target = add(value)
        // Which items mention a hidden item would tell that it exists: nothing does.
        if (column === 'item_id') where.push(`cl_item_open(${target})`)
        where.push(
          `exists (select 1 from item_version_mentions m where m.version_id = a.version_id and m.${column} = ${target})`,
        )
      }
      // Filter and order on plain columns; build the JSON documents for the page's rows only.
      const [row] = await database.query<{ total: number; rows: ContextItem[] }>(
        `with matches as materialized (
           select a.id, a.updated_at, a.title, a.valid_from from v_item_api a
            where ${where.join(' and ')}),
         page as (
           select a.id, row_number() over (order by ${orderBy[sort]}) as n from matches a
            order by ${orderBy[sort]} limit ${add(limit)} offset ${add(offset)})
         select (select count(*)::int from matches) as total,
                coalesce((select jsonb_agg(d.doc order by page.n)
                            from page join v_item_api d on d.id = page.id), '[]') as rows`,
        values,
      )
      return {
        rows: await forReader(database, row?.rows ?? []),
        total: row?.total ?? 0,
        limit,
        offset,
      }
    },

    async getItem(id) {
      const [row] = await database.query<{ doc: ContextItem }>(
        'select doc from v_item_api where id = $1 and cl_audience_allows(audience_groups)',
        [id],
      )
      return row ? ((await forReader(database, [row.doc]))[0] ?? null) : null
    },

    async getIndex() {
      const [row] = await database.query<{ items: LibraryItem[] }>(
        `select ${libraryIndexItems} as items`,
      )
      return { items: row?.items ?? [], loadedAt: clock.now().toISOString(), today: clock.today() }
    },

    /**
     * Home's freshness, counted back a week at a time: each day as it stood at its end. Today is
     * the index's own rule (the live edition, the flags on now), so its count is the index's;
     * an earlier day reads the edition sealed by its end and the source flags on by then, as the
     * area dashboard reads items past review (quality upkeep). For everyone, as the index.
     */
    async getFreshness(weeks = 8) {
      const today = clock.today()
      const days = await database.query<LibraryFreshness['days'][number]>(
        `with d as (select $1::date - 7 * k as day from generate_series($2::int - 1, 0, -1) k),
         e as (select d.day,
                      case when d.day = $1::date then (select seq from live_edition)
                           else (select max(seq) from editions
                                  where sealed_at < (d.day + 1)::timestamp at time zone 'UTC') end as seq,
                      case when d.day = $1::date then 'infinity'::timestamptz
                           else (d.day + 1)::timestamp at time zone 'UTC' end as until
                 from d),
         a as (select e.day, v.review_date,
                      -- The newest event per flag by the day's end decides, as v_overlay_active.
                      exists (select 1 from (select distinct on (o.flag) o.kind from overlay_events o
                                              where o.item_id = s.item_id and o.flag is not null and o.at < e.until
                                              order by o.flag, o.seq desc) f
                               where f.kind = 'flag_on') as flagged
                 from e
                 join item_version_service s on s.editions @> e.seq
                 join item_versions v on v.id = s.version_id
                where cl_audience_allows(v.audience_groups) and (v.valid_until is null or v.valid_until > e.day))
         select d.day::text as day, count(a.day)::int as applying,
                (count(a.day) filter (where not a.flagged
                                        and (a.review_date is null or a.review_date >= d.day)))::int as current
           from d left join a on a.day = d.day
          group by d.day order by d.day`,
        [today, weeks],
      )
      return { today, days }
    },

    async getHistory(id) {
      // An item in the Bin has its history read by whoever may open the Bin: an administrator.
      if (!(await readable(id)) && !(await inBinForAdministrator(id))) return null
      // Versions that were in service, when each was proposed and accepted, and when the item
      // was retired. Bulk demo data has no decisions, so the person who accepted or retired falls
      // back to who published the edition, then to the version's owner.
      const rows = await database.query<Omit<HistoryEntry, 'domain'> & { domain: string | null }>(
        `with served as (
           select v.id, v.version_no, v.created_at, v.proposer_id, v.owner_id,
                  min(lower(s.editions)) as first_seq, max(upper(s.editions)) as closed_seq,
                  bool_or(upper_inf(s.editions)) as open
             from item_versions v join item_version_service s on s.version_id = v.id
            where v.item_id = $1
            group by v.id),
         latest as (select * from served order by version_no desc limit 1),
         events as (
           select version_no, 1 as rank, created_at as at, proposer_id as person, null::text as domain from served
           union all
           select s.version_no, 2, e.created_at,
                  coalesce((select d.decided_by from decisions d
                             where d.item_version_id = s.id and d.outcome = 'accept'
                             order by d.decided_at limit 1), e.actor_id, s.owner_id), null
             from served s join editions e on e.seq = s.first_seq
           union all
           select l.version_no, 3, e.created_at,
                  coalesce((select d.decided_by from decisions d
                             where d.item_version_id = l.id and d.outcome = 'retire'
                             order by d.decided_at desc limit 1), e.actor_id, l.owner_id), null
             from latest l join editions e on e.seq = l.closed_seq
            where not l.open and not exists (
              select 1 from item_version_service s
               where s.item_id = $1 and s.editions @> (select seq from live_edition))
           -- The Bin (0067): a stay in it shows as moved and restored, not as a retirement.
              and not exists (select 1 from item_bin b where b.item_id = $1 and b.binned_edition = l.closed_seq)
           union all
           select v.version_no, 4, b.binned_at, b.binned_by, null
             from item_bin b join item_versions v on v.id = b.version_id where b.item_id = $1
           union all
           -- Restored into another domain (0079): that domain's name.
           select v.version_no, 5, b.restored_at, b.restored_by, a.name
             from item_bin b join item_versions v on v.id = b.version_id
             left join areas a on a.id = b.restored_area
            where b.item_id = $1 and b.restored_at is not null)
         select version_no as version,
                (array['proposed', 'accepted', 'retired', 'binned', 'restored'])[rank] as event,
                to_char(at at time zone 'UTC', 'YYYY-MM-DD') as date,
                person::text as "personId",
                domain
           from events where person is not null
          order by version_no desc, case when rank >= 3 then at end desc nulls last, rank desc`,
        [id],
      )
      return rows.map(({ domain, ...entry }) => (domain ? { ...entry, domain } : entry))
    },

    async getReviews(ids) {
      // One rule for who accepted a version (cl_version_review), the same the serving path
      // reads; the passed check levels in the order checks run.
      return database.query<ItemReview>(
        `select s.item_id as id, v.version_no as version,
                to_char(r.accepted_on, 'YYYY-MM-DD') as "acceptedOn", r.accepted_as::text as "acceptedAs",
                coalesce(r.accepted_area, v.area_id) as "areaId", r.accepted_by::text as "personId",
                r.first_edition as edition,
                coalesce((select array_agg(l.level::text order by l.level)
                            from (select distinct c.level from check_results c
                                   where c.item_version_id = v.id and c.outcome = 'passed') l), '{}') as checks
           from item_version_service s
           join item_versions v on v.id = s.version_id
           cross join lateral cl_version_review(s.version_id) r
          where s.editions @> (select seq from live_edition) and s.item_id = any($1::text[])
            and cl_audience_allows(v.audience_groups) and r.accepted_on is not null and r.first_edition is not null
          order by s.item_id collate "C"`,
        [ids],
      )
    },

    async getLinks(id) {
      if (!(await readable(id))) return null
      const [row] = await database.query<ItemLinks>(
        `with item as (select version_id from v_item_list where id = $1),
         outgoing as (
           select m.field, m.position, m.label as words,
                  coalesce(m.term_key, 'item:' || m.item_id, 'area:' || m.area_id) as key,
                  case when m.item_id is not null then 'item'
                       when m.area_id is not null then 'area'
                       else t.kind::text end as type,
                  coalesce(tv.name, target.title, ar.name, m.label) as name,
                  case when target.status = 'retired' then 'retired'
                       when ms.status in ('source_missing', 'source_changed') then ms.status
                       else 'current' end as status
             from item join item_version_mentions m on m.version_id = item.version_id
             join v_mention_status ms on ms.version_id = m.version_id and ms.field = m.field
              and ms.position = m.position
             left join vocab_terms t on t.key = m.term_key
             left join lateral (
               select v.name from vocab_term_service s join vocab_term_versions v on v.id = s.version_id
                where s.term_key = m.term_key and s.editions @> (select seq from live_edition)) tv on true
             left join v_item_list target on target.id = m.item_id
             left join areas ar on ar.id = m.area_id
            where m.item_id is null or (target.id is not null and cl_audience_allows(target.audience_groups))),
         incoming as (
           select distinct on (source.id) source.id, source.kind, source.title, source.status,
                  source.updated_at, m.field, m.position, m.label as words
             from item_version_mentions m join v_item_list source on source.version_id = m.version_id
            where m.item_id = $1 and source.id <> $1 and cl_audience_allows(source.audience_groups)
            order by source.id, m.field, m.position)
         select coalesce((select jsonb_agg(jsonb_build_object(
                    'field', field, 'position', position, 'words', words,
                    'target', jsonb_build_object('type', type, 'key', key, 'name', name, 'status', status))
                    order by field, position) from outgoing), '[]') as mentions,
                jsonb_build_object(
                  'total', (select count(*) from incoming),
                  'rows', coalesce((select jsonb_agg(jsonb_build_object(
                      'field', field, 'position', position, 'words', words,
                      'source', jsonb_build_object('id', id, 'kind', kind, 'title', title, 'status', status))
                      order by updated_at desc, id collate "C")
                    from (select * from incoming order by updated_at desc, id collate "C"
                          limit ${INCOMING_LINKS_MAX}) page), '[]')) as "mentionedBy"`,
        [id],
      )
      return row ?? null
    },
  }
}
