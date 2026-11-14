// Where a read stands, worked out once for the screen that shows it (#198): still loading, failed
// with a way to read again, missing (it answered, and there is nothing there), or ready with its
// data. A refresh that fails keeps what was read, so it is still ready; a failed read being tried
// again is loading.

export type Read<T> =
  | { state: 'loading' }
  | { state: 'failed'; retry: () => void }
  | { state: 'missing' }
  | { state: 'ready'; data: T }

/** What readOf needs of a read: TanStack Query's own states. */
export type ReadQuery<T> = {
  data: T | undefined
  isError: boolean
  isFetching: boolean
  refetch: () => unknown
}

/**
 * The one state of `q`. A read that answers null is missing, and so is one `isMissing` says has
 * nothing in it.
 */
export function readOf<T>(
  q: ReadQuery<T>,
  isMissing: (data: NonNullable<T>) => boolean = () => false,
): Read<NonNullable<T>> {
  if (q.data !== undefined) {
    if (q.data === null || isMissing(q.data)) return { state: 'missing' }
    return { state: 'ready', data: q.data }
  }
  if (q.isError && !q.isFetching) return { state: 'failed', retry: () => void q.refetch() }
  return { state: 'loading' }
}
