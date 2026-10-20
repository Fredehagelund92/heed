/**
 * One error shape for both API bindings. The service answers with a status and, for some
 * refusals, data the screen needs: the current proposal on a conflict, the findings or the
 * gate on a refused input. `toApiError` turns whatever a call threw into an `ApiError`, so a
 * screen branches on `kind` and never on a status number or a library's error class.
 */
import type * as z from 'zod/mini'
import type { blockedVersionSchema } from '../../contract/editions.ts'
import type { ProposalRecord } from '../../contract/proposals.ts'
import type { Gate } from '../../contract/review.ts'

export type Finding = {
  code: string
  field: string
  message: string
  severity: 'error' | 'warning'
}

/** A version that cannot be served again, which a refused go back names (FR-205, FR-217). */
export type Blocked = z.infer<typeof blockedVersionSchema>

export type ApiErrorKind =
  /** 401: no session, or it ended. The app shows the signed-out page. */
  | 'signed-out'
  /** 403: the person may not do this. `message` says why. */
  | 'forbidden'
  /** 404: it does not exist, or the person may not see it. */
  | 'not-found'
  /**
   * 409: someone changed it first. `current` holds the proposal as it is now, when sent; a
   * refused go back names the versions that cannot be served again in `blocked`.
   */
  | 'conflict'
  /** 422: the input has problems. `findings` or `gate` say which. */
  | 'invalid'
  /** 412: something must exist first, such as a live edition. */
  | 'precondition'
  /** 400: the request itself was malformed. A bug in the app, not something a person fixes. */
  | 'bad-request'
  /** No answer, a timeout, a 5xx or a 429. Worth trying again with the same retry key. */
  | 'unavailable'
  /**
   * The service runs other code than the app was built from (api-version.ts): one of them was not
   * started again after an update. Trying again does not help until it is.
   */
  | 'outdated'

/** The kinds an answer's status says; `outdated` comes from the contract the service names. */
export type StatusKind = Exclude<ApiErrorKind, 'outdated'>

export type ApiErrorDetails = {
  status?: number
  current?: ProposalRecord
  findings?: Finding[]
  gate?: Gate
  blocked?: Blocked[]
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  readonly current: ProposalRecord | undefined
  readonly findings: Finding[]
  readonly gate: Gate | undefined
  readonly blocked: Blocked[] | undefined

  constructor(kind: ApiErrorKind, message: string, details: ApiErrorDetails = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = details.status
    this.current = details.current
    this.findings = details.findings ?? []
    this.gate = details.gate
    this.blocked = details.blocked
  }

  /** True when the same request may succeed later, so a retry keeps its retry key. */
  get retryable(): boolean {
    return this.kind === 'unavailable'
  }
}

const kindOfStatus = (status: number): StatusKind =>
  status === 401
    ? 'signed-out'
    : status === 403
      ? 'forbidden'
      : status === 404
        ? 'not-found'
        : status === 409
          ? 'conflict'
          : status === 422
            ? 'invalid'
            : status === 412
              ? 'precondition'
              : status === 429 || status >= 500
                ? 'unavailable'
                : 'bad-request'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads an error from either binding: an `ApiError` passes through; an oRPC error is mapped by
 * its status and data; anything else (a failed fetch, a thrown string) means no answer.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (isRecord(error) && typeof error.status === 'number' && typeof error.message === 'string') {
    const data = isRecord(error.data) ? error.data : {}
    return new ApiError(kindOfStatus(error.status), error.message, {
      status: error.status,
      ...(isRecord(data.current) ? { current: data.current as ProposalRecord } : {}),
      ...(Array.isArray(data.findings) ? { findings: data.findings as Finding[] } : {}),
      ...(isRecord(data.gate) ? { gate: data.gate as Gate } : {}),
      ...(Array.isArray(data.blocked) ? { blocked: data.blocked as Blocked[] } : {}),
    })
  }
  const message = error instanceof Error ? error.message : "We didn't get an answer."
  return new ApiError('unavailable', message)
}

export const isSignedOut = (error: unknown) =>
  error instanceof ApiError && error.kind === 'signed-out'

/**
 * Plain words for a refusal (NFR-016): what happened and one next step, without ids, codes or
 * database words. A screen may say more, for example by naming the field a finding is about.
 */
export function describeApiError(error: unknown): { title: string; description: string } {
  const { kind } = toApiError(error)
  switch (kind) {
    case 'signed-out':
      return { title: "You're signed out", description: 'Sign in, then try again.' }
    case 'forbidden':
      return {
        title: "You can't do this",
        description: 'Ask the owner of the domain or an admin.',
      }
    case 'not-found':
      return {
        title: "We couldn't find this",
        description: 'It may have been deleted, or you may not have access.',
      }
    case 'conflict':
      return {
        title: 'Someone changed this first',
        description: 'Look at the latest version, then try again.',
      }
    case 'invalid':
      return {
        title: 'Some details need attention',
        description: 'Fix the problems shown, then try again.',
      }
    case 'precondition':
      return {
        title: "This isn't ready yet",
        description: 'Ask an admin to finish the setup.',
      }
    case 'bad-request':
      return {
        title: 'Something went wrong',
        description: "We couldn't read what the app sent. Reload the page, then try again.",
      }
    case 'unavailable':
      return failedOnServer(error)
        ? {
            title: 'Something went wrong on our side',
            description:
              'Nothing was changed. Try again, and tell the data team if it keeps happening.',
          }
        : {
            title: "We didn't get an answer",
            description: 'Check your connection, then try again.',
          }
    case 'outdated':
      return { title: 'The app was updated', description: toApiError(error).message }
  }
}

/** The service answered, with a failure of its own (500), rather than no answer at all. */
export const failedOnServer = (error: unknown) => toApiError(error).status === 500
