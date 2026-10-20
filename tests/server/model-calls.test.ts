import {
  APICallError,
  type LanguageModelV4CallOptions,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4StreamPart,
} from '@ai-sdk/provider'
import { generateText, streamText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../src/server/db/database.ts'
import {
  backoffMs,
  CallLimiter,
  createCallMeter,
  createModelPort,
  ModelCallError,
  retryAfterMs,
  testRunRetry,
  type CallMeterOptions,
  type ModelChoice,
} from '../../src/server/modules/models/index.ts'

/*
  The model call meter: every model call is limited, retried when the provider refused it for its
  rate limit or failed on its side, priced, and written once (output test plan R4 and R5; the
  try-it-2 round 3 cost finding). No database and no clock: writes are captured and waits recorded.
*/

const usage = {
  inputTokens: { total: 1_000, noCache: 800, cacheRead: 200, cacheWrite: 0 },
  outputTokens: { total: 100, text: 80, reasoning: 20 },
}
const ok: LanguageModelV4GenerateResult = {
  content: [{ type: 'text', text: 'Fine.' }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage,
  warnings: [],
}
const refused = (status: number, headers: Record<string, string> = {}) =>
  new APICallError({
    message: `Refused: the prompt was ${'secret question'}`,
    url: 'https://example.test/v1/chat/completions',
    requestBodyValues: { prompt: 'secret question' },
    statusCode: status,
    responseHeaders: headers,
  })

function model(errors: Error[]): MockLanguageModelV4 & { calls: number } {
  const counted = new MockLanguageModelV4({
    doGenerate: () => {
      counted.calls++
      const error = errors.shift()
      return error ? Promise.reject(error) : Promise.resolve(ok)
    },
  }) as MockLanguageModelV4 & { calls: number }
  counted.calls = 0
  return counted
}
const choice = (m: ModelChoice['model']): ModelChoice => ({
  model: m,
  id: 'test/answer',
  provider: 'test',
  name: 'answer',
  vendor: 'test',
  family: 'test/answer',
  effort: 'low',
  options: {},
  cacheBreakpoint: {},
  prices: { input: 2, output: 10, cacheRead: 0.2 },
  recipients: 'no one',
})

/** A database that keeps every statement the meter writes. */
function captured() {
  const statements: { text: string; values: unknown[] }[] = []
  const database = {
    transaction: async <T>(_person: string | null, work: (tx: never) => Promise<T>) =>
      work({
        query: (text: string, values: unknown[] = []) => {
          statements.push({ text, values })
          return Promise.resolve([])
        },
      } as never),
  } as unknown as Database
  return { database, statements }
}
const rows = (statements: { text: string; values: unknown[] }[]) =>
  statements
    .filter((s) => s.text.includes('insert into model_calls'))
    .map((s) => ({ outcome: s.values[8], status: s.values[9], cost: s.values[16] }))

function meterOf(over: Partial<CallMeterOptions> = {}) {
  const { database, statements } = captured()
  const waits: number[] = []
  const meter = createCallMeter({
    database,
    feature: 'eval',
    person: null,
    runId: '00000000-0000-4000-8000-000000000001',
    limits: null,
    retry: testRunRetry,
    wait: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
    random: () => 0.5,
    ...over,
  })
  return { meter, statements, waits }
}

describe('retries (R4)', () => {
  it('waits as long as Retry-After asks, then records each refused try and the answer', async () => {
    const { meter, statements, waits } = meterOf()
    const m = model([refused(429, { 'retry-after': '56' }), refused(503)])
    const result = await generateText({
      model: meter.wrap(choice(m), { role: 'eval_answer', cell: null }).model,
      prompt: 'Hello',
      maxRetries: 0,
    })
    await meter.settled()
    expect(result.text).toBe('Fine.')
    expect(m.calls).toBe(3)
    // 56 s as the provider asked, then the backoff for a third try: half of 4 s plus half again.
    expect(waits).toEqual([56_000, 3_000])
    expect(rows(statements)).toEqual([
      { outcome: 'throttled', status: 429, cost: 0 },
      { outcome: 'failed', status: 503, cost: 0 },
      // 800 fresh at $2, 200 cache reads at $0.20, 100 out at $10 per million.
      { outcome: 'ok', status: null, cost: 2_640 },
    ])
    // Only the call that answered is billed: the run's cost and the ledger, once.
    expect(statements.filter((s) => s.text.includes('actual_cost_micros'))).toHaveLength(1)
    expect(statements.filter((s) => s.text.includes('llm_spend_monthly'))).toHaveLength(1)
    expect(meter.costMicros).toBe(2_640)
  })

  it('gives up after five tries as throttled, with no prompt in its message, and the SDK does not retry it', async () => {
    const { meter, statements } = meterOf()
    const m = model(Array.from({ length: 9 }, () => refused(429)))
    const failure = await generateText({
      model: meter.wrap(choice(m), { role: 'judge' }).model,
      prompt: 'Hello',
    }).catch((error: unknown) => error)
    await meter.settled()
    expect(failure).toBeInstanceOf(ModelCallError)
    expect(failure).toMatchObject({ kind: 'throttled', statusCode: 429, tries: 5 })
    expect((failure as Error).message).not.toContain('secret question')
    expect(m.calls).toBe(5)
    expect(rows(statements).map((r) => r.outcome)).toEqual(Array(5).fill('throttled'))
    expect(statements.some((s) => s.text.includes('llm_spend_monthly'))).toBe(false)
  })

  it('stops within its time budget when the provider asks for a longer wait', async () => {
    const { meter } = meterOf()
    const m = model([refused(429, { 'retry-after': '600' })])
    await expect(
      generateText({ model: meter.wrap(choice(m), { role: 'judge' }).model, prompt: 'Hi' }),
    ).rejects.toMatchObject({ kind: 'throttled', tries: 1 })
  })

  it('does not retry a request the provider rejected as wrong, and says provider for a server error', async () => {
    const bad = meterOf()
    const wrong = model([refused(400)])
    await expect(
      generateText({ model: bad.meter.wrap(choice(wrong), { role: 'judge' }).model, prompt: 'Hi' }),
    ).rejects.toBeInstanceOf(APICallError)
    expect(wrong.calls).toBe(1)
    const down = meterOf()
    const failing = model(Array.from({ length: 5 }, () => refused(503)))
    await expect(
      generateText({
        model: down.meter.wrap(choice(failing), { role: 'judge' }).model,
        prompt: 'Hi',
      }),
    ).rejects.toMatchObject({ kind: 'provider', statusCode: 503 })
  })

  it('starts no call once its admission refuses, as at a run ceiling', async () => {
    const { meter } = meterOf({
      admit: () => {
        throw new Error('ceiling')
      },
    })
    const m = model([])
    await expect(
      generateText({ model: meter.wrap(choice(m), { role: 'judge' }).model, prompt: 'Hi' }),
    ).rejects.toThrow('ceiling')
    expect(m.calls).toBe(0)
  })

  it('reads Retry-After as seconds, a date or milliseconds, and backs off with jitter', () => {
    const now = Date.parse('2026-10-13T12:00:00Z')
    expect(retryAfterMs({ 'Retry-After': '2' }, now)).toBe(2_000)
    expect(retryAfterMs({ 'retry-after': 'Tue, 13 Oct 2026 12:00:30 GMT' }, now)).toBe(30_000)
    expect(retryAfterMs({ 'retry-after-ms': '250', 'retry-after': '9' }, now)).toBe(250)
    expect(retryAfterMs({}, now)).toBeNull()
    const policy = { tries: 5, budgetMs: 180_000, baseMs: 2_000, capMs: 60_000 }
    expect([backoffMs(policy, 2, () => 0), backoffMs(policy, 2, () => 1)]).toEqual([1_000, 2_000])
    expect(backoffMs(policy, 10, () => 1)).toBe(60_000)
  })
})

describe('limits (R4, R5)', () => {
  it('lets one call per provider run at once when concurrency is 1', async () => {
    const limiter = new CallLimiter()
    const limits = { concurrency: 1, requestsPerMinute: null, tokensPerMinute: null }
    let active = 0
    let peak = 0
    const slow = new MockLanguageModelV4({
      doGenerate: async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return ok
      },
    })
    const { meter } = meterOf({ limits, limiter })
    const wrapped = meter.wrap(choice(slow), { role: 'eval_answer' }).model
    await Promise.all([1, 2, 3].map(() => generateText({ model: wrapped, prompt: 'Hi' })))
    expect(peak).toBe(1)
  })

  it('waits for the minute to have room for another request, and for tokens', async () => {
    let now = 0
    const waits: number[] = []
    const limiter = new CallLimiter(
      () => now,
      (ms) => {
        waits.push(ms)
        now += ms
        return Promise.resolve()
      },
    )
    const limits = { concurrency: 4, requestsPerMinute: 2, tokensPerMinute: null }
    for (let i = 0; i < 3; i++) {
      const release = await limiter.acquire('p', 'm', limits)
      release()
      now += 1_000
    }
    // Two starts at 0 s and 1 s: the third waits until the first is a minute old.
    expect(waits).toEqual([58_000])
    const tokens = { concurrency: 4, requestsPerMinute: null, tokensPerMinute: 1_000 }
    limiter.used('p', 'other', 1_200)
    const release = await limiter.acquire('p', 'other', tokens)
    release()
    expect(waits.at(-1)).toBe(60_000)
  })
})

describe('streams', () => {
  const streaming = (parts: LanguageModelV4StreamPart[], fail = false) =>
    new MockLanguageModelV4({
      doStream: (_options: LanguageModelV4CallOptions) =>
        Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              for (const part of parts) controller.enqueue(part)
              // The provider reports a failure mid-answer, as an error part.
              if (fail) controller.enqueue({ type: 'error', error: new Error('Dropped') })
              controller.close()
            },
          }),
        }),
    })

  it('records a finished stream once, from the usage it reported', async () => {
    const { meter, statements } = meterOf()
    const result = streamText({
      model: meter.wrap(
        choice(
          streaming([
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Fine.' },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
          ]),
        ),
        { role: 'assistant' },
      ).model,
      prompt: 'Hi',
    })
    expect(await result.text).toBe('Fine.')
    await meter.close()
    expect(rows(statements)).toEqual([{ outcome: 'ok', status: null, cost: 2_640 }])
  })

  it('records an estimate for a stream that broke before it reported usage', async () => {
    const { meter, statements } = meterOf({ runId: null })
    const result = streamText({
      model: meter.wrap(
        choice(
          streaming(
            [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: 'x'.repeat(400) },
            ],
            true,
          ),
        ),
        { role: 'assistant' },
      ).model,
      prompt: 'Hi',
      onError: () => {},
    })
    await result.consumeStream()
    await meter.close()
    // A conversation keeps no call row: only the ledger's totals, marked as an estimate.
    expect(rows(statements)).toEqual([])
    const ledger = statements.find((s) => s.text.includes('llm_spend_monthly'))
    expect(ledger?.values.slice(1, 4)).toEqual([1, expect.any(Number), 1])
    expect(meter.outputTokens).toBe(100)
  })
})

