import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { run } from '../../src/cli/commands.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The templates' import commands on the demo data, as `heed` runs them against a service: the
  item template's examples pass the dry run, and `heed import-tests` checks and saves questions
  only for the domains the person owns.
*/

const ORIGIN = 'http://127.0.0.1'
const { client, url } = testDatabase({ seeded: true })
// Jon owns Sales; Maria owns no domain.
const people = ['jon', 'maria'].map((name) => ({
  name,
  email: `per_${name}@example.test`,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-14'),
  origins: [ORIGIN],
  devPeople: people,
})
let base = ''
let folder = ''

async function heed(args: string[], email: string) {
  const out: string[] = []
  const err: string[] = []
  const code = await run(args, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: { HEED_URL: base, HEED_EMAIL: email, HEED_ORIGIN: ORIGIN },
  })
  return { code, out: out.join(''), err: err.join('') }
}

beforeAll(async () => {
  base = await app.listen({ host: '127.0.0.1', port: 0 })
  folder = await mkdtemp(join(tmpdir(), 'heed-templates-'))
}, 60_000)
afterAll(async () => {
  await app.close()
  await rm(folder, { recursive: true, force: true })
})

describe('the import commands of the templates', () => {
  it('passes the item template through the dry run, changing nothing', async () => {
    const proposals = await client.query('select count(*) from proposals')
    const dry = await heed(['import', 'docs/templates/items.yaml'], 'per_maria@example.test')
    expect(dry.code, dry.out + dry.err).toBe(0)
    expect(dry.out).toContain('Dry run: 3 new, 0 changed, 0 unchanged')
    expect((await client.query('select count(*) from proposals')).rows).toEqual(proposals.rows)
  })

  it('checks test questions with import-tests, and saves them only with --apply', async () => {
    const template = await heed(
      ['import-tests', 'docs/templates/test-questions.yaml'],
      'per_jon@example.test',
    )
    expect(template.code).toBe(1)
    expect(template.out).toContain("You can't change the test questions of area_customer_value.")

    const file = join(folder, 'questions.yaml')
    await writeFile(
      file,
      stringify({
        questions: [
          {
            id: 'example-spain-orders',
            area: 'area_sales',
            wordings: [
              { kind: 'natural', text: 'Why were Spain orders so high in mid September?' },
              {
                kind: 'precise',
                text: 'What documented context applies to orders in Spain in September 2026?',
              },
            ],
            scope: {
              metrics: ['metric:orders'],
              dimension_filters: [{ dimension: 'dim:market', values: ['val:market/spain'] }],
            },
            expected: { status: 'matched' },
            source: 'Demo data',
          },
        ],
      }),
    )
    const before = await client.query<{ n: number }>(
      'select count(*)::int as n from golden_questions',
    )
    const dry = await heed(['import-tests', file], 'per_jon@example.test')
    expect(dry.code, dry.out + dry.err).toBe(0)
    expect(dry.out).toContain('Dry run: 1 new, 0 changed, 0 unchanged')
    expect(
      (await client.query<{ n: number }>('select count(*)::int as n from golden_questions')).rows,
    ).toEqual(before.rows)

    const applied = await heed(['import-tests', file, '--apply'], 'per_jon@example.test')
    expect(applied.code, applied.out + applied.err).toBe(0)
    expect(applied.out).toContain('Saved: 1 new, 0 changed, 0 unchanged')
    const again = await heed(['import-tests', file, '--apply'], 'per_jon@example.test')
    expect(again.out).toContain('Saved: 0 new, 0 changed, 1 unchanged')

    const stranger = await heed(['import-tests', file], 'per_maria@example.test')
    expect(stranger.code).toBe(1)
    expect(stranger.err).toContain('Test questions are kept by owners, deputies and administrators')
  })
})
