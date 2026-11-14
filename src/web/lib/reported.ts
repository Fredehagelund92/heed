import { useMutation } from '@tanstack/react-query'
import { isSignedOut, toApiError } from '@/api/errors'

// A write the screen reports, as one machine: idle, then sending while the service has not
// answered (the form keeps what was typed and a dialog stays open), then done, said once and only
// here, or failed, with the service's reason and the input still there for another try. A session
// that ended is the app's to handle (it opens sign-in), so it is not said here.

export type ReportedState = 'idle' | 'sending' | 'done' | 'failed'

/**
 * `act` sends the write; `done` gets its result, to say so (a toast, the dialog's next step) and
 * to clear or close. While it is sending a second `act` sends nothing. `problem` is what went
 * wrong in a sentence: `wasnt` (what did not happen), then the service's reason.
 */
export function useReported<T>({ wasnt, done }: { wasnt: string; done: (result: T) => void }) {
  const mutation = useMutation({ mutationFn: (run: () => Promise<T>) => run(), onSuccess: done })
  const state: ReportedState = mutation.isPending
    ? 'sending'
    : mutation.isError
      ? 'failed'
      : mutation.isSuccess
        ? 'done'
        : 'idle'
  const problem =
    mutation.error && !isSignedOut(mutation.error)
      ? `${wasnt} ${toApiError(mutation.error).message}`
      : null
  const act = (run: () => Promise<T>) => {
    if (!mutation.isPending) mutation.mutate(run)
  }
  return { state, result: mutation.data, problem, act, reset: mutation.reset }
}