describe('prompt cache writes through the gateway (round 5)', () => {
  /*
    Two calls of the same 16,813-token prompt to anthropic/claude-haiku-5.5 on Vercel's gateway,
    with their usage as the gateway answered them on 14 Oct 2026: the first wrote 16,802 tokens to
    the prompt cache, the second read them. The gateway billed 0.00210335 and 0.00017112 dollars,
    and its credit counter moved by their sum. Before, the first call's writes were billed at the
    input price and recorded as 0 written.
  */
  const reported = [
    {
      prompt_tokens: 16_813,
      completion_tokens: 4,
      total_tokens: 16_817,
      cost: 0.00210335,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0, video_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0, image_tokens: 0 },
      cache_creation_input_tokens: 16_802,
    },
    {
      prompt_tokens: 16_813,
      completion_tokens: 4,
      total_tokens: 16_817,
      cost: 0.00017112,
      prompt_tokens_details: { cached_tokens: 16_802, audio_tokens: 0, video_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0, image_tokens: 0 },
      cache_creation_input_tokens: 0,
    },
  ]
  const served = 'anthropic/claude-haiku-5.5'
  const haiku = () =>
    createModelPort({
      mode: 'live',
      env: { VERCEL_AI_GATEWAY_API_KEY: 'vck-placeholder-not-a-key' },
    }).choose('eval_answer', { provider: 'vercel-gateway', model: 'anthropic/claude-haiku-5.5' })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const written = (statements: { text: string; values: unknown[] }[]) =>
    statements
      .filter((s) => s.text.includes('insert into model_calls'))
      .map((s) => ({
        in: s.values[10],
        read: s.values[12],
        write: s.values[13],
        cost: s.values[16],
      }))

  it('records what each call wrote and read, and bills it as the gateway does', async () => {
    const usage = [...reported]
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        Response.json({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1_791_500_000,
          model: served,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' },
          ],
          usage: usage.shift(),
        }),
      ),
    )
    const { meter, statements } = meterOf()
    const model = meter.wrap(haiku(), { role: 'eval_answer', cell: null }).model
    for (let n = 0; n < 2; n++) await generateText({ model, prompt: 'Say OK.', maxRetries: 0 })
    await meter.settled()
    // 11 fresh input tokens at 0.10 a million, 16,802 written at 0.125 (1.25 times input) or read
    // at 0.01, and 4 output tokens at 0.50: the gateway's own 2,103.35 and 171.12 micros, rounded up.
    expect(written(statements)).toEqual([
      { in: 16_813, read: 0, write: 16_802, cost: 2_104 },
      { in: 16_813, read: 16_802, write: 0, cost: 172 },
    ])
    expect(meter.costMicros).toBe(2_276)
  })

  it('reads the writes of a streamed answer too', async () => {
    const chunk = (data: object) => `data: ${JSON.stringify(data)}\n\n`
    const base = { id: 'chatcmpl-2', object: 'chat.completion.chunk', created: 1, model: served }
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' } }] }) +
            chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
            chunk({ ...base, choices: [], usage: reported[0] }) +
            'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      ),
    )
    const { meter, statements } = meterOf()
    const result = streamText({
      model: meter.wrap(haiku(), { role: 'assistant', caseTry: null }).model,
      prompt: 'Say OK.',
      maxRetries: 0,
    })
    expect(await result.text).toBe('OK')
    expect((await result.usage).inputTokenDetails).toMatchObject({
      cacheReadTokens: 0,
      cacheWriteTokens: 16_802,
      noCacheTokens: 11,
    })
    await meter.settled()
    expect(written(statements)).toEqual([{ in: 16_813, read: 0, write: 16_802, cost: 2_104 }])
  })
})

