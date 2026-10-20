import { afterEach, describe, expect, it } from 'vitest'
import built from '@/api/api-version.json'
import { outdatedSide, resetOutdated } from '@/api/api-version'
import { ApiError } from '@/api/errors'
import { createHttpApi } from '@/api/http-api'
import { refusals } from '../../src/contract/refusals.ts'
import type { PersonalLists } from '@/api/client'

/*
  The http binding against a scripted service: what it sends with a change (the CSRF token and
  the retry key), what it does when an answer is lost or the token is refused, and how refusals
  reach the app. The binding against the real service is tested in tests/integration.
*/

const personal: PersonalLists = {
  listFavorites: () => [],
  setFavorite: () => [],
  listRecent: () => [],
  recordVisit: () => [],
}

const proposal = {
  id: '00000000-0000-4000-8000-000000000001',
  number: 1,
  action: 'create',
  state: 'submitted',
  areaId: 'area_sandbox',
  itemId: 'itm_mock000001',
  itemVersionId: '00000000-0000-4000-8000-000000000002',
  proposerId: 'per_maria',
  channel: 'form',
  revision: 2,
  draft: {},
  findings: [],
  claimedBy: null,
  dueAt: null,
  createdAt: '2026-10-07T12:00:00.000Z',
  updatedAt: '2026-10-07T12:00:00.000Z',
}

const session = (csrfToken: string) => ({
  person: {
    id: 'per_maria',
    name: 'Maria Lindqvist',
    initials: 'ML',
    permissions: { roles: [], assignments: [] },
  },
  csrfToken,
})

type Sent = { method: string; path: string; headers: Headers; body: unknown }
type Answer = Response | Error

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A service that answers each request with the next scripted answer for its path. */
function scripted(answers: Record<string, Answer[]>) {
  const sent: Sent[] = []
  let keys = 0
  const api = createHttpApi({
    baseUrl: 'http://heed.test/api/v1',
    personal,
    newKey: () => `key-${++keys}`,
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const path = new URL(request.url).pathname.replace('/api/v1', '')
      const text = await request.text()
      sent.push({
        method: request.method,
        path,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      const answer = answers[path]?.shift()
      if (!answer) throw new Error(`No scripted answer for ${request.method} ${path}`)
      if (answer instanceof Error) throw answer
      return answer
    },
  })
  return { api, sent, writes: () => sent.filter((request) => request.method !== 'GET') }
}

const submit = { id: proposal.id, revision: 1 }
const submitPath = `/proposals/${proposal.id}/submit`

describe('the http binding', () => {
  it('reads the CSRF token from the session once and sends it with every change', async () => {
    const { api, sent } = scripted({
      '/auth/session': [json(200, session('token-a'))],
      [submitPath]: [json(200, proposal), json(200, proposal)],
    })
    await api.submitProposal(submit)
    await api.submitProposal({ ...submit, revision: 2 })
    expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /auth/session',
      `POST ${submitPath}`,
      `POST ${submitPath}`,
    ])
    expect(sent[1]!.headers.get('x-heed-csrf')).toBe('token-a')
    expect(sent[2]!.headers.get('x-heed-csrf')).toBe('token-a')
  })

  it('keeps the retry key when an answer is lost, and makes a new one after an answer', async () => {
    const { api, writes } = scripted({
      '/auth/session': [json(200, session('token-a'))],
      [submitPath]: [
        new TypeError('Failed to fetch'),
        json(503, { defined: false, code: 'SERVICE_UNAVAILABLE', status: 503, message: 'Busy' }),
        json(200, proposal),
        json(200, proposal),
      ],
    })
    const lost = await api.submitProposal(submit).catch((error: unknown) => error)
    expect(lost).toBeInstanceOf(ApiError)
    expect(lost).toMatchObject({ kind: 'unavailable', retryable: true })
    await expect(api.submitProposal(submit)).rejects.toMatchObject({ kind: 'unavailable' })
    await api.submitProposal(submit)
    // Applied: the same request again is a new change, with a new key.
    await api.submitProposal(submit)
    expect(writes().map((request) => request.headers.get('idempotency-key'))).toEqual([
      'key-1',
      'key-1',
      'key-1',
      'key-2',
    ])
  })

  it('gives a different change its own key, and drops the key after a refusal', async () => {
    const { api, writes } = scripted({
      '/auth/session': [json(200, session('token-a'))],
      [submitPath]: [
        json(409, {
          defined: true,
          code: 'CONFLICT',
          status: 409,
          message:
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
        }),
        json(200, proposal),
        json(200, proposal),
      ],
    })
    await expect(api.submitProposal(submit)).rejects.toMatchObject({ kind: 'conflict' })
    await api.submitProposal(submit)
    await api.submitProposal({ ...submit, revision: 7 })
    expect(writes().map((request) => request.headers.get('idempotency-key'))).toEqual([
      'key-1',
      'key-2',
      'key-3',
    ])
  })

  it('reads a refused CSRF token again once, and retries with the same retry key', async () => {
    const refused = {
      defined: true,
      code: 'FORBIDDEN',
      status: 403,
      message: refusals.csrf,
    }
    const { api, sent } = scripted({
      '/auth/session': [json(200, session('old')), json(200, session('new'))],
      [submitPath]: [json(403, refused), json(200, proposal)],
    })
    await api.getSession()
    expect(await api.submitProposal(submit)).toMatchObject({ id: proposal.id })
    const posts = sent.filter((request) => request.method === 'POST')
    expect(posts.map((request) => request.headers.get('x-heed-csrf'))).toEqual(['old', 'new'])
    expect(posts.map((request) => request.headers.get('idempotency-key'))).toEqual([
      'key-1',
      'key-1',
    ])
  })

  it('does not retry any other refusal', async () => {
    const { api, writes } = scripted({
      '/auth/session': [json(200, session('token-a'))],
      [submitPath]: [
        json(403, {
          defined: true,
          code: 'FORBIDDEN',
          status: 403,
          message: 'Only an owner of the domain can do this.',
        }),
      ],
    })
    await expect(api.submitProposal(submit)).rejects.toMatchObject({
      kind: 'forbidden',
      message: 'Only an owner of the domain can do this.',
    })
    expect(writes()).toHaveLength(1)
  })

  it('hands the screen what a refusal carries: the current proposal, findings, the gate', async () => {
    const finding = { code: 'format', field: 'evidence', message: 'Too small', severity: 'error' }
    const gate = {
      required: ['format'],
      levels: [{ level: 'format', outcome: 'failed', ranAt: null, details: {} }],
      approvals: { owner: false, approver: null },
      problem: 'a required check has not passed',
    }
    const { api } = scripted({
      '/auth/session': [json(200, session('token-a'))],
      [`/proposals/${proposal.id}/draft`]: [
        json(409, {
          defined: true,
          code: 'CONFLICT',
          status: 409,
          message:
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
          data: { current: proposal },
        }),
      ],
      [submitPath]: [
        json(422, {
          defined: true,
          code: 'UNPROCESSABLE_CONTENT',
          status: 422,
          message: 'Fix the problems shown before you send it for review.',
          data: { findings: [finding] },
        }),
      ],
      [`/proposals/${proposal.id}/decisions`]: [
        json(422, {
          defined: true,
          code: 'UNPROCESSABLE_CONTENT',
          status: 422,
          message: 'Every required check must pass before you accept it.',
          data: { gate },
        }),
      ],
    })
    await expect(api.saveDraft({ ...submit, draft: {} })).rejects.toMatchObject({
      kind: 'conflict',
      status: 409,
      current: { id: proposal.id, revision: 2 },
    })
    await expect(api.submitProposal(submit)).rejects.toMatchObject({
      kind: 'invalid',
      findings: [finding],
    })
    await expect(
      api.decide({ ...submit, outcome: 'accept', reason: 'Checked' }),
    ).rejects.toMatchObject({ kind: 'invalid', gate })
  })

  it('answers null for an unknown proposal and says when nobody is signed in', async () => {
    const { api } = scripted({
      [`/proposals/${proposal.id}`]: [
        json(404, { defined: true, code: 'NOT_FOUND', status: 404, message: 'Not Found' }),
      ],
      '/library': [
        json(401, {
          defined: true,
          code: 'UNAUTHORIZED',
          status: 401,
          message: 'Sign in to read the library',
        }),
      ],
    })
    expect(await api.getProposal(proposal.id)).toBeNull()
    await expect(api.listLibrary()).rejects.toMatchObject({ kind: 'signed-out', status: 401 })
  })

  it('signs out with the CSRF token and forgets it', async () => {
    const { api, sent } = scripted({
      '/auth/session': [json(200, session('token-a')), json(200, session('token-b'))],
      '/auth/sign-out': [json(200, { signedOut: true })],
      [submitPath]: [json(200, proposal)],
    })
    await api.signOut()
    await api.submitProposal(submit)
    expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /auth/session',
      'POST /auth/sign-out',
      'GET /auth/session',
      `POST ${submitPath}`,
    ])
    expect(sent[1]!.headers.get('x-heed-csrf')).toBe('token-a')
    expect(sent[3]!.headers.get('x-heed-csrf')).toBe('token-b')
  })
})

