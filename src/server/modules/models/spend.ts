import type { Queryable } from '../../db/database.ts'

/**
 * The spend ledger (FR-409, NFR-062), shared by every feature that calls a model. Before a call
 * the caller checks the month's total, the month's spend of its feature and, when a person asked
 * for it, that person's day, over every provider. Usage from each response goes to the ledger at
 * once, under the provider that served it. The daily row
 * holds no content and expires in 24 hours (NFR-033); the monthly totals keep no person.
 */

export type SpendFeature = 'eval' | 'assistant'
export type SpendLimits = {
  monthlyCapMicros: number
  featureCapMicros: number
  dailyPersonMicros: number
}
export type SpendEntry = {
  /** The provider that served the calls: each prices them with its own table. */
  provider: string
  inputTokens: number
  outputTokens: number
  costMicros: number
  calls: number
  /** The usage is an estimate (the call did not finish), not what the provider reported. */
  estimated?: boolean
}

const labels: Record<SpendFeature, string> = { eval: 'Evaluation', assistant: 'Assistant' }
export const formatUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`

/** The current limits for one feature. Missing or invalid settings fall back to the defaults. */
export async function readSpendLimits(tx: Queryable, feature: SpendFeature): Promise<SpendLimits> {
  const rows = await tx.query<{ key: string; value: unknown }>(
    `select key,value from settings_current where key in ('limits.llm_monthly_cap_micros',
       'limits.llm_feature_monthly_micros','limits.llm_daily_micros_per_person')`,
  )
  const value = (key: string) => rows.find((r) => r.key === key)?.value
  const number = (raw: unknown, fallback: number) => {
    const v = Number(raw)
    return raw !== null && raw !== undefined && Number.isFinite(v) && v >= 0
      ? Math.floor(v)
      : fallback
  }
  const caps = value('limits.llm_feature_monthly_micros') as Record<string, unknown> | undefined
  return {
    monthlyCapMicros: number(value('limits.llm_monthly_cap_micros'), 500_000_000),
    featureCapMicros: number(caps?.[feature], 250_000_000),
    dailyPersonMicros: number(value('limits.llm_daily_micros_per_person'), 2_000_000),
  }
}

/**
 * Which limit stopped a call: all model spending this month, the feature's spending this month,
 * or the person's spending today.
 */
export type SpendLimitKind = 'monthly' | 'feature' | 'person_day'
/**
 * A limit that stops the next call: which one, why in words, and the day it resets (the first of
 * next month, UTC), or null for a person's daily limit, which resets within 24 hours.
 */
export type SpendStop = { kind: SpendLimitKind; message: string; resets: string | null }

/** Which limit the next call would pass, or null. `next` is the cost the call may add. */
export async function spendLimitReached(
  tx: Queryable,
  feature: SpendFeature,
  limits: SpendLimits,
  next: number,
  person: string | null,
): Promise<SpendStop | null> {
  const [row] = await tx.query<{ total: string; feature: string; day: string; reset: string }>(
    `select coalesce(sum(cost_micros),0)::text as total,
            coalesce(sum(cost_micros) filter (where feature=$1),0)::text as feature,
            (select coalesce(sum(cost_micros),0)::text from llm_spend_daily
              where person_id=$2 and day=(now() at time zone 'UTC')::date) as day,
            to_char(date_trunc('month', now() at time zone 'UTC') + interval '1 month','YYYY-MM-DD') as reset
       from llm_spend_monthly where month=date_trunc('month', now() at time zone 'UTC')::date`,
    [feature, person],
  )
  const total = Number(row?.total ?? 0)
  const spent = Number(row?.feature ?? 0)
  const reset = row?.reset ?? null
  const on = reset ?? 'next month'
  if (total + next > limits.monthlyCapMicros)
    return {
      kind: 'monthly',
      message: `Model spending reached the monthly cap of ${formatUsd(limits.monthlyCapMicros)}; it resets on ${on}.`,
      resets: reset,
    }
  if (spent + next > limits.featureCapMicros)
    return {
      kind: 'feature',
      message: `${labels[feature]} spending reached its monthly cap of ${formatUsd(limits.featureCapMicros)}; it resets on ${on}.`,
      resets: reset,
    }
  if (person && Number(row?.day ?? 0) + next > limits.dailyPersonMicros)
    return {
      kind: 'person_day',
      message: `Your model spending reached the daily limit of ${formatUsd(limits.dailyPersonMicros)}; it resets within 24 hours.`,
      resets: null,
    }
  return null
}

/** Why the next call may not run, or null. `next` is the cost the call may add. */
export async function spendCapReached(
  tx: Queryable,
  feature: SpendFeature,
  limits: SpendLimits,
  next: number,
  person: string | null,
): Promise<string | null> {
  return (await spendLimitReached(tx, feature, limits, next, person))?.message ?? null
}

export async function recordModelSpend(
  tx: Queryable,
  feature: SpendFeature,
  spend: SpendEntry,
  person: string | null,
) {
  const estimatedCalls = spend.estimated ? spend.calls : 0
  await tx.query(
    `insert into llm_spend_monthly(month,feature,provider,calls,cost_micros,estimated_calls)
     values(date_trunc('month', now() at time zone 'UTC')::date,$1,$5,$2,$3,$4)
     on conflict (month,feature,provider) do update set calls=llm_spend_monthly.calls+excluded.calls,
       cost_micros=llm_spend_monthly.cost_micros+excluded.cost_micros,
       estimated_calls=llm_spend_monthly.estimated_calls+excluded.estimated_calls`,
    [feature, spend.calls, spend.costMicros, estimatedCalls, spend.provider],
  )
  if (person)
    await tx.query(
      `insert into llm_spend_daily(day,person_id,feature,tokens_in,tokens_out,cost_micros,estimated_calls)
       values((now() at time zone 'UTC')::date,$1,$2,$3,$4,$5,$6)
       on conflict (day,person_id,feature) do update set tokens_in=llm_spend_daily.tokens_in+excluded.tokens_in,
         tokens_out=llm_spend_daily.tokens_out+excluded.tokens_out,
         cost_micros=llm_spend_daily.cost_micros+excluded.cost_micros,
         estimated_calls=llm_spend_daily.estimated_calls+excluded.estimated_calls`,
      [person, feature, spend.inputTokens, spend.outputTokens, spend.costMicros, estimatedCalls],
    )
}
