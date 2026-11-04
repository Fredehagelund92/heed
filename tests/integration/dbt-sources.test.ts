import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { SourceCheck, SourceSettings } from '../../src/contract/sources.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import {
  latestManifest,
  legacyManifest,
  withChangedRevenue,
  withMissingInput,
} from '../server/connectors/dbt-metricflow-fixture.ts'
import { gitHost, type GitHost } from '../server/connectors/git-server.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  dbt MetricFlow end to end on the real service and PostgreSQL 18, with a Git host on this machine
  that wants a token: an admin tests a semantic manifest in a repository and adds it, a read through
  the definitions pipeline stores its definitions, and a change in the file reaches the items that
  rely on it. Moving a project to dbt's latest YAML spec flags nothing, a broken file changes
  nothing, and a read never publishes (I-2).
*/

const TOKEN = 'dbt-it-token-7c41e2a9'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-dbt-secrets-'))
const store = await openLocalSecretStore(join(secretsDir, 'store'))
const registry = new ConnectorRegistry([], { secrets: store })
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  workspaceSources: createWorkspaceSources({ secrets: store, registry }),
  logger,
  clock,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
let host: GitHost
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}

const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(
  response: Promise<{ statusCode: number; body: string; json: <U>() => U }>,
  status = 200,
) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(status)
  return r.json<T>()
}

/** One run of the sources' job, with the source made due. */
async function read(id: string) {
  await client.query('update connectors set next_read_at = null where id = $1', [id])
  const result = (await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })) as { connectors: Record<string, Record<string, unknown>> }
  return result.connectors[id]
}

const published = async () =>
  (
    await client.query(
      `select (select max(seq) from editions)::text as editions,
              (select count(*) from item_versions)::text as versions,
              (select count(*) from decisions)::text as decisions`,
    )
  ).rows[0] as Record<string, string>

const stored = async (id: string) =>
  (
    await client.query<{ ref: string; change_mark: string; missing: boolean }>(
      `select ref, change_mark, missing_since_snapshot is not null as missing
         from definitions where connector_id = $1 order by ref`,
      [id],
    )
  ).rows

const activeFlags = async () =>
  (
    await client.query<{ item_id: string; flag: string; reason: string }>(
      "select item_id, flag::text, reason from v_overlay_on where kind = 'flag_on' order by item_id, flag",
    )
  ).rows

const commitFile = (file: unknown) =>
  host.commit('shop-metrics', { 'semantic/semantic_manifest.json': JSON.stringify(file) })

const config = () => ({
  repository: host.address('shop-metrics'),
  ref: 'main',
  folder: 'semantic',
  file: 'semantic_manifest.json',
  // The fixture's `sales`, as the items below say it.
  domainNames: { sales: 'finance' },
})

async function accepted(draft: Draft): Promise<string> {
  const created = await ok<ProposalRecord>(
    call('POST', '/proposals', 'author', {
      draft: {
        areaId: 'finance',
        validity: { start: '2026-08-04', end: null },
        evidence: [{ url: 'https://example.test/note', quote: 'Noted', date: '2026-08-04' }],
        ...draft,
      },
    }),
  )
  const submitted = await ok<ProposalRecord>(
    call('POST', `/proposals/${created.id}/submit`, 'author', { revision: created.revision }),
  )
  const sheet = await ok<{ proposal: ReviewProposal; clashes: { itemId: string }[] }>(
    call('GET', `/review/${submitted.id}/sheet`, 'owner'),
  )
  await ok(
    call('POST', `/review/${submitted.id}/publish`, 'owner', {
      revision: sheet.proposal.revision,
      relations: sheet.clashes.map((clash) => ({ itemId: clash.itemId, relation: 'unrelated' })),
    }),
  )
  return submitted.itemId!
}

