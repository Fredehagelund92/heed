import { ORPCError } from '@orpc/client'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, describeApiError, toApiError, type ApiErrorKind } from '@/api/errors'
import { createQueryClient, retryUnanswered } from '@/api/query-client'

describe('the error mapping', () => {
  it.each([
    ['UNAUTHORIZED', 'signed-out'],
    ['FORBIDDEN', 'forbidden'],
    ['NOT_FOUND', 'not-found'],
    ['CONFLICT', 'conflict'],
    ['UNPROCESSABLE_CONTENT', 'invalid'],
    ['PRECONDITION_FAILED', 'precondition'],
    ['BAD_REQUEST', 'bad-request'],
    ['TOO_MANY_REQUESTS', 'unavailable'],
    ['INTERNAL_SERVER_ERROR', 'unavailable'],
    ['SERVICE_UNAVAILABLE', 'unavailable'],
  ] as const)('maps %s to %s', (code, kind) => {
    const error = toApiError(new ORPCError(code, { message: 'Refused' }))
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe(kind)
    expect(error.message).toBe('Refused')
    expect(error.retryable).toBe(kind === 'unavailable')
  })

  it('keeps what a refusal carries for the screen', () => {
    const current = { id: 'p', revision: 4 }
    const finding = { code: 'format', field: 'title', message: 'Too long', severity: 'error' }
    const gate = { required: [], levels: [], approvals: { owner: false, approver: null } }
    expect(toApiError(new ORPCError('CONFLICT', { data: { current } })).current).toEqual(current)
    expect(
      toApiError(new ORPCError('UNPROCESSABLE_CONTENT', { data: { findings: [finding], gate } })),
    ).toMatchObject({ findings: [finding], gate })
    expect(toApiError(new ORPCError('CONFLICT')).findings).toEqual([])
  })

  it('treats anything without a status as no answer', () => {
    expect(toApiError(new TypeError('Failed to fetch'))).toMatchObject({
      kind: 'unavailable',
      message: 'Failed to fetch',
    })
    expect(toApiError('lost')).toMatchObject({ kind: 'unavailable' })
    const known = new ApiError('forbidden', 'No')
    expect(toApiError(known)).toBe(known)
  })

  it('has plain words for every kind, without codes or ids', () => {
    const kinds: ApiErrorKind[] = [
      'signed-out',
      'forbidden',
      'not-found',
      'conflict',
      'invalid',
      'precondition',
      'bad-request',
      'unavailable',
    ]
    for (const kind of kinds) {
      const { title, description } = describeApiError(new ApiError(kind, 'CONFLICT 409 xyz'))
      expect(title).not.toMatch(/\d{3}|[A-Z]{3,}|_/)
      expect(description).toMatch(/\.$/)
    }
    expect(describeApiError(new ApiError('signed-out', '')).title).toBe("You're signed out")
  })
})

describe('the query client', () => {
  const refuse = (kind: ApiErrorKind) => () => Promise.reject(new ApiError(kind, kind))

  it('opens the signed-out page for a 401 from a read or a change, and tries neither again', async () => {
    const onSignedOut = vi.fn()
    const client = createQueryClient({ onSignedOut })
    const read = vi.fn(refuse('signed-out'))
    await expect(client.fetchQuery({ queryKey: ['x'], queryFn: read })).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(1)
    expect(onSignedOut).toHaveBeenCalledTimes(1)

    const write = vi.fn(refuse('signed-out'))
    const mutation = client.getMutationCache().build(client, { mutationFn: write })
    await expect(mutation.execute(undefined)).rejects.toThrow()
    expect(write).toHaveBeenCalledTimes(1)
    expect(onSignedOut).toHaveBeenCalledTimes(2)
  })

  it('tries again only when no answer came, up to the limit', () => {
    const retry = retryUnanswered(1)
    expect(retry(0, new ApiError('unavailable', 'Lost'))).toBe(true)
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(retry(1, new ApiError('unavailable', 'Lost'))).toBe(false)
    for (const kind of ['signed-out', 'forbidden', 'not-found', 'conflict', 'invalid'] as const)
      expect(retry(0, new ApiError(kind, kind))).toBe(false)
  })
})
