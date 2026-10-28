import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  CheckRun,
  SavedQuestionRecord,
  SavedStatus,
} from '../../src/contract/saved-questions.ts'
import type { ReviewSheet } from '../../src/contract/review-path.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createBundleCache } from '../../src/server/modules/answer/index.ts'
import { loadServingBundle } from '../../src/server/modules/editions/index.ts'
import {
  checkIfMoved,
  draftChecks,
  runCheck,
} from '../../src/server/modules/saved-questions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, servingEdition, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Saved questions and the free check on the service (FR-526): a domain's owners and administrators
  save a question with their name, and its answer now becomes what it should keep getting; every
  saved question is answered again with the answer engine, with no model, after each change agents
  get (the check job) and on Check now, and its result is Same, Changed or Needs a look. Nobody
  else reads them, a check never blocks a publish, and agents never read any of it.
*/

const { client, url } = testDatabase()
const today = '2026-10-23'
const database = apiDatabase(url)
const devPeople: DevPerson[] = ['author', 'owner', 'admin', 'stranger'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database,
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople,
  clock: systemClock(today),
})
const origin = 'http://localhost'
const sessions: Record<string, Record<string, string>> = {}

async function login(name: string) {
  if (sessions[name]) return sessions[name]
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return (sessions[name] = {
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    origin,
  })
}
async function api(
  name: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: object,
) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
}
async function ok<T>(name: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: object) {
  const response = await api(name, method, path, body)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const list = (name: string, area?: string) =>
  ok<SavedQuestionRecord[]>(name, 'GET', `/saved-questions${area ? `?areaId=${area}` : ''}`)

const question = 'Why did orders fall in Norway?'
let item: string
let saved: SavedQuestionRecord

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    ;({ item } = await servingEdition(client))
  })
})
afterAll(() => app.close())

/** The item's version agents get now. */
async function liveVersion() {
  const { rows } = await client.query<{ id: string }>(
    `select version_id::text as id from item_version_service
      where item_id = $1 and upper_inf(editions)`,
    [item],
  )
  return rows[0]!.id
}

/** A new version of the item, published straight away, not from the review. */
async function publishNew(summary: string) {
  const previous = await liveVersion()
  await transaction(client, async () => {
    const v = await version(client, {
      item,
      summary,
      body: 'Norway closed on 4 August.',
      owner: people.owner,
      previous,
    })
    await accept(client, v.id)
    await publish(client, v.id)
  })
}

describe('saving a question', () => {
  it("keeps the question with its saver's name and what the answer engine gives it now", async () => {
    const created = await ok<{ question: SavedQuestionRecord; undo: string }>(
      'owner',
      'POST',
      '/saved-questions',
      { areaId: 'finance', question, origin: 'ask' },
    )
    saved = created.question
    expect(created.undo).toBe(`saved:${saved.id}`)
    expect(saved).toMatchObject({
      areaId: 'finance',
      question,
      origin: 'ask',
      savedBy: { personId: people.owner, name: 'owner' },
      expectItems: [item],
      result: { result: 'same', reason: 'saved', trigger: 'saved' },
    })
    expect(saved.saved.items.map((i) => i.id)).toEqual([item])
    expect(saved.saved.items[0]).toMatchObject({ summary: 'Orders', unverified: null })
    expect(saved.result.now).toEqual(saved.saved)
    expect(await list('owner')).toEqual([saved])
    // An administrator reads every domain's; one domain's narrows it.
    expect((await list('admin')).map((q) => q.id)).toEqual([saved.id])
    expect(await list('admin', 'marketing')).toEqual([])
  })

  it('is for the domain’s owners and administrators: anyone else reads none and saves none', async () => {
    expect(await list('author')).toEqual([])
    expect(await list('stranger')).toEqual([])
    const member = await api('author', 'POST', '/saved-questions', {
      areaId: 'finance',
      question,
      origin: 'typed',
    })
    expect(member.statusCode).toBe(403)
    // An owner of another domain only.
    const other = await api('owner', 'POST', '/saved-questions', {
      areaId: 'marketing',
      question,
      origin: 'typed',
    })
    expect(other.statusCode).toBe(403)
    expect((await api('author', 'POST', '/saved-questions/check', {})).statusCode).toBe(403)
    // Nor through the database: row security hides them from anyone else.
    const hidden = await database.transaction(people.author, (tx) =>
      tx.query('select * from saved_questions'),
    )
    expect(hidden).toEqual([])
  })

  it('keeps only the items of the answer it should answer from, and Undo removes it', async () => {
    const typed = await ok<{ question: SavedQuestionRecord; undo: string }>(
      'admin',
      'POST',
      '/saved-questions',
      { areaId: 'finance', question: 'What happened to orders?', origin: 'typed', expectItems: [] },
    )
    expect(typed.question.expectItems).toEqual([])
    expect((await list('admin')).map((q) => q.id)).toContain(typed.question.id)
    // Only its saver undoes it.
    const theirs = await api('owner', 'POST', '/decisions/undo', { token: typed.undo })
    expect(theirs.statusCode).toBe(403)
    await ok('admin', 'POST', '/decisions/undo', { token: typed.undo })
    expect((await list('admin')).map((q) => q.id)).toEqual([saved.id])
  })
})