describe('calls cut short before the provider answered (round 6)', () => {
  /*
    Round 6 stopped a Sonnet eval run with Ctrl-C while 4 calls were in flight: 2
    anthropic/claude-sonnet-5.5 answer steps and 2 google/gemini-2.5-flash-lite judgings. No
    response had come, so each was recorded as aborted with 0 tokens and 0 cost, but the gateway
    billed them, 34,728 micros in all. Resumed, the same answer steps read 7,650 tokens and cost
    17,147 micros each.
  */
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const sonnet = () =>
    createModelPort({
      mode: 'live',
      env: { VERCEL_AI_GATEWAY_API_KEY: 'vck-placeholder-not-a-key' },
    }).choose('eval_answer', { provider: 'vercel-gateway', model: 'anthropic/claude-sonnet-5.5' })
  /** A gateway that never answers until the request is aborted. */
  const hanging = () =>
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason as Error), {
          once: true,
        })
      })
    })
  const calls = (statements: { text: string; values: unknown[] }[]) =>
    statements
      .filter((s) => s.text.includes('insert into model_calls'))
      .map((s) => ({
        outcome: s.values[8],
        in: s.values[10],
        out: s.values[11],
        cost: s.values[16],
        estimated: s.values[17],
      }))
  // About 7,650 tokens of prompt, as the cut-short answer step sent.
  const prompt = 'The question, the instructions and what Heed delivered. '.repeat(546)

  it('records an aborted call at its estimate, marked as one, and bills the run and the ledger', async () => {
    hanging()
    const { meter, statements } = meterOf()
    const stop = new AbortController()
    const answer = generateText({
      model: meter.wrap(sonnet(), { role: 'eval_answer', cell: null }).model,
      prompt,
      maxRetries: 0,
      abortSignal: stop.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    stop.abort()
    await expect(answer).rejects.toThrow()
    await meter.settled()
    const [call] = calls(statements)
    // The prompt it sent, priced at Sonnet's uncached input price of 2 dollars a million: no
    // output had reached us, and whether the prompt cache would have served it is unknown.
    expect(call).toMatchObject({ outcome: 'aborted', out: 0, estimated: true })
    expect(call!.in).toBeGreaterThan(7_650)
    expect(call!.in).toBeLessThan(7_800)
    expect(call!.cost).toBe(2 * (call!.in as number))
    // Close to the 17,147 micros the same step cost when resumed, where 0 was recorded before.
    expect(call!.cost).toBeGreaterThan(17_147 * 0.8)
    expect(statements.filter((s) => s.text.includes('actual_cost_micros'))).toHaveLength(1)
    const ledger = statements.find((s) => s.text.includes('llm_spend_monthly'))
    expect(ledger).toBeDefined()
    expect(meter.costMicros).toBe(call!.cost)
  })

  it('records a stream aborted before its first part at its estimate too', async () => {
    hanging()
    const { meter, statements } = meterOf({ runId: null })
    const stop = new AbortController()
    const result = streamText({
      model: meter.wrap(sonnet(), { role: 'assistant', caseTry: null }).model,
      prompt,
      maxRetries: 0,
      abortSignal: stop.signal,
      onError: () => {},
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    stop.abort()
    await result.consumeStream()
    await meter.close()
    const ledger = statements.find((s) => s.text.includes('llm_spend_monthly'))
    // calls, then whether it is an estimate: one call, one estimated.
    expect(ledger?.values.slice(1, 4)).toEqual([1, expect.any(Number), 1])
    expect(meter.inputTokens).toBeGreaterThan(7_650)
    expect(meter.costMicros).toBe(2 * meter.inputTokens)
  })

  it('still bills nothing for a call the provider refused, even when it was aborted after', async () => {
    const { meter, statements } = meterOf()
    const stop = new AbortController()
    const refusedThenStopped = new MockLanguageModelV4({
      doGenerate: () => {
        stop.abort()
        return Promise.reject(refused(429))
      },
    })
    await expect(
      generateText({
        model: meter.wrap(choice(refusedThenStopped), { role: 'judge' }).model,
        prompt,
        abortSignal: stop.signal,
      }),
    ).rejects.toThrow()
    await meter.settled()
    expect(calls(statements)).toEqual([
      { outcome: 'aborted', in: 0, out: 0, cost: 0, estimated: false },
    ])
  })
})
