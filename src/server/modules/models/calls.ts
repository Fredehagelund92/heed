import { APICallError } from '@ai-sdk/provider'
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import type { Database, Queryable } from '../../db/database.ts'
import { costMicros } from './port.ts'
import { recordModelSpend, type SpendFeature } from './spend.ts'
import type { ModelChoice, ModelRole } from './types.ts'

/**
 * The model call meter: every call to a model goes through it, so what a call cost is worked out
 * and written in one place (the try-it-2 round 3 finding: the spend ledger and a run's own cost
 * disagreed by a factor of two). For each call it
 * - waits for room under the provider's limits (`models.call_limits`): answers at once per
 *   provider, and requests and tokens a minute per provider and model (output test plan, R4, R5);
 * - retries a call the provider refused for its rate limit or failed on its side (429, 408, 409,
 *   5xx, a dropped connection) with jittered backoff, honouring `Retry-After`, and then gives up
 *   with a `ModelCallError` that says which (`throttled` or `provider`) and never holds a prompt;
 * - prices the usage the provider reported, cache reads and writes at their own rates, or an
 *   estimate when the call ended before it reported any, and writes it at once: the spend
 *   ledger's totals and, for a test run, one `model_calls` row and the run's cost, in the same
 *   transaction. A person's assistant conversation keeps only the ledger's totals (FR-603).
 */

/** How hard the service may call a provider. Null: no limit of that kind. */
export type CallLimits = {
  /** Calls in flight at once, per provider. */
  concurrency: number
  /** Calls started in any minute, per provider and model. */
  requestsPerMinute: number | null
  /** Tokens (in and out) in any minute, per provider and model. */
  tokensPerMinute: number | null
}
export const defaultCallLimits: CallLimits = {
  concurrency: 4,
  requestsPerMinute: null,
  tokensPerMinute: null,
}

/** The current `models.call_limits`; missing or invalid fields fall back to the defaults. */
export async function readCallLimits(tx: Queryable): Promise<CallLimits> {
  const [row] = await tx.query<{ value: unknown }>(
    "select value from settings_current where key='models.call_limits'",
  )
  const value = (row?.value && typeof row.value === 'object' ? row.value : {}) as Record<
    string,
    unknown
  >
  const positive = (raw: unknown) =>
    typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : null
  return {
    concurrency: positive(value.concurrency) ?? defaultCallLimits.concurrency,
    requestsPerMinute: positive(value.requests_per_minute),
    tokensPerMinute: positive(value.tokens_per_minute),
  }
}

/** How often and how long a refused or failed call is tried again. */
export type RetryPolicy = {
  /** Tries in all, the first included. */
  tries: number
  /** Time from the first try after which no try starts. */
  budgetMs: number
  /** The first backoff; each later one doubles, up to `capMs`. */
  baseMs: number
  capMs: number
}
/** Test runs wait out a rate limit: up to 5 tries or 3 minutes (R4). */
export const testRunRetry: RetryPolicy = {
  tries: 5,
  budgetMs: 180_000,
  baseMs: 2_000,
  capMs: 60_000,
}
/** A person is waiting for an answer: a short retry, then the plain error. */
export const conversationRetry: RetryPolicy = {
  tries: 3,
  budgetMs: 20_000,
  baseMs: 1_000,
  capMs: 8_000,
}

export type CallFailureKind = 'throttled' | 'provider'
/**
 * A call the provider kept refusing or failing until the retry policy ran out. Its message says
 * which, with the last HTTP status, and holds nothing of the request. The AI SDK does not retry
 * it again.
 */
export class ModelCallError extends Error {
  override readonly name = 'ModelCallError'
  readonly kind: CallFailureKind
  readonly statusCode: number | null
  readonly tries: number
  constructor(kind: CallFailureKind, statusCode: number | null, tries: number, waitedMs: number) {
    const status = statusCode === null ? '' : ` (HTTP ${statusCode})`
    const seconds = Math.round(waitedMs / 1000)
    super(
      kind === 'throttled'
        ? `The model provider refused ${tries} call${tries === 1 ? '' : 's'} for its rate limit${status} over ${seconds} s`
        : `The model provider failed ${tries} call${tries === 1 ? '' : 's'}${status} over ${seconds} s`,
    )
    this.kind = kind
    this.statusCode = statusCode
    this.tries = tries
  }
}

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>
export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal!.reason as Error)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })

type Failure = {
  retryable: boolean
  throttled: boolean
  status: number | null
  afterMs: number | null
}
/** Whether an error is worth another try, and how long the provider asked to wait. */
export function classifyCallError(error: unknown): Failure {
  if (!APICallError.isInstance(error))
    return { retryable: false, throttled: false, status: null, afterMs: null }
  const status = error.statusCode ?? null
  return {
    retryable: error.isRetryable,
    throttled: status === 429,
    status,
    afterMs: retryAfterMs(error.responseHeaders),
  }
}

