import { generateText, type FinishReason } from 'ai'
import { parsePlan, type AskPlan, type PlanCheck, type PlanMiss } from '../../../domain/ask-plan.ts'
import type { PlannerInput } from '../../../domain/ask-route.ts'
import type { Database } from '../../db/database.ts'
import {
  costMicros,
  createCallMeter,
  scriptedWordsModel,
  spendLimitReached,
  type MeteredCall,
  type ModelChoice,
  type RetryPolicy,
  type SpendLimits,
} from '../models/index.ts'

/*
  Ask's planner call (FR-719): for a question the rules cannot read, and for a follow-up, the
  model of `models.assistant` chooses Ask's reads from a closed list (src/domain/ask-plan.ts).
  It is one short call with no reasoning, under the person's spending limits and metered into the
  spend ledger as the assistant's, like the words. It gets at most `PLAN_TIMEOUT_MS`: a slow
  provider, an error, a refusal by the limits or a plan that fails the check leaves the question
  to the rules, so Ask answers as it does with no model. Why it was left goes to the service log,
  never the question, the last turn or the plan: they go to the model's provider for the call and
  are kept nowhere (FR-602).
*/

/** The longest the planner may take; past it Ask answers as it does with no model. */
export const PLAN_TIMEOUT_MS = 3_000
/** Enough for a plan of three reads and the question as it reads alone. */
export const PLAN_MAX_TOKENS = 350
/** One try: a person is waiting, and a plan that comes late is worth less than the rules' answer. */
const planRetry: RetryPolicy = { tries: 1, budgetMs: PLAN_TIMEOUT_MS, baseMs: 0, capMs: 0 }
const tokens = (text: string) => Math.ceil(text.length / 4)

/** The model's plan as it wrote it, unchecked, with why it stopped. */
export type PlannerReply = { text: string; finishReason: FinishReason; reasoningTokens: number }

/**
 * One planner call: the instructions, then the vocabulary, which is the same for every person and
 * so carries the prompt cache breakpoint where the provider has one, then the question.
 */
export async function askForPlan(
  choice: Pick<ModelChoice, 'model' | 'options' | 'cacheBreakpoint'>,
  input: PlannerInput,
  signal?: AbortSignal,
): Promise<PlannerReply> {
  const result = await generateText({
    model: choice.model,
    providerOptions: choice.options,
    instructions: [
      { role: 'system', content: input.system },
      { role: 'system', content: input.vocabulary, providerOptions: choice.cacheBreakpoint },
    ],
    prompt: input.prompt,
    maxOutputTokens: PLAN_MAX_TOKENS,
    // The model call meter retries what is worth retrying.
    maxRetries: 0,
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(PLAN_TIMEOUT_MS),
      ...(signal ? [signal] : []),
    ]),
  })
  return {
    text: result.text,
    finishReason: result.finishReason,
    reasoningTokens: result.usage.outputTokenDetails.reasoningTokens ?? 0,
  }
}

/** What one person's look-up needs to ask the planner, read inside the request. */
export type PlanCall = { choice: ModelChoice; limits: SpendLimits; person: string }

/**
 * Why the planner's plan was not used, for the service log: the step that left it, and for a plan
 * that failed the check, the check's fixed reason. Never the words.
 */
export type PlannerMiss = {
  reason: 'spending limit' | 'too slow' | 'not checked'
  why?: PlanMiss
  finishReason?: FinishReason
  reasoningTokens?: number
}

/**
 * The checked plan for a question, or `missed` when the planner gave none: the limits leave no
 * room, the provider is slow or fails, or the plan fails `check`. Ask then answers as the rules do
 * and says why it could not read a question they cannot. A Stop (`signal`) ends the call and is no
 * miss. `onCall` hears what the call cost, as the ledger keeps it.
 */
export async function planQuestion(
  deps: {
    database: Database
    call: PlanCall
    signal?: AbortSignal
    onMiss?: (miss: PlannerMiss) => void
    onError?: (error: unknown) => void
    onCall?: (call: MeteredCall) => void
  },
  input: PlannerInput,
  check: (raw: unknown) => PlanCheck,
): Promise<AskPlan | null | 'missed'> {
  const { database, call } = deps
  const next = costMicros(call.choice.prices, {
    inputTokens: tokens(input.system) + tokens(input.vocabulary) + tokens(input.prompt),
    outputTokens: PLAN_MAX_TOKENS,
    cacheReadTokens: 0,
  })
  try {
    const stop = await database.transaction(call.person, (tx) =>
      spendLimitReached(tx, 'assistant', call.limits, next, call.person),
    )
    if (stop) {
      deps.onMiss?.({ reason: 'spending limit' })
      return 'missed'
    }
    const meter = createCallMeter({
      database,
      feature: 'assistant',
      person: call.person,
      limits: null,
      retry: planRetry,
      ...(deps.onCall ? { onCall: deps.onCall } : {}),
      ...(deps.onError ? { onRecordError: deps.onError } : {}),
    })
    let reply: PlannerReply
    try {
      reply = await askForPlan(meter.wrap(call.choice, { role: 'assistant' }), input, deps.signal)
    } finally {
      await meter.close()
    }
    const checked = check(parsePlan(reply.text))
    if (!checked.ok) {
      deps.onMiss?.({
        reason: 'not checked',
        why: checked.why,
        finishReason: reply.finishReason,
        reasoningTokens: reply.reasoningTokens,
      })
      return 'missed'
    }
    return checked.plan
  } catch (error) {
    if (deps.signal?.aborted) return null
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      deps.onMiss?.({ reason: 'too slow' })
    else deps.onError?.(error)
    return 'missed'
  }
}

/**
 * The scripted planner, for the service on the scripted mock (MODELS=mock): the plans of the
 * planner cases and the demo (src/domain/ask-plan-fixture.ts), read from the prompt as a model
 * would get it and checked the same way, with no call to any provider and nothing metered.
 */
export async function scriptedPlan(
  input: PlannerInput,
  check: (raw: unknown) => PlanCheck,
): Promise<AskPlan | null> {
  const reply = await askForPlan(scriptedWordsModel(), input)
  const checked = check(parsePlan(reply.text))
  return checked.ok ? checked.plan : null
}
