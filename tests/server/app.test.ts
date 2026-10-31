import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDatabase, type Database } from '../../src/server/db/database.ts'
import type { JobRunner } from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { heedVersion } from '../../src/server/version.ts'

function captureLogs() {
  const lines: string[] = []
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString().trim().split('\n'))
      done()
    },
  })
  return { lines, logger: createLogger({ level: 'info', destination }) }
}

const reachable: Database = {
  transaction: (_person, work) => work(reachable),
  ping: () => Promise.resolve(),
  query: () => Promise.resolve([]),
  close: () => Promise.resolve(),
}

function idleJobs(onStop: () => void = () => undefined): JobRunner {
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(onStop()),
    runNow: () => Promise.resolve({ outcome: 'not_running' }),
    overview: () => Promise.reject(new Error('not used')),
  }
}

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

function app(database: Database, jobs: JobRunner = idleJobs()) {
  const { lines, logger } = captureLogs()
  const instance = buildApp({ database, jobs, logger })
  close = () => instance.close()
  return { instance, lines }
}

describe('the dev sign-in in production', () => {
  // The sign-in page's demo picker lists what /auth/people serves. In production the service
  // never builds with the dev connector, so there is nothing to list and nobody to sign in as.
  it('refuses to build at all, so no demo person is ever offered', () => {
    expect(() =>
      buildApp({
        database: reachable,
        jobs: idleJobs(),
        logger: createLogger({ level: 'silent' }),
        devPeople: [{ email: 'per_maria@example.test', name: 'Maria Lindqvist', roles: [] }],
        nodeEnv: 'production',
      }),
    ).toThrow(/Dev sign-in is refused when NODE_ENV=production/)
  })
})

describe('health', () => {
  it('answers while the process runs', async () => {
    const { instance } = app(reachable)
    const response = await instance.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', service: 'heed', version: heedVersion })
  })

  it('is ready when the database answers', async () => {
    const { instance } = app(reachable)
    const response = await instance.inject({ method: 'GET', url: '/health/ready' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'heed',
      version: heedVersion,
      checks: { database: 'ok' },
    })
  })

  it('is unavailable when the database cannot be reached', async () => {
    const { logger } = captureLogs()
    // Port 1 refuses connections at once, so this needs no database.
    const database = createDatabase('postgres://127.0.0.1:1/context_layer_none', logger)
    const { instance, lines } = app(database)
    const response = await instance.inject({ method: 'GET', url: '/health/ready' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      status: 'unavailable',
      service: 'heed',
      version: heedVersion,
      checks: { database: 'unavailable' },
    })
    expect(lines.some((line) => line.includes('readiness check: database unreachable'))).toBe(true)
  })

  it('stops the job runner, then closes the database, with the app', async () => {
    const closed: string[] = []
    const { instance } = app(
      { ...reachable, close: () => Promise.resolve(void closed.push('database')) },
      idleJobs(() => closed.push('jobs')),
    )
    await instance.close()
    expect(closed).toEqual(['jobs', 'database'])
  })
})

describe('security headers', () => {
  it('are on every answer, a missing address included', async () => {
    const { instance } = app(reachable)
    for (const url of ['/health', '/api/v1/no-such-thing']) {
      const response = await instance.inject({ method: 'GET', url })
      expect(response.headers).toMatchObject({
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      })
    }
  })

  it("leave a route's own policy alone", async () => {
    const { instance } = app(reachable)
    instance.get('/page', (_request, reply) =>
      reply.header('content-security-policy', "default-src 'self'").send('ok'),
    )
    const response = await instance.inject({ method: 'GET', url: '/page' })
    expect(response.headers['content-security-policy']).toBe("default-src 'self'")
    expect(response.headers['x-frame-options']).toBe('DENY')
  })
})

describe('request logs', () => {
  it('carry method, path and status, never headers or query strings', async () => {
    const { instance, lines } = app(reachable)
    await instance.inject({
      method: 'GET',
      url: '/health?question=who-asked',
      headers: { authorization: 'Bearer secret-token', cookie: 'session=secret-cookie' },
    })
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records).toContainEqual(
      expect.objectContaining({ name: 'heed', req: { method: 'GET', path: '/health' } }),
    )
    expect(records).toContainEqual(expect.objectContaining({ res: { statusCode: 200 } }))
    const text = lines.join('\n')
    for (const secret of ['who-asked', 'secret-token', 'secret-cookie']) {
      expect(text).not.toContain(secret)
    }
  })

  it('redact credentials if a header object is ever logged', () => {
    const { lines, logger } = captureLogs()
    logger.info(
      {
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'a=b',
          'x-heed-csrf': 'secret-csrf',
        },
      },
      'oops',
    )
    expect(lines.join('\n')).not.toContain('secret-token')
    expect(lines.join('\n')).not.toContain('secret-csrf')
    expect(lines.join('\n')).toContain('[redacted]')
  })

  it('redact the model provider keys wherever they appear', () => {
    const { lines, logger } = captureLogs()
    logger.info({ modelEnv: { ANTHROPIC_API_KEY: 'model-key-1' } }, 'config')
    logger.info(
      {
        config: { modelEnv: { VERCEL_AI_GATEWAY_API_KEY: 'model-key-2' } },
        client: { apiKey: 'model-key-3' },
      },
      'nested',
    )
    logger.info({ err: { headers: { 'x-api-key': 'model-key-4' } } }, 'error')
    logger.info({ err: { headers: { authorization: 'Bearer model-key-5' } } }, 'gateway error')
    const text = lines.join('\n')
    for (const secret of [
      'model-key-1',
      'model-key-2',
      'model-key-3',
      'model-key-4',
      'model-key-5',
    ])
      expect(text).not.toContain(secret)
  })
})