describe('the free check', () => {
  it('Check now answers every saved question again, counting as it goes, and publishes nothing', async () => {
    const editions = await client.query('select count(*)::int as n from editions')
    const done = await ok<{ run: CheckRun; same: number; changed: number; look: number }>(
      'owner',
      'POST',
      '/saved-questions/check',
      {},
    )
    expect(done).toMatchObject({
      run: { trigger: 'manual', state: 'done', checked: 1, total: 1, areaId: null },
      same: 1,
      changed: 0,
      look: 0,
    })
    expect((await client.query('select count(*)::int as n from editions')).rows).toEqual(
      editions.rows,
    )
    const status = await ok<SavedStatus>('owner', 'GET', '/saved-questions/status')
    expect(status.run).toEqual(done.run)
    expect(status.checkedAt).not.toBeNull()
    expect(status.weeks).toHaveLength(8)
    expect(status.weeks.at(-1)).toEqual({ week: '2026-10-19', same: 1, total: 1 })
    expect(status.weeks[0]).toEqual({ week: '2026-08-31', same: 0, total: 0 })
    // Another person's Check now is theirs: an administrator's page waits on its own runs.
    expect((await ok<SavedStatus>('admin', 'GET', '/saved-questions/status')).run).toBeNull()
  })

  it('the review checks the draft against it, and publishing the change makes it the saved answer', async () => {
    const live = await liveVersion()
    const proposal = await transaction(client, async () => {
      const v = await version(client, {
        item,
        summary: 'Orders in Norway stopped on 4 August.',
        body: 'Norway closed on 4 August.',
        owner: people.owner,
        previous: live,
      })
      await client.query(
        `insert into item_version_evidence (version_id, position, url, quote, read_on)
         values ($1, 0, 'https://example.test/norway', 'Norway closed on 4 August.', '2026-08-05')`,
        [v.id],
      )
      const { rows } = await client.query<{ id: string }>(
        `insert into proposals (action, state, area_id, item_id, item_version_id, proposer_id, channel, submitted_at)
         select 'change', 'submitted', area_id, item_id, id, proposer_id, 'form', now()
           from item_versions where id = $1 returning id::text`,
        [v.id],
      )
      return rows[0]!.id
    })
    const sheet = await ok<ReviewSheet>('owner', 'GET', `/review/${proposal}/sheet`)
    expect(sheet.saved).toEqual([
      expect.objectContaining({ id: saved.id, question, result: 'changed', reason: 'words' }),
    ])
    expect(sheet.saved[0]!.draft.items[0]!.summary).toBe('Orders in Norway stopped on 4 August.')
    expect(sheet.saved[0]!.live.items[0]!.summary).toBe('Orders')
    // Nobody else's review shows it: the author does not manage the domain.
    expect((await ok<ReviewSheet>('author', 'GET', `/review/${proposal}/sheet`)).saved).toEqual([])

    await ok('owner', 'POST', `/review/${proposal}/publish`, {
      revision: sheet.proposal.revision,
    })
    const [after] = await list('owner')
    expect(after!.result).toMatchObject({ result: 'same', reason: 'published', trigger: 'publish' })
    expect(after!.saved.items[0]!.summary).toBe('Orders in Norway stopped on 4 August.')
  })

  it('a change published another way shows as Changed until someone keeps it, with Undo', async () => {
    await publishNew('Orders in Norway fell to almost nothing from 4 August.')
    const done = await ok<{ changed: number }>('owner', 'POST', '/saved-questions/check', {
      areaId: 'finance',
    })
    expect(done.changed).toBe(1)
    const [changed] = await list('owner')
    expect(changed!.result).toMatchObject({ result: 'changed', reason: 'words', trigger: 'manual' })
    expect(changed!.result.now.items[0]!.summary).toBe(
      'Orders in Norway fell to almost nothing from 4 August.',
    )

    // A suggestion that changes nothing agents get changes nothing for it, whatever it was saved as.
    const unchanged = await database.transaction(people.owner, async (tx) => {
      const [head] = await tx.query<{ seq: string; label: string; overlay: string }>(
        `select e.seq::text, e.label, coalesce((select seq::text from serving_overlay),'0') as overlay
           from editions e join live_edition l on l.seq = e.seq`,
      )
      const bundle = await loadServingBundle(tx, head!)
      return draftChecks(tx, today, item, { live: bundle, draft: bundle })
    })
    expect(unchanged.map((d) => [d.id, d.result])).toEqual([[saved.id, 'same']])

    const kept = await ok<{ question: SavedQuestionRecord; undo: string }>(
      'owner',
      'POST',
      `/saved-questions/${saved.id}/keep`,
      {},
    )
    expect(kept.question.result).toMatchObject({ result: 'same', reason: 'kept' })
    expect(kept.question.saved).toEqual(changed!.result.now)
    // There is nothing new to keep now.
    expect((await api('owner', 'POST', `/saved-questions/${saved.id}/keep`, {})).statusCode).toBe(
      409,
    )
    // Only its keeper undoes it, and the answer before is the saved one again.
    expect((await api('admin', 'POST', '/decisions/undo', { token: kept.undo })).statusCode).toBe(
      409,
    )
    await ok('owner', 'POST', '/decisions/undo', { token: kept.undo })
    const [back] = await list('owner')
    expect(back!.saved).toEqual(changed!.saved)
    expect(back!.result).toMatchObject({ result: 'changed', reason: 'words' })
  })

  it('the check job runs once what agents get moved, and not again until it moves', async () => {
    const cache = createBundleCache()
    const clock = systemClock(today)
    expect(await checkIfMoved(database, clock, cache)).toEqual({ trigger: 'publish', checked: 1 })
    expect(await checkIfMoved(database, clock, cache)).toBeNull()
    const [after] = await list('owner')
    expect(after!.result).toMatchObject({ result: 'changed', trigger: 'publish' })
    // Its run is the check job's: nobody started it.
    const { rows } = await client.query(
      `select started_by from check_runs where trigger = 'publish' order by started_at desc limit 1`,
    )
    expect(rows).toEqual([{ started_by: null }])
  })

  it('a check date passing: its item may be out of date, so it needs a look, and says why', async () => {
    const clock = systemClock('2027-01-02')
    expect(await checkIfMoved(database, clock, createBundleCache())).toEqual({
      trigger: 'check_date',
      checked: 1,
    })
    const [look] = await list('owner')
    expect(look!.result).toMatchObject({ result: 'look', reason: 'worse', trigger: 'check_date' })
    // Its answer stays Partial, as the question gives no dates; its item may be out of date.
    expect(look!.result.now.state).toBe('partial')
    expect(look!.result.now.items[0]!.unverified).toBe('past_review_date')
  })

  it('a run that cannot finish is failed, never a result, and keeps what it had', async () => {
    const before = await list('owner')
    const broken = {
      bundle: () => Promise.reject(new Error('the edition could not be read')),
    } as unknown as ReturnType<typeof createBundleCache>
    await expect(
      runCheck(database, systemClock(today), broken, people.owner, { trigger: 'manual' }),
    ).rejects.toThrow('the edition could not be read')
    const status = await ok<SavedStatus>('owner', 'GET', '/saved-questions/status')
    expect(status.run).toMatchObject({ state: 'failed', checked: 0, total: 1 })
    expect(await list('owner')).toEqual(before)
  })

  it('the check job backs off from a run that failed, for the same state, then tries again', async () => {
    const clock = systemClock(today)
    const broken = {
      bundle: () => Promise.reject(new Error('the edition could not be read')),
    } as unknown as ReturnType<typeof createBundleCache>
    const failedRuns = async () =>
      Number(
        (
          await client.query<{ n: number }>(
            `select count(*)::int as n from check_runs where started_by is null and failed_at is not null`,
          )
        ).rows[0]!.n,
      )
    const before = await failedRuns()
    await expect(checkIfMoved(database, clock, broken)).rejects.toThrow('could not be read')
    expect(await failedRuns()).toBe(before + 1)
    // The next minutes do not start another run over the same state.
    expect(await checkIfMoved(database, clock, createBundleCache())).toBeNull()
    expect(await checkIfMoved(database, clock, broken)).toBeNull()
    expect(await failedRuns()).toBe(before + 1)
    // Once the wait has passed it tries again, and waits longer after failing again.
    const age = (minutes: number) =>
      client.query(
        `update check_runs set failed_at = failed_at - $1 * interval '1 minute'
          where started_by is null and failed_at is not null`,
        [minutes],
      )
    await age(3)
    await expect(checkIfMoved(database, clock, broken)).rejects.toThrow('could not be read')
    expect(await failedRuns()).toBe(before + 2)
    await age(3)
    expect(await checkIfMoved(database, clock, createBundleCache())).toBeNull()
    await age(60)
    expect(await checkIfMoved(database, clock, createBundleCache())).toMatchObject({
      checked: 1,
    })
  })

  it('the review checks a draft against the saved questions that answer from its item', async () => {
    const drafts = await database.transaction(people.owner, async (tx) => {
      const [head] = await tx.query<{ seq: string; label: string; overlay: string }>(
        `select e.seq::text, e.label, coalesce((select seq::text from serving_overlay),'0') as overlay
           from editions e join live_edition l on l.seq = e.seq`,
      )
      const bundle = await loadServingBundle(tx, head!)
      // Archiving the item: the question would hear nothing is written down.
      return draftChecks(tx, today, item, {
        live: bundle,
        draft: { ...bundle, items: bundle.items.filter((i) => i.id !== item) },
      })
    })
    expect(drafts).toEqual([
      expect.objectContaining({ id: saved.id, question, result: 'look', reason: 'worse' }),
    ])
    expect(drafts[0]!.draft.state).toBe('missing')
    // Someone who does not manage the domain sees none.
    const theirs = await database.transaction(people.author, async (tx) => {
      const [head] = await tx.query<{ seq: string; label: string; overlay: string }>(
        `select e.seq::text, e.label, '0' as overlay from editions e join live_edition l on l.seq = e.seq`,
      )
      const bundle = await loadServingBundle(tx, head!)
      return draftChecks(tx, today, item, { live: bundle, draft: bundle })
    })
    expect(theirs).toEqual([])
  })

  it('removing a question keeps it, marked removed, out of every list and every check', async () => {
    await ok('owner', 'DELETE', `/saved-questions/${saved.id}`)
    expect(await list('owner')).toEqual([])
    const done = await ok<{ run: CheckRun }>('owner', 'POST', '/saved-questions/check', {})
    expect(done.run.total).toBe(0)
    const [row] = (
      await client.query<{ removed_by: string }>(
        'select removed_by::text from saved_questions where id = $1',
        [saved.id],
      )
    ).rows
    expect(row).toEqual({ removed_by: people.owner })
  })
})

describe('what agents never read', () => {
  it('no function or view reads them but the check’s own, so no edition, export or reply holds one', async () => {
    const { rows } = await client.query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ~ '(saved_question|check_runs)'
       union all
       select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('v', 'm')
          and pg_get_viewdef(c.oid) ~ '(saved_question|check_runs)'`,
    )
    expect(rows).toEqual([{ name: 'cl_saved_questions_to_check' }])
  })

  it('the serving and analytics roles read none of it', async () => {
    for (const table of [
      'saved_questions',
      'saved_question_baselines',
      'saved_question_results',
      'check_runs',
    ])
      for (const role of [localRoles.serve, localRoles.readonly]) {
        const { rows } = await client.query<{ can: boolean }>(
          `select has_table_privilege($1, $2, 'select') as can`,
          [role, `public.${table}`],
        )
        expect(rows[0]!.can, `${role} on ${table}`).toBe(false)
      }
  })
})
