import type { DomainId } from '@/model/items'
import type { Review } from '@/model/review'
import type { SavedQuestion } from '@/model/saved-questions'
import { checkDraft } from '@/lib/saved-check'
import { savedSeed } from './data/saved-questions'

// The mock's saved questions, kept until the page reloads. One list for every count of them.

/** How long the mock takes to check one saved question. */
const CHECK_ONE_MS = 130

export function createSaved() {
  let list: SavedQuestion[] = savedSeed
  // Where the check stands, and when the saved questions were last checked.
  let progress: { run: 'idle' | 'running'; checked: number; total: number } = {
    run: 'idle',
    checked: 0,
    total: 0,
  }
  let checkedAt = 'Today, 09:41'

  const setResult = (id: string, r: Pick<SavedQuestion, 'result' | 'why' | 'when' | 'diff'>) => {
    list = list.map((q) => (q.id === id ? { ...q, ...r } : q))
  }

  const save = (q: Omit<SavedQuestion, 'result' | 'why' | 'when' | 'id'>) => {
    const id = `sq-${list.length + 1}-${q.question
      .toLowerCase()
      .replace(/[^a-z]+/g, '-')
      .slice(0, 24)}`
    list = [
      {
        ...q,
        id,
        result: 'same',
        why: 'Just saved: it is checked again after the next change.',
        when: 'Just now',
      },
      ...list,
    ]
    return id
  }

  const remove = (id: string) => {
    list = list.filter((q) => q.id !== id)
  }

  return {
    list: () => list,
    save,
    remove,
    setResult,
    progress: () => progress,
    checkedAt: () => checkedAt,

    /** Check now: one saved question at a time, the mock's answers staying as they are. */
    async check(domain?: DomainId) {
      const ids = list.filter((q) => !domain || q.domain === domain).map((q) => q.id)
      progress = { run: 'running', checked: 0, total: ids.length }
      for (let n = 1; n <= ids.length; n++) {
        await new Promise((resolve) => setTimeout(resolve, CHECK_ONE_MS))
        progress = { ...progress, checked: n }
      }
      list = list.map((q) => (ids.includes(q.id) ? { ...q, when: 'Just now' } : q))
      progress = { run: 'idle', checked: 0, total: 0 }
      checkedAt = 'Just now'
      return { checked: ids.length }
    },

    /** Keep the new answer: what it says now becomes what it should say. Undo puts the result back. */
    keepNew(id: string) {
      const q = list.find((x) => x.id === id)
      if (!q) return () => {}
      const was = { result: q.result, why: q.why, when: q.when, diff: q.diff }
      setResult(id, {
        result: 'same',
        why: 'The new answer is kept as the saved one.',
        when: 'Just now',
        diff: undefined,
      })
      return () => setResult(id, was)
    },

    /**
     * After a publish: store what the draft showed, and save a gap's question if asked. Gives back
     * what takes it all back, for Undo.
     */
    afterPublish(
      r: Review,
      me: string,
      itemId: string | undefined,
      domain: DomainId,
      saveQuestion: boolean,
    ): () => void {
      const undo: (() => void)[] = []
      const check = checkDraft(r, list, itemId)
      for (const x of check?.results ?? []) {
        if (x.result === 'same') continue
        const was = { result: x.q.result, why: x.q.why, when: x.q.when, diff: x.q.diff }
        setResult(
          x.q.id,
          x.result === 'changed'
            ? {
                result: 'same',
                why: 'This publish is its new saved answer.',
                when: 'Just now',
                diff: undefined,
              }
            : {
                result: 'look',
                why: x.why,
                when: 'Just now',
                diff: { saved: x.before, now: x.now },
              },
        )
        undo.push(() => setResult(x.q.id, was))
      }
      if (r.drafted && saveQuestion && itemId) {
        const id = save({
          question: `What happened to ${r.drafted.scope}?`,
          domain,
          savedBy: me,
          expect: 'Checked, from the item this draft became.',
          factId: itemId,
        })
        undo.push(() => remove(id))
      }
      return () => undo.forEach((u) => u())
    },
  }
}

export type MockSaved = ReturnType<typeof createSaved>
