import type {
  Catalogue,
  IndexedItem,
  CatalogueDefinition,
  CatalogueSource,
  CatalogueTerm,
} from '../../../contract/index.ts'
import {
  catalogueStatus,
  definitionState,
  scopeNames,
  shelfOf,
  speakingDefinition,
  termDomain,
} from '../../../domain/catalogue.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { connectorType } from '../connectors/index.ts'
import { libraryIndexItems } from '../library/index.ts'

const withoutRemoved = <T extends { removed: boolean }>({ removed: _removed, ...source }: T) =>
  source

/**
 * The catalogue read model (FR-136): the live vocabulary's metrics and dimensions, joined to what
 * the definition source last read (the `definitions` the connectors store) and to what the
 * library holds about each term. Read only. Heed stores no calculation (CON-207), so nothing
 * here can return one.
 *
 * It reads as the library does: items for everyone only, while groups are parked (FR-128). A
 * definition the source limits to groups is shown only to a person in one of them (CON-509);
 * nobody has groups yet, so such a term is left out for everyone until groups return.
 */
export interface CatalogueService {
  list(): Promise<Catalogue>
}

type VocabularyRow = {
  key: string
  kind: 'metric' | 'dimension' | 'dimension_value' | 'metric_group'
  parentKey: string | null
  name: string
  aliases: string[]
  areaId: string | null
  /** The domain the definition source gave the term, as the live edition carries it. */
  sourceAreaId: string | null
  definitionRefs: string[]
}

type DefinitionRow = Omit<CatalogueDefinition, 'state'> & {
  visible: boolean
  missing: boolean
  changedSinceFirstRead: boolean
  itemsWithOlderMark: number
}

const iso = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en')