/** `retry-after-ms`, or `retry-after` in seconds or as an HTTP date. */
export function retryAfterMs(
  headers: Record<string, string> | undefined,
  now = Date.now(),
): number | null {
  if (!headers) return null
  const header = (name: string) =>
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
  const ms = Number(header('retry-after-ms'))
  if (Number.isFinite(ms) && ms >= 0) return ms
  const after = header('retry-after')
  if (after === undefined) return null
  const seconds = Number(after)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(after)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

/** The wait before try `next` (2 or later): half the doubled backoff, plus up to as much again. */
export function backoffMs(policy: RetryPolicy, next: number, random = Math.random): number {
  const full = Math.min(policy.capMs, policy.baseMs * 2 ** (next - 2))
  return Math.round(full / 2 + random() * (full / 2))
}

/**
 * Room under the limits, shared by every caller in this process. Concurrency is per provider; the
 * minute windows are per provider and model. A limit read anew each call applies at once.
 */
export class CallLimiter {
  private readonly active = new Map<string, number>()
  private readonly waiting = new Map<string, (() => void)[]>()
  private readonly starts = new Map<string, number[]>()
  private readonly tokens = new Map<string, { at: number; n: number }[]>()
  private readonly now: () => number
  private readonly wait: Sleep
  constructor(now: () => number = Date.now, wait: Sleep = sleep) {
    this.now = now
    this.wait = wait
  }

  /** Waits for a free slot and room in the minute; returns the release of the slot. */
  async acquire(
    provider: string,
    model: string,
    limits: CallLimits,
    signal?: AbortSignal,
  ): Promise<() => void> {
    for (;;) {
      if (signal?.aborted) throw signal.reason as Error
      const active = this.active.get(provider) ?? 0
      if (active < limits.concurrency) {
        this.active.set(provider, active + 1)
        break
      }
      await new Promise<void>((resolve, reject) => {
        const queue = this.waiting.get(provider) ?? []
        const wake = () => {
          signal?.removeEventListener('abort', abort)
          resolve()
        }
        const abort = () => {
          const index = queue.indexOf(wake)
          if (index >= 0) queue.splice(index, 1)
          reject(signal!.reason as Error)
        }
        queue.push(wake)
        this.waiting.set(provider, queue)
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.active.set(provider, (this.active.get(provider) ?? 1) - 1)
      this.waiting.get(provider)?.shift()?.()
    }
    try {
      const key = `${provider}/${model}`
      for (;;) {
        const pause = this.pause(key, limits)
        if (pause <= 0) break
        await this.wait(pause, signal)
      }
      this.starts.set(key, [...(this.starts.get(key) ?? []), this.now()])
    } catch (error) {
      release()
      throw error
    }
    return release
  }

  /** Counts the tokens a call used against its minute. */
  used(provider: string, model: string, n: number) {
    if (n <= 0) return
    const key = `${provider}/${model}`
    this.tokens.set(key, [...(this.tokens.get(key) ?? []), { at: this.now(), n }])
  }

  /** How long until the next call fits in the minute, in milliseconds; 0 when it fits now. */
  private pause(key: string, limits: CallLimits): number {
    const now = this.now()
    const since = now - 60_000
    const starts = (this.starts.get(key) ?? []).filter((at) => at > since)
    const tokens = (this.tokens.get(key) ?? []).filter((t) => t.at > since)
    this.starts.set(key, starts)
    this.tokens.set(key, tokens)
    let pause = 0
    if (limits.requestsPerMinute !== null && starts.length >= limits.requestsPerMinute)
      pause = starts[starts.length - limits.requestsPerMinute]! + 60_000 - now
    if (limits.tokensPerMinute !== null) {
      let total = tokens.reduce((sum, t) => sum + t.n, 0)
      for (const t of tokens) {
        if (total < limits.tokensPerMinute) break
        total -= t.n
        pause = Math.max(pause, t.at + 60_000 - now)
      }
    }
    return Math.max(0, Math.ceil(pause))
  }
}
/** The limiter of this process: every meter shares it unless a test gives its own. */
export const sharedCallLimiter = new CallLimiter()

/** One call as metered: what it used and cost, never what it said. */
export type MeteredCall = {
  role: ModelRole
  provider: string
  model: string
  attempt: number
  outcome: 'ok' | 'throttled' | 'failed' | 'aborted'
  status: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  latencyMs: number
  costMicros: number
  /** The call ended before the provider reported its usage; the usage is an estimate. */
  estimated: boolean
  cell: string | null
  caseTry: string | null
}

export type CallMeterOptions = {
  database: Database
  feature: SpendFeature
  /** Whose spending this is: their daily limit counts it. */
  person: string | null
  /** A test run: its calls are kept one by one and added to its cost. */
  runId?: string | null
  /** Null: the service does not limit these calls itself. */
  limits: CallLimits | null
  retry: RetryPolicy
  limiter?: CallLimiter
  wait?: Sleep
  random?: () => number
  /** Before every try; throws to stop the call, such as at a run's cost ceiling. */
  admit?: () => void
  /** Each call as soon as it ends, before it is written. */
  onCall?: (call: MeteredCall) => void
  /** A call that could not be written to the ledger; the call itself went on. */
  onRecordError?: (error: unknown) => void
}
/** Where a call is made: the role, and the cell or assistant case try of a test run. */
export type CallSite = { role: ModelRole; cell?: string | null; caseTry?: string | null }

export type CallMeter = {
  /** The same model choice, with every call metered. */
  wrap(choice: ModelChoice, site: CallSite): ModelChoice
  /** Every call ended so far, written. */
  settled(): Promise<void>
  /** Counts any call still streaming as ended early, then waits until all are written. */
  close(): Promise<void>
  /** What the calls of this meter cost so far, in micros. */
  readonly costMicros: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** Tokens in a text, roughly: four characters each, rounded up. */
const tokensIn = (text: string) => Math.ceil(text.length / 4)

export function createCallMeter(options: CallMeterOptions): CallMeter {
  const limiter = options.limiter ?? sharedCallLimiter
  const wait = options.wait ?? sleep
  let writing: Promise<void> = Promise.resolve()
  const open = new Set<() => void>()
  const totals = { costMicros: 0, inputTokens: 0, outputTokens: 0 }

  function record(call: MeteredCall) {
    totals.costMicros += call.costMicros
    totals.inputTokens += call.inputTokens
    totals.outputTokens += call.outputTokens
    options.onCall?.(call)
    writing = writing
      .then(() => writeCall(options, call))
      .catch((error: unknown) => options.onRecordError?.(error))
  }

  function priced(choice: ModelChoice, usage: LanguageModelV4Usage) {
    const inputTokens = usage.inputTokens.total ?? 0
    const outputTokens = usage.outputTokens.total ?? 0
    const cacheReadTokens = usage.inputTokens.cacheRead ?? 0
    const cacheWriteTokens = usage.inputTokens.cacheWrite ?? 0
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens: usage.outputTokens.reasoning ?? 0,
      costMicros: costMicros(choice.prices, {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
      }),
    }
  }
  const unused = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costMicros: 0,
  }
  /** What a call that never reported usage sent, rounded up: its prompt and tools, and the output streamed. */
  function estimate(choice: ModelChoice, params: LanguageModelV4CallOptions, streamed: number) {
    const inputTokens =
      tokensIn(JSON.stringify(params.prompt)) + tokensIn(JSON.stringify(params.tools ?? []))
    const outputTokens = Math.ceil(streamed / 4)
    return {
      ...unused,
      inputTokens,
      outputTokens,
      costMicros: costMicros(choice.prices, { inputTokens, outputTokens, cacheReadTokens: 0 }),
    }
  }

  /** Tries `start` under the limits and the retry policy; each try that fails is recorded. */
  async function attempt<T>(
    choice: ModelChoice,
    site: CallSite,
    params: LanguageModelV4CallOptions,
    start: (attempt: number, release: () => void, began: number) => Promise<T>,
  ): Promise<T> {
    const first = Date.now()
    for (let n = 1; ; n++) {
      options.admit?.()
      const release = options.limits
        ? await limiter.acquire(choice.provider, choice.name, options.limits, params.abortSignal)
        : () => {}
      const began = Date.now()
      try {
        return await start(n, release, began)
      } catch (error) {
        release()
        const failure = classifyCallError(error)
        const aborted = params.abortSignal?.aborted ?? false
        // A call cut short before the provider answered was still sent, and the provider bills it
        // (round 6: 4 such calls, USD 0.035). One it refused with a status was not billed.
        const cutShort = aborted && failure.status === null
        const call = cutShort ? estimate(choice, params, 0) : unused
        if (cutShort)
          limiter.used(choice.provider, choice.name, call.inputTokens + call.outputTokens)
        record({
          ...base(choice, site, n),
          ...call,
          outcome: aborted ? 'aborted' : failure.throttled ? 'throttled' : 'failed',
          status: failure.status,
          latencyMs: Date.now() - began,
          estimated: cutShort,
        })
        if (!failure.retryable || params.abortSignal?.aborted) throw error
        const waited = Date.now() - first
        const pause = failure.afterMs ?? backoffMs(options.retry, n + 1, options.random)
        if (n >= options.retry.tries || waited + pause > options.retry.budgetMs)
          throw new ModelCallError(
            failure.throttled ? 'throttled' : 'provider',
            failure.status,
            n,
            waited,
          )
        await wait(pause, params.abortSignal)
      }
    }
  }

  const base = (choice: ModelChoice, site: CallSite, attempt: number) => ({
    role: site.role,
    provider: choice.provider,
    model: choice.name,
    attempt,
    cell: site.cell ?? null,
    caseTry: site.caseTry ?? null,
  })

  return {
    wrap(choice, site) {
      const model = wrapLanguageModel({
        model: choice.model,
        middleware: {
          wrapGenerate: ({ doGenerate, params }) =>
            attempt(choice, site, params, async (n, release, began) => {
              const result = await doGenerate()
              release()
              const usage = priced(choice, result.usage)
              limiter.used(choice.provider, choice.name, usage.inputTokens + usage.outputTokens)
              record({
                ...base(choice, site, n),
                ...usage,
                outcome: 'ok',
                status: null,
                latencyMs: Date.now() - began,
                estimated: false,
              })
              return result
            }),
          wrapStream: ({ doStream, params }) =>
            attempt(choice, site, params, async (n, release, began) => {
              const result = await doStream()
              const reader = result.stream.getReader()
              let usage: LanguageModelV4Usage | null = null
              let streamed = 0
              let ended = false
              const end = (outcome: MeteredCall['outcome']) => {
                if (ended) return
                ended = true
                open.delete(abandon)
                release()
                // A call that ended before the provider reported usage was still billed: the
                // prompt it sent and the output that reached us.
                const call = usage ? priced(choice, usage) : estimate(choice, params, streamed)
                limiter.used(choice.provider, choice.name, call.inputTokens + call.outputTokens)
                record({
                  ...base(choice, site, n),
                  ...call,
                  outcome: usage ? 'ok' : outcome,
                  status: null,
                  latencyMs: Date.now() - began,
                  estimated: usage === null,
                })
              }
              const abandon = () => end('aborted')
              open.add(abandon)
              const stream = new ReadableStream<LanguageModelV4StreamPart>({
                async pull(controller) {
                  try {
                    const next = await reader.read()
                    if (next.done) {
                      end('aborted')
                      controller.close()
                      return
                    }
                    const part = next.value
                    if (part.type === 'text-delta') streamed += part.delta.length
                    else if (part.type === 'tool-input-delta') streamed += part.delta.length
                    else if (part.type === 'finish') usage = part.usage
                    else if (part.type === 'error') end('failed')
                    controller.enqueue(part)
                    if (part.type === 'finish') end('ok')
                  } catch (error) {
                    end(params.abortSignal?.aborted ? 'aborted' : 'failed')
                    controller.error(error)
                  }
                },
                async cancel(reason) {
                  end('aborted')
                  await reader.cancel(reason)
                },
              })
              return { ...result, stream }
            }),
        },
      })
      return { ...choice, model }
    },
    settled: () => writing,
    async close() {
      for (const abandon of [...open]) abandon()
      await writing
    },
    get costMicros() {
      return totals.costMicros
    },
    get inputTokens() {
      return totals.inputTokens
    },
    get outputTokens() {
      return totals.outputTokens
    },
  }
}

/** One call, written: the ledger's totals, and for a test run its own row and the run's cost. */
async function writeCall(options: CallMeterOptions, call: MeteredCall) {
  const billed = call.outcome === 'ok' || call.costMicros > 0
  if (!billed && !options.runId) return
  await options.database.transaction(options.person, async (tx) => {
    if (options.runId) {
      await tx.query(
        `insert into model_calls(feature,run_id,cell_id,case_try_id,role,provider,model,attempt,outcome,http_status,
           tokens_in,tokens_out,cache_read,cache_write,reasoning,latency_ms,cost_micros,estimated)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          options.feature,
          options.runId,
          call.cell,
          call.caseTry,
          call.role,
          call.provider,
          call.model,
          call.attempt,
          call.outcome,
          call.status,
          call.inputTokens,
          call.outputTokens,
          call.cacheReadTokens,
          call.cacheWriteTokens,
          call.reasoningTokens,
          call.latencyMs,
          call.costMicros,
          call.estimated,
        ],
      )
      if (call.costMicros > 0)
        await tx.query(
          'update eval_runs set actual_cost_micros=actual_cost_micros+$2 where id=$1',
          [options.runId, call.costMicros],
        )
    }
    if (billed)
      await recordModelSpend(
        tx,
        options.feature,
        {
          provider: call.provider,
          inputTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          costMicros: call.costMicros,
          calls: 1,
          estimated: call.estimated,
        },
        options.person,
      )
  })
}
