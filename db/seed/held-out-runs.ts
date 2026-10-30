import type { Queryable } from '../../src/server/db/database.ts'
import {
  estimateWithheld,
  goldenL1,
  runWithheld,
  type EvalDeps,
  type WithheldOptions,
} from '../../src/server/modules/evals/index.ts'
import type { Database } from '../../src/server/db/database.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { goldenQuestionSchema, type GoldenQuestion } from '../../src/domain/golden-question.ts'
import { toQuestion, type GoldenCase } from '../../src/domain/golden-set.ts'
import { openingKey, readHeldOut, runHeldOut, sealedFile, type HeldOutRun } from './held-out.ts'

/*
  The held-out cases through the golden L1 pass and the eval area runner (FR-525). A caller gets counts by type and never the cases: these functions open the sealed file
  themselves, and the code they hand a case to runs silenced (held-out.ts).
*/

/** The golden L1 pass of the held-out agent cases, on the live edition the caller reads. */
export const heldOutL1 = (
  tx: Queryable,
  env: NodeJS.ProcessEnv = process.env,
  file: URL | string = sealedFile,
) =>
  runHeldOut(
    (held) => held.cases,
    async (cases) => (await goldenL1(tx, cases)).map((r) => ({ id: r.id, passed: r.passed })),
    env,
    file,
  )

/** The held-out agent cases of an area, as the eval runner asks them: test questions. */
const ofArea = (area: string) => (held: { cases: GoldenCase[] }) =>
  held.cases.filter((c) => c.area === area)

/**
 * A case as a test question, when the open format holds it: one with a scope and no follow-up
 * turns. Null for the others, which count as skipped.
 */
function questionOf(c: GoldenCase): GoldenQuestion | null {
  if (!c.scope || c.turns?.length) return null
  const parsed = goldenQuestionSchema.safeParse(toQuestion(c))
  return parsed.success ? parsed.data : null
}

/** What a held-out area run would make and cost: counts and money only. */
export async function planHeldOutArea(
  database: Database,
  deps: EvalDeps,
  area: string,
  env: NodeJS.ProcessEnv = process.env,
  file: URL | string = sealedFile,
): Promise<
  | { ran: false; reason: string }
  | { ran: true; cases: number; runnable: number; edition: string | null; estimate: number }
> {
  const opened = await openingKey(env, file)
  if (!opened.ran) return opened
  const cases = ofArea(area)(await readHeldOut(opened.identity, file))
  const questions = cases.map(questionOf).filter((q): q is GoldenQuestion => q !== null)
  const { edition, costMicros } = await estimateWithheld(database, deps, questions)
  return {
    ran: true,
    cases: cases.length,
    runnable: questions.length,
    edition,
    estimate: costMicros,
  }
}

type AreaOptions = Omit<WithheldOptions, 'questions' | 'logger'>

/**
 * The held-out agent cases of an area through the eval area runner (runWithheld), in memory: no
 * cell, no transcript and no word of a case is kept or logged, and the run records only its model
 * calls, its cost and counts. A case the open format cannot hold is skipped.
 */
export async function heldOutArea(
  database: Database,
  deps: EvalDeps,
  options: AreaOptions,
  env: NodeJS.ProcessEnv = process.env,
  file: URL | string = sealedFile,
): Promise<
  HeldOutRun & {
    costMicros: number
    runId: string | null
    state: 'finished' | 'incomplete' | null
    stopped: string | null
    judging: { judged: number; errors: number }
  }
> {
  let outcome = {
    costMicros: 0,
    runId: null as string | null,
    state: null as 'finished' | 'incomplete' | null,
    stopped: null as string | null,
    judging: { judged: 0, errors: 0 },
  }
  const run = await runHeldOut(
    ofArea(options.area),
    async (cases) => {
      const asked = cases.flatMap((c) => {
        const question = questionOf(c)
        return question ? [{ id: c.id, question }] : []
      })
      if (!asked.length) return []
      const made = await runWithheld(database, deps, {
        ...options,
        questions: asked.map((a) => a.question),
        logger: createLogger({ level: 'silent' }),
      })
      outcome = {
        costMicros: made.costMicros,
        runId: made.runId,
        state: made.state,
        stopped: made.stopped,
        judging: made.judging,
      }
      return made.verdicts.map((verdict, i) => ({
        id: asked[i]!.id,
        passed: verdict === 'pass' ? true : verdict === 'fail' ? false : null,
      }))
    },
    env,
    file,
  )
  return { ...run, ...outcome }
}
