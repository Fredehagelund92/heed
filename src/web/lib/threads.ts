import { useChats, useWrite } from '@/api/queries'
import { useTakeBack } from '@/lib/undo'
import type { Answer, Thread } from '@/model/ask'

// The chats under Ask as the screens use them, from the shared chats read (src/web/api). Only the
// person's own chats in Ask: what agents ask is kept as scopes and counts, never as conversations.

export type { Day, Thread } from '@/model/ask'

export const useThreads = (): Thread[] => useChats()

export const findThread = (threads: Thread[], id: string | null | undefined) =>
  threads.find((t) => t.id === id)

/** Starting, renaming and deleting chats. */
export function useThreadActions() {
  const write = useWrite()
  const takeBack = useTakeBack()
  return {
    /** A chat the person just started, at the top of Today. */
    add: (id: string, question: string) => void write('saveChat', { id, question }),
    /** Ask's loop: keeps a chat's finished answers with it, so opening it asks nothing again. */
    keep: (id: string, question: string, answers: Answer[]) =>
      void write('saveChat', { id, question, answers }),
    rename: (id: string, title: string) => void write('renameChat', { id, title }),
    /** Deletes a chat; the token puts it back where it was. */
    remove: async (id: string) => (await write('deleteChat', { id })).undo,
    undo: (token: string) => void takeBack(token),
  }
}
