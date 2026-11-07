import { createHash } from 'node:crypto'

/*
  The held-back split (docs/evaluations.md): 40 development cases chosen by a fixed hash of their
  ids, so nobody chose them. They stay in the cases and run in every build, and a run reports them
  only as counts, by class: nobody working on Ask reads which of them failed, or tunes on them. A
  score on the rest says what it always said; this one says whether that score still predicts.
*/

export const HELD_BACK = 40

const orderOf = (id: string) => createHash('sha256').update(`held-back-1:${id}`).digest('hex')

/** Which of these case ids are held back: the same ones whatever order they are given in. */
export function heldBack(ids: readonly string[]): Set<string> {
  return new Set(
    [...new Set(ids)].sort((a, b) => (orderOf(a) < orderOf(b) ? -1 : 1)).slice(0, HELD_BACK),
  )
}
