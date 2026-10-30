import { readFile } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { minifyContractRouter } from '@orpc/contract'
import { afterEach, describe, expect, it } from 'vitest'
import { ORPCError } from '@orpc/client'
import { ValidationError } from '@orpc/server'
import { contract } from '../../src/contract/index.ts'
import { refusals } from '../../src/contract/refusals.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { Database } from '../../src/server/db/database.ts'
import { apiVersion, openApiDocument, withPlainWords } from '../../src/server/http/api.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from './idle-jobs.ts'

/*
  The API's HTTP behaviour that needs no database: sign-in, input validation, typed errors,
  output validation and the generated files. The integration tests run the operations against
  PostgreSQL.
*/

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'))

describe('files generated from the contract', () => {
  it('are up to date (run `npm run api:generate` after changing src/contract)', async () => {
    expect(await readJson('docs/api/openapi.json')).toEqual(
      JSON.parse(JSON.stringify(await openApiDocument())),
    )
    expect(await readJson('src/web/api/contract.json')).toEqual(
      JSON.parse(JSON.stringify(minifyContractRouter(contract))),
    )
  })

  it('name the contract by the digest of the OpenAPI document as written', async () => {
    const written = await readFile(new URL('../../docs/api/openapi.json', import.meta.url))
    const { createHash } = await import('node:crypto')
    expect(await apiVersion()).toBe(createHash('sha256').update(written).digest('hex').slice(0, 16))
  })
})

const maria = { id: '00000000-0000-4000-8000-000000000001', name: 'Maria Lindqvist' }

/** Maria as the sign-in reads her: with the roles she holds (none) and her session's token. */
const principal = { ...maria, roles: [], assignments: [] }

/** Answers the sign-in lookup with Maria, and every other query with `rows`. */
function database(rows: object[] = []): Database {
  return {
    transaction: (_person, work) => work(database(rows)),
    ping: () => Promise.resolve(),
    query: <Row extends object>(text: string) =>
      Promise.resolve(
        (text.includes('from auth.sessions')
          ? [{ personId: maria.id, csrfToken: 'csrf', ...principal }]
          : text.includes('from people')
            ? [principal]
            : rows) as Row[],
      ),
    close: () => Promise.resolve(),
  }
}

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

function app(options: { rows?: object[]; signedIn?: boolean } = {}) {
  const lines: string[] = []
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString().trim().split('\n'))
      done()
    },
  })
  const instance = buildApp({
    database: database(options.rows),
    jobs: idleJobs(),
    logger: createLogger({ level: 'info', destination }),
    clock: systemClock('2026-10-07'),
    devPeople: [],
  })
  instance.addHook('onRequest', (request, _reply, done) => {
    if (options.signedIn !== false) request.headers.cookie = 'heed_session=' + 'a'.repeat(64)
    done()
  })
  close = () => instance.close()
  return { instance, lines }
}

describe('a refusal without words of its own', () => {
  it("says the plain default for its code, never the library's English", () => {
    const forbidden = withPlainWords(new ORPCError('FORBIDDEN', { defined: true }))
    expect(forbidden).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      defined: true,
      message: refusals.forbidden,
    })
    const invalid = withPlainWords(
      new ORPCError('BAD_REQUEST', {
        message: 'Input validation failed',
        cause: new ValidationError({ message: 'Input validation failed', issues: [] }),
      }),
    )
    expect(invalid).toMatchObject({ code: 'BAD_REQUEST', message: refusals.badRequest })
  })

  it('keeps its own words, a code with no default and any other error', () => {
    const own = new ORPCError('NOT_FOUND', { message: "We couldn't find this domain." })
    expect(withPlainWords(own)).toBe(own)
    const unprocessable = new ORPCError('UNPROCESSABLE_CONTENT')
    expect(withPlainWords(unprocessable)).toBe(unprocessable)
    const other = new Error('boom')
    expect(withPlainWords(other)).toBe(other)
  })
})

