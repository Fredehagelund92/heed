/**
 * One error shape for both bindings of the app's API (client.ts). The http binding turns what the
 * service answered into an `ApiError`; the mock binding throws the same errors for the faults its
 * scenarios set up, so a screen handles a failure the same way whichever binding answered, and
 * branches on `kind`, never on a status number or a library's error class.
 */

export type ApiErrorKind =
  /** 401: no session, or it ended. The app shows the sign-in page. */
  | 'signed-out'
  /** 403: the person may not do this. `message` says why. */
  | 'forbidden'
  /** 404: it does not exist, or the person may not see it. */
  | 'not-found'
  /** 409: someone changed it first. */
  | 'conflict'
  /** 422: the input has problems. */
  | 'invalid'
  /** The service answered with a failure of its own (5xx or 429). */
  | 'failed'
  /** No answer at all: offline, a timeout, a connection that dropped. */
  | 'unanswered'
  /** The service this app talks to does not offer this yet (the http binding, until it is wired). */
  | 'not-available'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined

  constructor(kind: ApiErrorKind, message: string, details: { status?: number } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = details.status
  }

  /**
   * True when the same request may succeed if it is sent again at once: it got no answer. A
   * failure the service answered with is not tried again by itself; the person tries again.
   */
  get retryable(): boolean {
    return this.kind === 'unanswered'
  }
}

const kindOfStatus = (status: number): ApiErrorKind =>
  status === 401
    ? 'signed-out'
    : status === 403
      ? 'forbidden'
      : status === 404
        ? 'not-found'
        : status === 409
          ? 'conflict'
          : status === 422 || status === 400
            ? 'invalid'
            : 'failed'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads an error from either binding: an `ApiError` passes through; an answer with a status is
 * mapped by it; anything else (a failed fetch, a thrown string) means no answer.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (isRecord(error) && typeof error.status === 'number' && typeof error.message === 'string')
    return new ApiError(kindOfStatus(error.status), error.message, { status: error.status })
  const message = error instanceof Error ? error.message : "We didn't get an answer."
  return new ApiError('unanswered', message)
}

export const isSignedOut = (error: unknown) => toApiError(error).kind === 'signed-out'
