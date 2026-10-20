import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import {
  PRACTICE_AREA,
  practicePeople,
  seedPracticeThrough,
  type PracticeSeed,
} from '../../db/seed/practice.ts'
import { run } from '../../src/cli/commands.ts'
import { proposalStates } from '../../src/domain/proposal-state.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The practice domain seed on an empty migrated database, through the service's own API: the
  domain is live with its own invented vocabulary, proposals in every state, gaps in every status
  and editions, and a second run changes nothing. Then the templates' import commands on it: the
  item template's examples pass the dry run, and `heed import-tests` checks and saves questions.
*/

const ORIGIN = 'http://127.0.0.1'
const admin = { email: 'admin@example.test', name: 'Admin', roles: ['administrator' as const] }
const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-14'),
  origins: [ORIGIN],
  devPeople: [admin, ...Object.values(practicePeople).map((p) => ({ ...p, roles: [] }))],
})
let base = ''
let first: PracticeSeed
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
  first = await seedPracticeThrough(base, admin.email, '2026-10-14')
  folder = await mkdtemp(join(tmpdir(), 'heed-practice-'))
}, 60_000)
afterAll(async () => {
  await app.close()
  await rm(folder, { recursive: true, force: true })
})

describe('the practice domain seed', () => {
  it('leaves proposals in every state, gaps in every status and its own editions', async () => {
    expect(first.seeded).toBe(true)
    expect(Object.keys(first.proposals).sort()).toEqual([...proposalStates].sort())
    const states = await client.query<{ state: string; n: number }>(
      "select state::text, count(*)::int as n from proposals where area_id=$1 and subject='item' group by 1",
      [PRACTICE_AREA],
    )
    expect(Object.fromEntries(states.rows.map((r) => [r.state, r.n]))).toEqual(first.proposals)
    const gaps = await client.query<{ status: string }>(
      'select status::text from gaps order by status',
    )
    expect(gaps.rows.map((g) => g.status)).toEqual(['open', 'resolved', 'wont_fix'])
    const editions = await client.query<{ reason: string }>(
      'select reason::text from editions order by seq',
    )
    expect(editions.rows.length).toBe(first.editions)
    expect(new Set(editions.rows.map((e) => e.reason))).toEqual(
      new Set(['vocabulary_changed', 'proposal_accepted']),
    )
  })

  it('says what it is, and holds invented content on its own invented vocabulary only', async () => {
    const about = await client.query<{ summary: string; description: string }>(
      'select summary, description from areas where id=$1',
      [PRACTICE_AREA],
    )
    expect(about.rows[0]?.summary).toMatch(/^An invented bakery/)
    expect(about.rows[0]?.description).toContain('Never quote it as a fact')
    const terms = await client.query<{ key: string; name: string; area: string }>(
      'select term_key as key, name, area_id as area from vocab_term_versions',
    )
    expect(terms.rows.length).toBeGreaterThan(0)
    for (const term of terms.rows) {
      expect(term.key).toMatch(/^(metric|dim|val):practice_/)
      expect(term.name).toMatch(/\(practice\)$/)
      expect(term.area).toBe(PRACTICE_AREA)
    }
    const items = await client.query<{ title: string; risk: string; keys: string[] }>(
      `select v.title, v.risk::text, array(
         select metric_key from item_version_metrics m where m.version_id=v.id
         union all select value_key from item_version_dimension_values d where d.version_id=v.id
       ) as keys from item_versions v`,
    )
    expect(items.rows.length).toBeGreaterThan(0)
    for (const item of items.rows) {
      expect(item.title).toMatch(/^Practice: /)
      expect(item.risk).toBe('low')
      for (const key of item.keys) expect(key).toMatch(/^(metric|val):practice_/)
    }
  })

  it('changes nothing when the domain is there already', async () => {
    const before = await client.query('select count(*) from audit_log')
    expect(await seedPracticeThrough(base, admin.email, '2026-10-14')).toMatchObject({
      seeded: false,
    })
    // Signing in writes no history; nothing else ran.
    expect((await client.query('select count(*) from audit_log')).rows).toEqual(before.rows)
  })
})

describe('the import commands of the templates', () => {
  it('passes the item template through the dry run, changing nothing', async () => {
    const proposals = await client.query('select count(*) from proposals')
    const dry = await heed(
      ['import', 'docs/templates/items.yaml'],
      practicePeople.contributor.email,
    )
    expect(dry.code, dry.out + dry.err).toBe(0)
    expect(dry.out).toContain('Dry run: 3 new, 0 changed, 0 unchanged')
    expect((await client.query('select count(*) from proposals')).rows).toEqual(proposals.rows)
  })

  it('checks test questions with import-tests, and saves them only with --apply', async () => {
    const template = await heed(
      ['import-tests', 'docs/templates/test-questions.yaml'],
      practicePeople.owner.email,
    )
    expect(template.code).toBe(1)
    expect(template.out).toContain("You can't change the test questions of area_sales.")

    const file = join(folder, 'questions.yaml')
    await writeFile(
      file,
      stringify({
        questions: [
          {
            id: 'practice-old-town-loaves',
            area: PRACTICE_AREA,
            wordings: [
              { kind: 'natural', text: 'Why did Old Town bake fewer loaves this week?' },
              {
                kind: 'precise',
                text: 'What documented context applies to loaves baked at the Old Town kiosk?',
              },
            ],
            scope: {
              metrics: ['metric:practice_loaves_baked'],
              dimension_filters: [
                { dimension: 'dim:practice_kiosk', values: ['val:practice_kiosk/old_town'] },
              ],
            },
            expected: { status: 'matched' },
            source: 'Practice domain',
          },
        ],
      }),
    )
    const dry = await heed(['import-tests', file], practicePeople.owner.email)
    expect(dry.code, dry.out + dry.err).toBe(0)
    expect(dry.out).toContain('Dry run: 1 new, 0 changed, 0 unchanged')
    const none = await client.query('select count(*)::int as n from golden_questions')
    expect(none.rows[0]).toEqual({ n: 0 })

    const applied = await heed(['import-tests', file, '--apply'], practicePeople.owner.email)
    expect(applied.code, applied.out + applied.err).toBe(0)
    expect(applied.out).toContain('Saved: 1 new, 0 changed, 0 unchanged')
    const again = await heed(['import-tests', file, '--apply'], practicePeople.owner.email)
    expect(again.out).toContain('Saved: 0 new, 0 changed, 1 unchanged')

    const stranger = await heed(['import-tests', file], practicePeople.contributor.email)
    expect(stranger.code).toBe(1)
    expect(stranger.err).toContain('Test questions are kept by owners, deputies and administrators')
  })
})
