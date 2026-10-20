import { describe, expect, it } from 'vitest'
import {
  PRACTICE_AREA,
  PracticeHalfSeededError,
  practicePeople,
  seedPracticeThrough,
} from '../../db/seed/practice.ts'
import { API_PREFIX } from '../../src/contract/limits.ts'
import { createClient } from '../../src/cli/client.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  A practice seed that stops half way: the rerun says so and fails, instead of reporting that the
  domain is already there, and writes nothing.
*/

const admin = { email: 'admin@example.test', name: 'Admin', roles: ['administrator' as const] }
const { client, url } = testDatabase()
const worked = testDatabase()

describe('a finished practice seed whose gaps were worked', () => {
  it('still changes nothing on a rerun', async () => {
    const app = buildApp({
      database: apiDatabase(worked.url),
      logger: createLogger({ level: 'silent' }),
      jobs: idleJobs(),
      clock: systemClock('2026-10-14'),
      origins: ['http://127.0.0.1'],
      devPeople: [admin, ...Object.values(practicePeople).map((p) => ({ ...p, roles: [] }))],
    })
    try {
      const base = await app.listen({ host: '127.0.0.1', port: 0 })
      expect(await seedPracticeThrough(base, admin.email, '2026-10-14')).toMatchObject({
        seeded: true,
      })
      const owner = createClient({ url: base, origin: 'http://127.0.0.1' })
      await owner.signIn(practicePeople.owner.email)
      for (const gap of await owner.client.gaps.list({ areaId: PRACTICE_AREA, status: 'open' }))
        await owner.client.gaps.setStatus({
          id: gap.id,
          status: 'resolved',
          reason: 'Worked live',
        })
      expect(await owner.client.gaps.list({ areaId: PRACTICE_AREA, status: 'open' })).toEqual([])

      const before = await worked.client.query('select count(*) from audit_log')
      expect(await seedPracticeThrough(base, admin.email, '2026-10-14')).toMatchObject({
        seeded: false,
      })
      expect((await worked.client.query('select count(*) from audit_log')).rows).toEqual(
        before.rows,
      )
    } finally {
      await app.close()
    }
  }, 60_000)
})

describe('a practice seed that stopped half way', () => {
  it('is told apart from a finished one on the rerun', async () => {
    let failGaps = true
    const app = buildApp({
      database: apiDatabase(url),
      logger: createLogger({ level: 'silent' }),
      jobs: idleJobs(),
      clock: systemClock('2026-10-14'),
      origins: ['http://127.0.0.1'],
      devPeople: [admin, ...Object.values(practicePeople).map((p) => ({ ...p, roles: [] }))],
    })
    app.addHook('onRequest', async (request, reply) => {
      if (failGaps && request.method === 'POST' && request.url.startsWith(`${API_PREFIX}/gaps`))
        await reply.code(503).send({ error: 'injected failure' })
    })
    try {
      const base = await app.listen({ host: '127.0.0.1', port: 0 })
      await expect(seedPracticeThrough(base, admin.email, '2026-10-14')).rejects.toThrow()

      const area = await client.query('select 1 from areas where id=$1', [PRACTICE_AREA])
      expect(area.rows.length).toBe(1)

      failGaps = false
      const before = await client.query('select count(*) from audit_log')
      const rerun = seedPracticeThrough(base, admin.email, '2026-10-14')
      await expect(rerun).rejects.toBeInstanceOf(PracticeHalfSeededError)
      await expect(rerun).rejects.toThrow(
        'The practice domain is half-seeded: run the reset command, then seed again',
      )
      expect((await client.query('select count(*) from audit_log')).rows).toEqual(before.rows)
    } finally {
      await app.close()
    }
  }, 60_000)
})
