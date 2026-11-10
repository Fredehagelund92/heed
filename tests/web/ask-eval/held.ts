import { createHash } from 'node:crypto'
import { demoCases, heldIds } from '../../../src/server/modules/answer/index.ts'
import type { EvalCase } from './types.ts'

/*
  The held-back split: development cases a fixed hash chose, so nobody chose them. They run with
  the others and every report gives them only as counts: nobody building an answerer reads which
  failed or tunes on them, so a score on the others can be checked against them. A burned case of
  gates 2 and 3 keeps the split it already has (held-back.ts); the maintainer's own chats are never
  held; any other case is held when its hash falls in the first quarter, whatever other cases there
  are.
*/

const demoIds = new Set(demoCases.map((c) => c.id))

const inFirstQuarter = (id: string) =>
  parseInt(createHash('sha256').update(`ask-eval-held-1:${id}`).digest('hex').slice(0, 2), 16) < 64

/** Which of these cases are held back. */
export function heldOf(cases: readonly EvalCase[]): Set<string> {
  const old = heldIds()
  return new Set(
    cases
      .filter((c) =>
        demoIds.has(c.id) ? old.has(c.id) : c.source !== 'captain' && inFirstQuarter(c.id),
      )
      .map((c) => c.id),
  )
}
