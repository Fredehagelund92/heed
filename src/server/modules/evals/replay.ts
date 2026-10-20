import { canonicalJson } from '../../../domain/canonical.ts'
import { resolve } from '../../../domain/resolver.ts'
import type { ResolvedScope } from '../../../domain/scope.ts'
import { noGroups } from '../../../domain/item.ts'
import type { Queryable } from '../../db/database.ts'
import type { ServingBundle } from '../editions/index.ts'

/**
 * Replay (FR-512, the topic half of FR-511): the stored agent deliveries are resolved again
 * against the live edition and against the candidate, without a model, and the ones whose items,
 * order or labels would change are counted by topic. Evals, previews and replays never count as
 * demand, so only `caller = 'agent'` rows are read. Topics under the small-count threshold are
 * folded into one "other" count, like every other count shown to people.
 */

export type ReplayReport = {
  deliveries: number
  changed: number
  topics: { topic: string; area: string | null; changed: number }[]
  otherChanged: number
}

type Row = { id: string; hour: string; topic: string | null; scope: StoredScope | null }
type StoredScope = ResolvedScope & { today: string; max_items?: number }

function delivered(bundle: ServingBundle, scope: StoredScope): string {
  const resolution = resolve(bundle, {
    scope: {
      status: 'resolved',
      scope: { metrics: scope.metrics, filters: scope.filters, window: scope.window },
    },
    today: scope.today,
    groups: noGroups,
    hiddenMetrics: [],
    sizeLimit: Number.MAX_SAFE_INTEGER,
    dependenciesAvailable: true,
  })
  return canonicalJson(
    resolution.items
      .slice(0, scope.max_items ?? 20)
      .map((m) => [m.id, m.version, m.unverified ? 'unverified' : 'verified']),
  )
}

export async function replayDeliveries(
  tx: Queryable,
  live: ServingBundle,
  candidate: ServingBundle,
  days = 30,
): Promise<ReplayReport> {
  const memo = new Map<string, boolean>()
  const byTopic = new Map<string, number>()
  let deliveries = 0,
    changed = 0
  let after: { hour: string; id: string } | null = null
  for (;;) {
    const rows: Row[] = await tx.query<Row>(
      `select id::text,delivered_hour::text as hour,topic_id::text as topic,scope from deliveries
        where caller='agent' and scope is not null and delivered_hour >= now() - make_interval(days => $1)
          and ($2::timestamptz is null or (delivered_hour,id) > ($2::timestamptz,$3::uuid))
        order by delivered_hour,id limit 5000`,
      [days, after?.hour ?? null, after?.id ?? null],
    )
    for (const row of rows) {
      deliveries++
      if (!row.scope?.window) continue
      const key = canonicalJson(row.scope)
      let differs = memo.get(key)
      if (differs === undefined) {
        differs = delivered(live, row.scope) !== delivered(candidate, row.scope)
        memo.set(key, differs)
      }
      if (!differs) continue
      changed++
      if (row.topic) byTopic.set(row.topic, (byTopic.get(row.topic) ?? 0) + 1)
    }
    if (rows.length < 5000) break
    after = { hour: rows.at(-1)!.hour, id: rows.at(-1)!.id }
  }
  const [setting] = await tx.query<{ n: number }>(
    "select (value #>> '{}')::int as n from settings_current where key='privacy.min_count'",
  )
  const min = setting?.n ?? 5
  const shown = [...byTopic].filter(([, n]) => n >= min)
  const areas = shown.length
    ? await tx.query<{ id: string; area: string | null }>(
        'select id::text,area_id as area from topics where id=any($1::uuid[])',
        [shown.map(([topic]) => topic)],
      )
    : []
  return {
    deliveries,
    changed,
    topics: shown
      .map(([topic, n]) => ({
        topic,
        area: areas.find((a) => a.id === topic)?.area ?? null,
        changed: n,
      }))
      .sort((a, b) => b.changed - a.changed || (a.topic < b.topic ? -1 : 1)),
    otherChanged: changed - shown.reduce((sum, [, n]) => sum + n, 0),
  }
}
