import { toast } from 'sonner'
import { isSignedOut, toApiError } from '@/api/errors'
import { useWrite } from '@/api/queries'

// Every Undo goes through here, so a refusal is said, whichever screen offered it: the service
// holds an Undo for a window the admin sets, and it refuses a late one, or one whose card changed
// since. The offer on screen may outlast that window, so the answer is the person's to hear.

/**
 * Runs an Undo and says why the service refused it. Resolves to whether it was taken back, so the
 * caller says "Undone" and restores what it kept only then. A session that ended is the app's to
 * handle (it opens sign-in), so it is not said here.
 */
export async function takeBackBy(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return true
  } catch (error) {
    if (!isSignedOut(error))
      toast.error("Couldn't undo it", { description: toApiError(error).message })
    return false
  }
}

/** Takes back the decision a token stands for, saying so when the service refuses. */
export function useTakeBack() {
  const write = useWrite()
  return (token: string) => takeBackBy(() => write('undo', { token }))
}