export function createCatalogueService(
  database: Queryable,
  clock: Clock,
  /** The person's groups. Groups are parked (FR-128), so nobody has any yet. */
  groups: readonly string[] = [],
): CatalogueService {
  /**
   * Everything the catalogue is built from, in one statement: the live vocabulary, what the
   * definition source last read about its terms, the sources, how many items mention each term,
   * the open gaps and the library index. A busy server pays for every round trip, and the
   * catalogue is read again after every edition.
   */
  async function read() {
    const [row] = await database.query<{
      vocabulary: VocabularyRow[]
      definitions: DefinitionRow[]
      sources: (Omit<CatalogueSource, 'tool'> & { type: string; removed: boolean })[]
      mentions: { key: string; items: number }[]
      gaps: string[][]
      items: IndexedItem[]
    }>(
      `with vocabulary as materialized (
         select t.key, t.kind::text as kind, t.parent_key as "parentKey", t.name, t.aliases,
                t.area_id as "areaId", d.area_id as "sourceAreaId", t.definition_refs as "definitionRefs"
           from serving_vocabulary((select seq from live_edition)) t
           left join serving_source_domains((select seq from live_edition)) d on d.key = t.key),
       -- Accepted items that recorded another mark than the definition has now, counted in one
       -- pass over the library: a correlated count would read the item view once per term. The
       -- terms are chosen below, not here: matching the refs here makes PostgreSQL probe the refs
       -- index once per term for every item, seconds at 10,000 items.
       older as materialized (
         select r.definition_ref as ref, count(*)::int as items
           from v_item_list l join item_version_refs r on r.version_id = l.version_id
           join definitions d on d.ref = r.definition_ref
          where l.status = 'accepted' and cl_audience_allows(l.audience_groups)
            and r.change_mark <> d.change_mark
          group by r.definition_ref),
       described as (
         select d.ref, d.connector_id as "sourceId", d.name, d.title,
                d.description_copy as "descriptionCopy", d.value_type as "valueType",
                d.renamed_to as "renamedTo",
                (d.visible_groups is null or d.visible_groups && $1::text[]) as visible,
                d.missing_since_snapshot is not null as missing,
                ${iso('seen.fetched_at')} as "readAt",
                ${iso('changed.at')} as "changedAt",
                changed.at is not null as "changedSinceFirstRead",
                coalesce(older.items, 0) as "itemsWithOlderMark"
           from definitions d
           left join older on older.ref = d.ref
           left join connector_snapshots seen on seen.id = d.last_seen_snapshot
           left join lateral (
             select max(s.fetched_at) as at from definition_marks m
               join connector_snapshots s on s.id = m.snapshot_id
              where m.definition_ref = d.ref and m.snapshot_id is distinct from d.first_seen_snapshot) changed on true
          where d.ref in (select unnest(v."definitionRefs") from vocabulary v)),
       sources as (
         select c.id, c.name, c.type, ${iso('ok.fetched_at')} as "readAt", ok.source_version as "sourceVersion",
                coalesce(latest.status = 'failed', false) as failing,
                c.removed_at is not null as removed
           from connectors c
           left join lateral (select s.fetched_at, s.source_version from connector_snapshots s
                               where s.connector_id = c.id and s.status <> 'failed'
                               order by s.fetched_at desc limit 1) ok on true
           left join lateral (select s.status from connector_snapshots s where s.connector_id = c.id
                               order by s.fetched_at desc limit 1) latest on true
          where c.kind = 'definition_source'),
       -- Counted as the item list counts mentions: current versions, accepted or retired.
       mentions as (
         select m.term_key as key, count(distinct l.id)::int as items
           from item_version_mentions m join v_item_list l on l.version_id = m.version_id
          where m.term_key is not null and cl_audience_allows(l.audience_groups)
          group by m.term_key)
       select
         (select coalesce(json_agg(v), '[]') from vocabulary v) as vocabulary,
         (select coalesce(json_agg(d), '[]') from described d) as definitions,
         (select coalesce(json_agg(s order by s.id collate "C"), '[]') from sources s) as sources,
         (select coalesce(json_agg(m), '[]') from mentions m) as mentions,
         (select coalesce(json_agg(t.metric_keys || t.value_keys || t.dimension_keys), '[]')
            from gaps g join topics t on t.id = g.topic_id
           where g.status in ('open', 'proposal_made')) as gaps,
         ${libraryIndexItems} as items`,
      [groups],
    )
    const { vocabulary, definitions, mentions, items } = row!
    // The words on screen name the tool the source reads (CON-101: core names no vendor).
    const sources: (CatalogueSource & { removed: boolean })[] = row!.sources.map(
      ({ type, removed, ...source }) => ({
        ...source,
        removed,
        tool: connectorType(type, source.name).tool,
      }),
    )
    const gaps = row!.gaps.map((keys) => ({ keys }))
    return { vocabulary, definitions, sources, mentions, gaps, items }
  }

  function build(data: Awaited<ReturnType<typeof read>>) {
    const today = clock.today()
    const definitions = new Map(data.definitions.map((row) => [row.ref, row]))
    const groupNames = new Map(
      data.vocabulary.filter((t) => t.kind === 'metric_group').map((t) => [t.key, t.name]),
    )
    const mentionedBy = new Map(data.mentions.map((row) => [row.key, row.items]))
    // A gap counts once for a term, even when its topic names several of the term's values. A
    // dimension is named by itself or by any of its values.
    const gapsNaming = (key: string) =>
      data.gaps.filter(({ keys }) =>
        keys.some((topicKey) =>
          key.startsWith('dim:')
            ? topicKey === key || topicKey.startsWith(`val:${key.slice(4)}/`)
            : topicKey === key,
        ),
      ).length
    const items = data.items

    const toolOf = (sourceId: string) =>
      data.sources.find((source) => source.id === sourceId)?.tool ?? sourceId

    function term(row: VocabularyRow): CatalogueTerm | null {
      const stored = row.definitionRefs.flatMap((ref) => definitions.get(ref) ?? [])
      if (stored.some((definition) => !definition.visible)) return null
      const listed: CatalogueDefinition[] = stored.map((definition) => ({
        ref: definition.ref,
        name: definition.name,
        title: definition.title,
        descriptionCopy: definition.descriptionCopy,
        valueType: definition.valueType,
        state: definitionState(definition),
        renamedTo: definition.renamedTo,
        changedAt: definition.changedAt,
        readAt: definition.readAt,
        sourceId: definition.sourceId,
        tool: toolOf(definition.sourceId),
      }))
      const definition = speakingDefinition(listed)
      const shelf = shelfOf(items, scopeNames(row.key), today)
      const kind = row.kind === 'metric' ? 'metric' : 'dimension'
      return {
        key: row.key,
        kind,
        id: row.key.slice(row.key.indexOf(':') + 1),
        name: row.name,
        aliases: row.aliases,
        group:
          row.parentKey && groupNames.has(row.parentKey)
            ? { key: row.parentKey, name: groupNames.get(row.parentKey)! }
            : null,
        // The live edition's map, the one serving and gap topics read.
        domain: termDomain(row.areaId, row.sourceAreaId),
        definition,
        definitions: listed,
        status: catalogueStatus(definition, shelf),
        shelf: {
          ...shelf,
          gaps: gapsNaming(row.key),
          mentionedBy: mentionedBy.get(row.key) ?? 0,
        },
      }
    }

    const terms = (kind: VocabularyRow['kind']) =>
      data.vocabulary
        .filter((row) => row.kind === kind)
        .sort(byName)
        .flatMap((row) => term(row) ?? [])

    return { today, terms }
  }

  return {
    async list() {
      const data = await read()
      const { today, terms } = build(data)
      const metrics = terms('metric')
      return {
        terms: [...metrics, ...terms('dimension')],
        sources: data.sources.filter((source) => !source.removed).map(withoutRemoved),
        coverage: {
          metrics: metrics.length,
          withoutDomain: metrics.filter((metric) => metric.domain.areaId === null).length,
        },
        today,
      }
    },
  }
}
