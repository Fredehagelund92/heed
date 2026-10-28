import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The workspace's name (FR-818, golden plan P11a): a setting an admin changes like any other,
  empty on a new install, which everyone signed in reads through workspace.get, and only it.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-23'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

beforeAll(async () => {
  await foundation(client)
  for (const who of ['admin', 'stranger'] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${who}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[who] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
})

const name = async (who: Who) => (await call('GET', '/workspace', who)).json<{ name: string }>()
const setName = (who: Who, value: unknown, version = 1) =>
  call('PUT', '/settings/workspace.name', who, { version, value, reason: 'Named in a test.' })

describe('the workspace name', () => {
  it('starts empty, for everyone signed in', async () => {
    expect(await name('stranger')).toEqual({ name: '' })
  })

  it('is named by an admin, as a new version of the setting, and read by everyone', async () => {
    expect((await setName('stranger', 'Not theirs')).statusCode).toBe(403)
    const saved = await setName('admin', 'Larchwood Outdoor')
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json()).toMatchObject({ key: 'workspace.name', version: 2 })
    expect(await name('stranger')).toEqual({ name: 'Larchwood Outdoor' })
  })

  it('is one line of at most 80 characters, with no space at either end', async () => {
    for (const value of ['Two\nlines', ' Spaced', 'x'.repeat(81), 42])
      expect((await setName('admin', value, 2)).statusCode, String(value)).toBe(422)
  })

  it('is not read by anyone signed out', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
    expect(response.statusCode).toBe(401)
  })
})
