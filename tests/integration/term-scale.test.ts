import { beforeAll, expect, it } from 'vitest'
import { readConnectors } from '../../src/server/modules/jobs/operations.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  A model of 2,000 members, as a pilot with a large Cube model has them (the scale lab of 15 Oct
  2026): 40 views of 40 metrics and 10 dimensions, every view mapped to its domain by the server's
  list, so its read warns once per member. The Sources overview reads where each member's domain
  comes from without looking each one up in the warnings, which had taken tens of seconds.
*/

const VIEWS = 40
const METRICS = 40
const DIMENSIONS = 10
/** Generous for a busy computer; before the change each step took many times this. */
const BUDGET_MS = 15_000

const { client, url } = testDatabase()
const database = apiDatabase(url)
const timed = async <T>(step: () => Promise<T>) => {
  const started = performance.now()
  const result = await step()
  return { result, ms: performance.now() - started }
}
beforeAll(async () => {
  await foundation(client)
  const views = Array.from({ length: VIEWS }, (_, v) => `view${v}`)
  await client.query(
    `insert into areas (id,name) select 'domain_' || v, 'Domain ' || v from generate_series(0,$1) v`,
    [VIEWS - 1],
  )
  // One read that saw every member, with one domain_override warning each, as the pilot's are.
  const members = views.flatMap((view, v) => [
    ...Array.from({ length: METRICS }, (_, m) => ({
      ref: `cube:${view}.metric_${m}`,
      kind: 'metric',
      name: `${view}.metric_${m}`,
      // Every view has a Clicks: the first is proposed plain, the rest take their view's name.
      title: m === 0 ? 'Clicks' : `Metric ${v} ${m}`,
      area: `domain_${v}`,
    })),
    ...Array.from({ length: DIMENSIONS }, (_, d) => ({
      ref: `cube:${view}.dim_${v}_${d}`,
      kind: 'dimension',
      name: `${view}.dim_${v}_${d}`,
      title: `Dimension ${v} ${d}`,
      area: `domain_${v}`,
    })),
  ])
  expect(members).toHaveLength(2_000)
  const [snapshot] = (
    await client.query<{ id: string }>(
      `insert into connector_snapshots (connector_id,status,definitions_seen,warnings)
       values ('demo','ok',$1,$2) returning id::text`,
      [
        members.length,
        JSON.stringify(members.map((m) => ({ code: 'domain_override', target: m.ref }))),
      ],
    )
  ).rows as [{ id: string }]
  await client.query(
    `insert into definitions (ref,connector_id,kind,name,title,change_mark,area_hint,last_seen_snapshot)
     select m->>'ref','demo',(m->>'kind')::definition_kind,m->>'name',m->>'title','1',m->>'area',$2
       from jsonb_array_elements($1::jsonb) m`,
    [JSON.stringify(members), snapshot.id],
  )
})

it('reads where 2,000 members take their domain from without one lookup each', async () => {
  const { result, ms } = await timed(() => readConnectors(database))
  const demo = result.find((connector) => connector.id === 'demo')!
  expect(demo.domainCoverage).toMatchObject({ override: VIEWS * METRICS, cube: 0 })
  expect(ms).toBeLessThan(BUDGET_MS)
}, 60_000)
