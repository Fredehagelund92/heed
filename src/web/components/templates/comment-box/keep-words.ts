import { toast } from 'sonner'

/**
 * A post, a reply or an edit as the composer sends it: the composer keeps the words until this
 * settles. When the service refuses, the toast says what was not saved and that the words are
 * still in the box, and the failure goes on so the composer neither clears nor closes.
 */
export async function keepWords(run: () => Promise<unknown>, wasnt: string) {
  try {
    await run()
  } catch (failure) {
    toast.error(wasnt, { description: 'Your words are still in the box. Try again.' })
    throw failure
  }
}
