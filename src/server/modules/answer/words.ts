import { generateText, streamText, type FinishReason } from 'ai'
import type { AnswerResult } from '../../../contract/answer.ts'
import {
  wordsGate,
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
  are told. The words stream, and each sentence is checked as it is complete
  (src/domain/answer-words.ts) before it is sent: a sentence that fails ends the words there. With
  no sentence sent, a refusal by the spending limits, a slow provider or an error, the engine's own
  words stand. Each call is metered into the spend ledger as the assistant's, for the person who
  asked; a call stopped part way (the person pressed Stop, a sentence failed) is metered as
  aborted. The question goes to the model's provider for the call and is kept nowhere: not in a
  table, not in a log (FR-602).
*/

/** The longest a model may take, all its words together; what it sent by then stands. */
const WORDS_TIMEOUT_MS = 12_000
/** Enough for a few short sentences. */
const WORDS_MAX_TOKENS = 400
const tokens = (text: string) => Math.ceil(text.length / 4)

/** The model's words as it wrote them, unchecked, with why it stopped and how much it reasoned. */
export type WordsReply = { text: string; finishReason: FinishReason; reasoningTokens: number }

/**
 * The model's words whole, for the words cases: one call with the instructions and prompt the
 * look-up streams its words with (`writeWords`).
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

/** Why the gate let nothing through when the words simply ended, as cut-off words do. */
const endedEmpty = ['no words', 'cites no item']

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
 * The model's words for an answer, a checked sentence at a time as the model writes them, or null
 * for an answer the model writes nothing for (no items, or a state that keeps the engine's words).
 * Nothing comes when the spending limits leave no room, the provider fails, or the first sentence
 * fails the check; the words end at the first sentence that fails, when the model is cut off (its
 * unfinished sentence is left out), after `WORDS_TIMEOUT_MS`, and when `signal` aborts (the
 * person pressed Stop). The model never decides anything the engine decided. Why words ended
 * early goes to `onMiss`, an error to `onError`; a Stop is neither.
 */
export function writeWords(
  deps: {
    database: Database
    plan: WordsPlan
    /** The request's: aborted when the person stops the answer or leaves. */
    signal?: AbortSignal
    onError?: (error: unknown) => void
    onMiss?: (miss: WordsMiss) => void
  },
  input: WordsInput,
): AsyncGenerator<string> | null {
  if (!wordsStates.includes(input.state) || !input.items.length) return null
  return sentencesOf(deps, input)
}

async function* sentencesOf(
  deps: Parameters<typeof writeWords>[0],
  input: WordsInput,
): AsyncGenerator<string> {
  const { database, plan } = deps
  const prompt = wordsPrompt(input)
  const next = costMicros(plan.choice.prices, {
    inputTokens: tokens(wordsSystem) + tokens(prompt),
    outputTokens: WORDS_MAX_TOKENS,
    cacheReadTokens: 0,
  })
  // Ends the call when a sentence fails: nothing after it is shown, so nothing more is paid for.
  const done = new AbortController()
  try {
    const stop = await database.transaction(plan.person, (tx) =>
      spendLimitReached(tx, 'assistant', plan.limits, next, plan.person),
    )
    if (stop) {
      deps.onMiss?.({ reason: 'spending limit' })
      return
    }
    const meter = createCallMeter({
      database,
      feature: 'assistant',
      person: plan.person,
      limits: null,
      retry: conversationRetry,
      ...(deps.onError ? { onRecordError: deps.onError } : {}),
    })
    const choice = meter.wrap(plan.choice, { role: 'assistant' })
    const gate = wordsGate(input.items.length, prompt)
    let finishReason: FinishReason | undefined
    let reasoningTokens = 0
    try {
      const result = streamText({
        model: choice.model,
        providerOptions: choice.options,
        system: wordsSystem,
        prompt,
        maxOutputTokens: WORDS_MAX_TOKENS,
        abortSignal: AbortSignal.any([
          AbortSignal.timeout(WORDS_TIMEOUT_MS),
          done.signal,
          ...(deps.signal ? [deps.signal] : []),
        ]),
        // An error arrives in the stream below; the default would print it, words and all.
        onError: () => undefined,
      })
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          yield* gate.push(part.text)
          if (gate.failed) break
        } else if (part.type === 'finish') {
          finishReason = part.finishReason
          reasoningTokens = part.totalUsage.outputTokenDetails.reasoningTokens ?? 0
        } else if (part.type === 'error') throw part.error
      }
      if (!gate.failed) yield* gate.end(finishReason === 'stop')
    } finally {
      done.abort()
      // A call still open (stopped, or ended at a failing sentence) is recorded as aborted.
      await meter.close()
    }
    // A Stop is the person's, not a miss.
    if (deps.signal?.aborted) return
    // Cut off (the output limit, the time limit) before anything passed: that is why, not the check.
    const cut = finishReason !== 'stop'
    if (gate.failed && !(cut && !gate.passed.length && endedEmpty.includes(gate.failed))) {
      // The check's reason without the number it quotes, which comes from the words.
      const why = gate.failed.replace(/ \(.*\)$/, '')
      deps.onMiss?.({
        reason: 'failed the check',
        why,
        ...(finishReason ? { finishReason } : {}),
        reasoningTokens,
      })
    } else if (cut)
      // Cut off at the output limit or the time limit: what passed before it stands.
      deps.onMiss?.({
        reason: 'not finished',
        ...(finishReason ? { finishReason } : {}),
        reasoningTokens,
      })
  } catch (error) {
    if (!deps.signal?.aborted) deps.onError?.(error)
  }
}
