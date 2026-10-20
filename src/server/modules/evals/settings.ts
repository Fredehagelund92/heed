import type { Queryable } from '../../db/database.ts'
import { parseModelSetting, type JudgeSetting, type ModelRef } from '../models/index.ts'

/** The versioned settings an evaluation run reads (FR-809). Missing keys fall back to the defaults. */
export type EvalSettings = {
  tries: number
  flipRepeats: number
  runBudgetMicros: number
  monthlyCapMicros: number
  featureCapMicros: number
  dailyPersonMicros: number
  /** `judge` is a provider and a model, or `different_family`: another line of the same vendor. */
  models: { eval_answer: ModelRef; judge: JudgeSetting }
}

export async function readEvalSettings(tx: Queryable): Promise<EvalSettings> {
  const rows = await tx.query<{ key: string; value: unknown }>(
    `select key,value from settings_current where key in ('evals.tries','evals.flip_repeats',
       'evals.run_budget_micros','limits.llm_monthly_cap_micros','limits.llm_feature_monthly_micros',
       'limits.llm_daily_micros_per_person','models.eval_answer','models.judge')`,
  )
  const value = (key: string) => rows.find((r) => r.key === key)?.value
  const number = (key: string, fallback: number, min = 0) => {
    const v = Number(value(key))
    return Number.isFinite(v) && v >= min ? Math.floor(v) : fallback
  }
  const caps = value('limits.llm_feature_monthly_micros') as Record<string, unknown> | undefined
  const featureCap = Number(caps?.eval)
  // FR-515: at least three tries; flips repeat to at least as many.
  const tries = Math.max(3, number('evals.tries', 3, 1))
  return {
    tries,
    flipRepeats: Math.max(tries, number('evals.flip_repeats', 7, 1)),
    runBudgetMicros: number('evals.run_budget_micros', 2_000_000),
    monthlyCapMicros: number('limits.llm_monthly_cap_micros', 500_000_000),
    featureCapMicros: Number.isFinite(featureCap) && featureCap >= 0 ? featureCap : 250_000_000,
    dailyPersonMicros: number('limits.llm_daily_micros_per_person', 2_000_000),
    models: {
      eval_answer: parseModelSetting('eval_answer', value('models.eval_answer')),
      judge: parseModelSetting('judge', value('models.judge')),
    },
  }
}