describe('a service that runs other code than the app', () => {
  afterEach(resetOutdated)
  const named = (status: number, body: unknown, api: string) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-heed-api': api },
    })
  const failed = { defined: false, code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'Boom' }

  it('turns a failure into outdated, which a retry does not help, and a signed-out stays', async () => {
    const { api } = scripted({
      '/proposals': [named(500, failed, 'other0000000000')],
      '/catalogue': [
        named(401, { defined: true, code: 'UNAUTHORIZED', status: 401 }, 'other0000000000'),
      ],
    })
    const error = await api.listProposals().catch((caught: unknown) => caught)
    expect(error).toMatchObject({ kind: 'outdated', retryable: false, status: 500 })
    expect(outdatedSide()).not.toBeNull()
    await expect(api.listCatalogue()).rejects.toMatchObject({ kind: 'signed-out' })
  })

  it('keeps the retry key of a change whose answer was lost while outdated', async () => {
    const { api, writes } = scripted({
      '/auth/session': [json(200, session('token-a'))],
      [submitPath]: [named(500, failed, 'other0000000000'), json(200, proposal)],
    })
    await expect(api.submitProposal(submit)).rejects.toMatchObject({ kind: 'outdated' })
    await api.submitProposal(submit)
    expect(writes().map((request) => request.headers.get('idempotency-key'))).toEqual([
      'key-1',
      'key-1',
    ])
  })

  it('reads a failure as before when the service names the contract of the app', async () => {
    const { api } = scripted({ '/proposals': [named(500, failed, built.api)] })
    await expect(api.listProposals()).rejects.toMatchObject({ kind: 'unavailable', status: 500 })
    expect(outdatedSide()).toBeNull()
  })
})
