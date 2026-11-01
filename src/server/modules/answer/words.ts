import { generateText, type FinishReason } from 'ai'
import type { AnswerResult } from '../../../contract/answer.ts'
import {
  checkWords,
  wordsPrompt,
  wordsStates,
  wordsSystem,
  type WordsInput,
} from '../../../domain/answer-words.ts'
import type { Database, Queryable } from '../../db/database.ts'
import {
  conversationRetry,
  costMicros,
  createCallMeter,
  parseModelSetting,
  readSpendLimits,
  spendLimitReached,
  type ModelChoice,
  type ModelPort,
  type SpendLimits,
} from '../models/index.ts'

/*
  Ask's words from the assistant's model (FR-701): when the service runs with real models
  (MODELS=live, the provider's key set), the model of `models.assistant` puts the items the engine
  gave into a few plain sentences; the engine still decides the state, the sources and what agents
  are told. The words are checked (src/domain/answer-words.ts) and any failure, a refusal by the
  spending limits, a slow provider or an error, leaves the engine's own words. Each call is metered
  into the spend ledger as the assistant's, for the person who asked. The question goes to the
  model's provider for the call and is kept nowhere: not in a table, not in a log (FR-602).
*/

/** The longest a model may take before the engine's words stand. */
const WORDS_TIMEOUT_MS = 12_000
/** Enough for a few short sentences. */
const WORDS_MAX_TOKENS = 400
const tokens = (text: string) => Math.ceil(text.length / 4)

/** The model's words as it wrote them, unchecked, with why it stopped and how much it reasoned. */
export type WordsReply = { text: string; finishReason: FinishReason; reasoningTokens: number }

/**
 * The model's words: one call with Ask's instructions and prompt, the same for the look-up and the
 * words cases.
 */
export async function askForWords(
  choice: Pick<ModelChoice, 'model' | 'options'>,
  input: WordsInput,
): Promise<WordsReply> {
  const result = await generateText({
    model: choice.model,
    providerOptions: choice.options,
    system: wordsSystem,
    prompt: wordsPrompt(input),
    maxOutputTokens: WORDS_MAX_TOKENS,
    abortSignal: AbortSignal.timeout(WORDS_TIMEOUT_MS),
  })
  return {
    text: result.text,
    finishReason: result.finishReason,
    reasoningTokens: result.usage.outputTokenDetails.reasoningTokens ?? 0,
  }
}

/** What one person's look-up needs to ask the model, read inside the request. */
export type WordsPlan = { choice: ModelChoice; limits: SpendLimits; person: string }

/** The assistant's model, as `models.assistant` names it, the way the assistant's turn reads it. */
export async function readWordsModel(tx: Queryable, models: ModelPort): Promise<ModelChoice> {
  const [row] = await tx.query<{ value: unknown }>(
    "select value from settings_current where key='models.assistant'",
  )
  return models.choose('assistant', parseModelSetting('assistant', row?.value))
}

/** The model and the spending limits for a person's look-up, or null when no real model serves. */
export async function planWords(
  tx: Queryable,
  models: ModelPort,
  person: string,
): Promise<WordsPlan | null> {
  if (models.mode !== 'live') return null
  return {
    choice: await readWordsModel(tx, models),
    limits: await readSpendLimits(tx, 'assistant'),
    person,
  }
}

/** The words the model's input is made of, from the engine's answer. */
export const wordsInputOf = (question: string, answer: AnswerResult): WordsInput => ({
  question,
  state: answer.state,
  say: answer.say,
  items: answer.items.map((item) => ({
    title: item.title,
    summary: item.summary,
    notToConclude: item.notToConclude,
  })),
})

/**
 * Why the model's words were not used, for the service log: the step that refused them, and for a
 * call that ended, why the model stopped and how much it reasoned. Never the words or the question.
 */
export type WordsMiss = {
  reason: 'spending limit' | 'not finished' | 'failed the check'
  why?: string
  finishReason?: FinishReason
  reasoningTokens?: number
}

/**
 * The model's words for an answer, checked, or null: for an answer with no items, when the
 * spending limits leave no room, when the provider is slow or fails, when the model stops before
 * it is done, or when the words fail the check. The model never decides anything the engine
 * decided. A refusal goes to `onMiss`, an error to `onError`.
 */
export async function writeWords(
  deps: {
    database: Database
    plan: WordsPlan
    onError?: (error: unknown) => void
    onMiss?: (miss: WordsMiss) => void
  },
  input: WordsInput,
): Promise<string | null> {
  if (!wordsStates.includes(input.state) || !input.items.length) return null
  const { database, plan } = deps
  const prompt = wordsPrompt(input)
  const next = costMicros(plan.choice.prices, {
    inputTokens: tokens(wordsSystem) + tokens(prompt),
    outputTokens: WORDS_MAX_TOKENS,
    cacheReadTokens: 0,
  })
  try {
    const stop = await database.transaction(plan.person, (tx) =>
      spendLimitReached(tx, 'assistant', plan.limits, next, plan.person),
    )
    if (stop) {
      deps.onMiss?.({ reason: 'spending limit' })
      return null
    }
    const meter = createCallMeter({
      database,
      feature: 'assistant',
      person: plan.person,
      limits: null,
      retry: conversationRetry,
      ...(deps.onError ? { onRecordError: deps.onError } : {}),
    })
    const reply = await askForWords(meter.wrap(plan.choice, { role: 'assistant' }), input)
    await meter.settled()
    const { finishReason, reasoningTokens } = reply
    // Words cut off at the output limit, or stopped for any other reason, are not the model's.
    if (finishReason !== 'stop') {
      deps.onMiss?.({ reason: 'not finished', finishReason, reasoningTokens })
      return null
    }
    const checked = checkWords(reply.text, input.items.length, prompt)
    if (checked.ok) return checked.text
    // The check's reason without the number it quotes, which comes from the words.
    const why = checked.why.replace(/ \(.*\)$/, '')
    deps.onMiss?.({ reason: 'failed the check', why, finishReason, reasoningTokens })
    return null
  } catch (error) {
    deps.onError?.(error)
    return null
  }
}