describe('the API over HTTP', () => {
  it('answers 401 when nobody is signed in', async () => {
    const { instance } = app({ signedIn: false })
    const response = await instance.inject({ method: 'GET', url: '/api/v1/me' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      code: 'UNAUTHORIZED',
      defined: true,
      message: refusals.signedOut,
    })
  })

  it('serves the signed-in person with initials', async () => {
    const { instance } = app()
    const response = await instance.inject({ method: 'GET', url: '/api/v1/me' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ...maria,
      initials: 'ML',
      permissions: { roles: [], assignments: [] },
    })
  })

  it('reads numbers and filters from the query string, and refuses invalid ones', async () => {
    const { instance } = app()
    const ok = await instance.inject({
      method: 'GET',
      url: '/api/v1/proposals?limit=5&offset=2&state=draft&own=true',
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ rows: [], total: 0, limit: 5, offset: 2 })
    for (const query of ['limit=0', 'limit=101', 'offset=-1', 'state=memo', 'own=maybe']) {
      const response = await instance.inject({ method: 'GET', url: `/api/v1/proposals?${query}` })
      expect(response.statusCode, query).toBe(400)
      expect(response.json(), query).toMatchObject({
        code: 'BAD_REQUEST',
        message: refusals.badRequest,
      })
    }
  })

  it('answers NOT_FOUND for an unknown item and an unknown operation', async () => {
    const { instance } = app()
    const item = await instance.inject({ method: 'GET', url: '/api/v1/items/itm_missing0/page' })
    expect(item.statusCode).toBe(404)
    expect(item.json()).toMatchObject({
      code: 'NOT_FOUND',
      defined: true,
      message: refusals.notFound,
    })
    const operation = await instance.inject({ method: 'GET', url: '/api/v1/nothing' })
    expect(operation.statusCode).toBe(404)
    expect(operation.json()).toEqual({ code: 'NOT_FOUND', message: 'No such API operation' })
  })

  it('refuses to send a reply the contract does not allow, and logs it without details', async () => {
    const { instance, lines } = app({
      rows: [{ id: 'area_broken01', name: 'Broken', summary: 42 }],
    })
    const response = await instance.inject({ method: 'GET', url: '/api/v1/areas' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ message: refusals.failed })
    expect(response.body).not.toContain('area_broken01')
    expect(lines.some((line) => line.includes('API operation failed'))).toBe(true)
    // The log names the field that broke the contract, never its value.
    const fault = lines.find((line) => line.includes('API answer broke the contract'))
    expect(fault).toBeDefined()
    expect((JSON.parse(fault!) as { faults: unknown[] }).faults).toContainEqual({
      path: '*.summary',
      code: 'invalid_type',
      count: 1,
    })
    expect(fault).not.toContain('area_broken01')
  })

  it('names the contract it speaks on every answer, refusals too', async () => {
    const { instance } = app({ signedIn: false })
    for (const url of ['/api/v1/me', '/api/v1/auth/people']) {
      const response = await instance.inject({ method: 'GET', url })
      expect(response.headers['x-heed-api'], url).toBe(await apiVersion())
    }
  })

  it('publishes the OpenAPI document', async () => {
    const { instance } = app({ signedIn: false })
    const response = await instance.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    expect(response.statusCode).toBe(200)
    const document = response.json<{ openapi: string; paths: Record<string, unknown> }>()
    expect(document.openapi).toMatch(/^3\./)
    expect(Object.keys(document.paths).sort()).toEqual([
      '/access-keys',
      '/agent-connections',
      '/agent-connections/{id}/disconnect',
      '/alerts/raised',
      '/alerts/rules',
      '/alerts/rules/{rule}',
      '/alerts/rules/{rule}/mute',
      '/archived-areas',
      '/areas',
      '/areas/{areaId}/owners',
      '/areas/{id}/delete',
      '/areas/{id}/description',
      '/ask/asked',
      '/ask/lookup',
      '/assignments/grant',
      '/assignments/revoke',
      '/audit',
      '/audit/export',
      '/audit/verify',
      '/auth/methods',
      '/auth/people',
      '/auth/session',
      '/auth/sign-in',
      '/auth/sign-out',
      '/catalogue',
      '/clients',
      '/clients/{label}',
      '/comments',
      '/comments/mentions/read',
      '/comments/threads/read',
      '/comments/{id}',
      '/comments/{id}/withdraw',
      '/connect',
      '/connect/pending',
      '/connections',
      '/connections/request',
      '/connections/request/decision',
      '/connections/{id}/disconnect',
      '/context/changes',
      '/context/deleted',
      '/decisions/undo',
      '/definitions/related',
      '/drafts/from-text',
      '/editions',
      '/editions/{label}/export',
      '/editions/{label}/rollback',
      '/editions/{label}/rollback-preview',
      '/evals/import',
      '/evals/runs',
      '/evals/runs/{id}',
      '/evals/runs/{id}/approve',
      '/evals/runs/{id}/cancel',
      '/evals/runs/{id}/resume',
      '/figures',
      '/figures/read',
      '/figures/{id}',
      '/figures/{id}/try',
      '/gaps/{id}',
      '/imports',
      '/inbox/cards/decide',
      '/inbox/cards/read',
      '/inbox/feed',
      '/invites',
      '/invites/lookup',
      '/invites/{id}/resend',
      '/invites/{id}/revoke',
      '/items/bulk',
      '/items/publish',
      '/items/{id}/page',
      '/items/{id}/read',
      '/items/{id}/related',
      '/items/{id}/restore-draft',
      '/items/{id}/retire-proposals',
      '/library',
      '/me',
      '/members',
      '/members/{personId}/activity',
      '/members/{personId}/remove',
      '/members/{personId}/restore',
      '/members/{personId}/role',
      '/observability/agents',
      '/observability/feedback',
      '/observability/replay',
      '/observability/usage',
      '/observability/views',
      '/observability/views/{id}',
      '/operations',
      '/operations/jobs/{job}/run',
      '/people',
      '/proposals',
      '/proposals/{id}',
      '/proposals/{id}/submit',
      '/proposals/{id}/withdraw',
      '/reactions/toggle',
      '/reports',
      '/reports/mine',
      '/review/publish-read',
      '/review/sheets',
      '/review/{id}/close',
      '/review/{id}/publish',
      '/review/{id}/read',
      '/review/{id}/return',
      '/review/{id}/sheet',
      '/roles/grant',
      '/roles/revoke',
      '/saved-questions',
      '/saved-questions/check',
      '/saved-questions/status',
      '/saved-questions/{id}',
      '/saved-questions/{id}/keep',
      '/schema/item',
      '/search',
      '/serving/stops',
      '/settings',
      '/settings/{key}',
      '/setup',
      '/sources',
      '/sources/test',
      '/sources/types',
      '/sources/{id}',
      '/sources/{id}/activity',
      '/sources/{id}/disconnect',
      '/sources/{id}/paused',
      '/sources/{id}/read',
      '/terms',
      '/terms/delete',
      '/terms/deleted',
      '/terms/move',
      '/terms/restore',
      '/terms/{id}',
      '/terms/{id}/history',
      '/tools/{tool}',
      '/try-it/read',
      '/vocabulary',
      '/workspace',
    ])
  })
})