beforeAll(async () => {
  await foundation(client)
  for (const name of Object.keys(people) as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
  host = await gitHost({ token: TOKEN })
  await host.repository('shop-metrics', {
    'semantic/semantic_manifest.json': JSON.stringify(legacyManifest),
  })
}, 120_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('a semantic manifest in Git', () => {
  let sourceId = ''
  const items = { revenue: '', margin: '' }

  it('is tested step by step, with its semantic models to choose from, and kept nowhere', async () => {
    const check = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'dbt-metricflow',
        config: config(),
        secrets: { token: TOKEN },
      }),
    )
    expect(check).toMatchObject({ ok: true, complete: true, views: 3, metrics: 12, dimensions: 7 })
    expect(check.steps.map((step) => [step.id, step.status])).toEqual([
      ['reach', 'ok'],
      ['read', 'ok'],
      ['domains', 'warning'],
    ])
    expect(check.scopes).toEqual([
      { id: '_shared', title: '_shared', suggestedDomain: null, metrics: 2, dimensions: 0 },
      { id: 'customers', title: 'customers', suggestedDomain: null, metrics: 1, dimensions: 4 },
      { id: 'orders', title: 'orders', suggestedDomain: 'finance', metrics: 9, dimensions: 3 },
    ])
    expect(JSON.stringify(check)).not.toContain(TOKEN)
    expect(JSON.stringify(check)).not.toContain('case when')
    expect(
      (await client.query("select count(*)::int as n from definitions where ref like 'dbt:%'"))
        .rows[0],
    ).toEqual({ n: 0 })
  }, 120_000)

  it('is added and read through the pipeline, with a read that publishes nothing', async () => {
    const added = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'dbt-metricflow',
        name: 'Shop metrics',
        config: config(),
        secrets: { token: TOKEN },
        schedule: 'PT30M',
        reason: 'Read the shop metrics from Git',
      }),
      201,
    )
    sourceId = added.id
    const before = await published()
    expect(await read(sourceId)).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    expect(await stored(sourceId)).toHaveLength(19)
    expect(await published()).toEqual(before)
    await transaction(client, async () => {
      await client.query(`insert into vocab_terms(key,kind) values
        ('metric:revenue','metric'),('metric:gross_margin','metric')`)
      // The first edition is a bootstrap: its vocabulary needs no decision (0006).
      const [{ seq }] = (
        await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
      ).rows as [{ seq: string }]
      for (const [key, name, ref] of [
        ['metric:revenue', 'Revenue', 'dbt:orders.revenue'],
        ['metric:gross_margin', 'Gross margin', 'dbt:orders.gross_margin'],
      ]) {
        const term = await client.query<{ id: string }>(
          `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values($1,1,$2,'finance',sha256(convert_to($1,'UTF8'))) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$3 from v) select id from v`,
          [key, name, ref],
        )
        await client.query(
          "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
          [key, term.rows[0]!.id, seq],
        )
      }
      await client.query('select edition_seal($1)', [seq])
      await client.query('select edition_publish($1)', [seq])
    })
    items.revenue = await accepted({
      title: 'Revenue caveat',
      summary: 'Revenue was counted twice for a day',
      scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
    })
    items.margin = await accepted({
      title: 'Margin caveat',
      summary: 'Margin leaves out shipping',
      scope: { metrics: ['metric:gross_margin'], dimensions: [], dimensionValues: [] },
    })
    expect(await activeFlags()).toEqual([])
  }, 180_000)

  it('flags nothing when the project moves to dbt’s latest YAML spec', async () => {
    const before = await stored(sourceId)
    await commitFile(latestManifest)
    expect(await read(sourceId)).toMatchObject({
      status: 'ok',
      definitionsSeen: 19,
      flags: { raised: 0 },
    })
    expect(await activeFlags()).toEqual([])
    const after = await stored(sourceId)
    expect(
      after
        .filter((definition, index) => definition.change_mark !== before[index]!.change_mark)
        .map((definition) => definition.ref),
    ).toEqual(['dbt:customers.status', 'dbt:orders.channel'])
  }, 120_000)

  it('keeps everything it knew when a metric’s input is gone, and reads in part', async () => {
    const before = await stored(sourceId)
    await commitFile(withMissingInput(latestManifest))
    expect(await read(sourceId)).toMatchObject({ status: 'partial' })
    expect(await stored(sourceId)).toEqual(before)
    expect(await activeFlags()).toEqual([])
  }, 120_000)

  it('flags the items that rely on a calculation that changed, and publishes nothing', async () => {
    const before = await published()
    await commitFile(withChangedRevenue(latestManifest))
    expect(await read(sourceId)).toMatchObject({ status: 'ok' })
    expect(await activeFlags()).toEqual([
      {
        item_id: items.revenue,
        flag: 'needs_check',
        reason: 'Definition changed: dbt:orders.revenue',
      },
    ])
    expect(await published()).toEqual(before)
  }, 120_000)

  it('flags the items that rely on a metric that left', async () => {
    const changed = withChangedRevenue(latestManifest)
    await commitFile({
      ...changed,
      metrics: changed.metrics.filter((metric) => metric.name !== 'gross_margin'),
    })
    expect(await read(sourceId)).toMatchObject({ status: 'ok' })
    expect((await stored(sourceId)).filter((definition) => definition.missing)).toMatchObject([
      { ref: 'dbt:orders.gross_margin' },
    ])
    expect(await activeFlags()).toContainEqual({
      item_id: items.margin,
      flag: 'source_missing',
      reason: 'Definition missing: dbt:orders.gross_margin',
    })
  }, 120_000)

  it('keeps what a disconnected source read, which the next source takes over', async () => {
    const read1 = await stored(sourceId)
    await ok(
      call('POST', `/sources/${sourceId}/disconnect`, 'admin', {
        reason: 'The project moved to another repository',
      }),
    )
    expect(await stored(sourceId)).toEqual(read1)
    const again = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'dbt-metricflow',
        name: 'Shop metrics',
        config: config(),
        secrets: { token: TOKEN },
        reason: 'Read the shop metrics again',
      }),
      201,
    )
    expect(await read(again.id)).toMatchObject({ status: 'ok', definitionsSeen: 18 })
  }, 120_000)
})
