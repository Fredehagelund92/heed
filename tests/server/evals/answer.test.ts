import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import { dynamicTool, jsonSchema } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { loadGoldenSet } from '../../../db/seed/golden-set.ts'
import {
  goldenQuestionSchema,
  rubricIds,
  scoreTry,
  type JudgeVerdict,
} from '../../../src/domain/golden-question.ts'
import { toQuestion } from '../../../src/domain/golden-set.ts'
import {
  answerQuestion,
  answerSystemPrompt,
  observed,
  recordOf,
} from '../../../src/server/modules/evals/answer.ts'
import { ToolCallRefused, type Arm } from '../../../src/server/modules/evals/arm.ts'
import { createModelPort, type ModelChoice } from '../../../src/server/modules/models/index.ts'

const set = loadGoldenSet()
const question = (id: string) =>
  goldenQuestionSchema.parse(toQuestion(set.cases.find((c) => c.id === id)!))
const passing: JudgeVerdict = {
  caveat_present: true,
  cause_claimed: false,
  asks_clarifying_question: false,
  rubrics: [],
  reason: '',
}
/** Scores an answer that cites what it was given, from the tool calls it made. */
const score = (id: string, calls: [tool: string, output: unknown][]) => {
  const q = question(id)
  const seen = observed(calls.map(([tool, output]) => recordOf(tool, {}, output)))
  const answer = seen.delivered.map((item) => `[${item}]`).join(' ')
  const verdict = { ...passing, rubrics: rubricIds(q.rubrics).map((id) => ({ id, passed: true })) }
  return scoreTry(q.expected, q.rubrics, { refused: false, answer, ...seen, verdict })
}

describe('a golden case as a test question', () => {
  it('keeps the day the case is asked on, so a run reads it at that day (round 6)', () => {
    expect(question('gs-baseline-orders-united-kingdom').as_of).toBe('2026-10-07')
    for (const c of set.cases) {
      const parsed = goldenQuestionSchema.safeParse(toQuestion(c))
      if (parsed.success) expect(parsed.data.as_of).toBe(c.as_of)
    }
  })
})

describe('the status and delivery checks of an answer (try-it-2, round 4)', () => {
  it('read find_facts for a definition question, as they read get_facts', () => {
    // Round 4: Sonnet answered "what does net revenue mean" with find_facts, and the status
    // check, reading get_facts alone, failed all six tries the judge passed.
    const found = score('gs-definition-net-revenue', [
      [
        'find_facts',
        { status: 'matched', items: [], definitions: [{ key: 'metric:net_revenue' }] },
      ],
    ])
    expect(found.checks.status).toBe(true)
    expect(found.passed).toBe(true)
    const scoped = score('gs-definition-net-revenue', [
      ['get_facts', { status: 'matched', items: [] }],
    ])
    expect(scoped.checks.status).toBe(true)
  })

  it('count the items find_facts delivered as delivered', () => {
    const q = question('gs-baseline-orders-united-kingdom')
    const items = q.expected.must_deliver.map((id) => ({ id }))
    expect(items.length).toBeGreaterThan(0)
    const found = score('gs-baseline-orders-united-kingdom', [
      ['find_facts', { status: 'matched', items }],
    ])
    expect(found.checks.delivered).toBe(true)
    expect(found.checks.cited).toBe(true)
  })

  it('stay strict when the agent used no context tool, or got the wrong status from one', () => {
    const read = score('gs-definition-net-revenue', [
      ['read_item', { item: { id: 'itm_q2upr28v' } }],
      ['what_changed', { status: 'matched', items: [{ id: 'itm_q2upr28v' }] }],
    ])
    expect(read.checks.status).toBe(false)
    expect(read.passed).toBe(false)
    expect(score('gs-definition-net-revenue', []).checks.status).toBe(false)
    const missed = score('gs-definition-net-revenue', [
      ['get_facts', { status: 'need_more_detail', items: [] }],
      ['find_facts', { status: 'no_match', items: [] }],
    ])
    expect(missed.checks.status).toBe(false)
    const q = question('gs-baseline-orders-united-kingdom')
    const elsewhere = score('gs-baseline-orders-united-kingdom', [
      ['read_item', { item: { id: q.expected.must_deliver[0] } }],
    ])
    expect(elsewhere.checks.delivered).toBe(false)
  })

  it('fail a forbidden item given as applying to the scope, not a search hit shown with its dates', () => {
    // Round 4: find_facts's word search also listed a note that did not apply to the scope,
    // with its dates; the answer stayed honest and must not fail for it.
    const q = question('gs-baseline-orders-united-kingdom')
    const forbidden = q.expected.must_not_deliver[0]!
    const searched = score('gs-baseline-orders-united-kingdom', [
      ['get_facts', { status: 'no_match', items: [] }],
      ['find_facts', { status: 'matched', items: [{ id: forbidden, match: 'some' }] }],
    ])
    expect(searched.checks.not_delivered).toBe(true)
    for (const [tool, item] of [
      ['find_facts', { id: forbidden, match: 'scope' }],
      // get_facts gives every item with how it matched the scope: exact or partial.
      ['get_facts', { id: forbidden, match: 'exact' }],
      ['get_facts', { id: forbidden, match: 'partial' }],
    ] as const) {
      const applied = score('gs-baseline-orders-united-kingdom', [
        [tool, { status: 'matched', items: [item] }],
      ])
      expect(applied.checks.not_delivered).toBe(false)
    }
  })
})

/** A model that asks for get_facts first, then answers in words. */
function agent() {
  const prompts: LanguageModelV4Prompt[] = []
  const model = new MockLanguageModelV4({
    doGenerate: (options) => {
      prompts.push(options.prompt)
      const usage = {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      }
      return Promise.resolve(
        prompts.length === 1
          ? {
              content: [
                {
                  type: 'tool-call' as const,
                  toolCallId: 'call-1',
                  toolName: 'get_facts',
                  input: JSON.stringify({ question: 'Orders in Norway' }),
                },
              ],
              finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
              usage,
              warnings: [],
            }
          : {
              content: [{ type: 'text' as const, text: 'Orders fell [itm_abc12345].' }],
              finishReason: { unified: 'stop' as const, raw: 'end_turn' },
              usage,
              warnings: [],
            },
      )
    },
  })
  const choice: ModelChoice = { ...createModelPort({ mode: 'mock' }).choose('eval_answer'), model }
  return { choice, prompts }
}
const armWith = (execute: () => unknown): Arm => ({
  tools: {
    get_facts: dynamicTool({
      description: 'Context for a question',
      inputSchema: jsonSchema({ type: 'object' }),
      execute: () => Promise.resolve().then(execute),
    }),
  },
  close: () => Promise.resolve(),
})

describe('a tool call the tool server did not answer (round 5)', () => {
  it('ends the answer at once as the run’s failure, never as an answer of the model', async () => {
    // Round 5: refused calls went back to the model, which answered that it could not get the
    // context, and the try was scored as an ordinary fail.
    const { choice, prompts } = agent()
    const arm = armWith(() => {
      throw new ToolCallRefused('get_facts', 429)
    })
    const answered = answerQuestion(arm, choice, 'How did orders do in Norway?')
    await expect(answered).rejects.toThrow(ToolCallRefused)
    await expect(answered).rejects.toThrow('The tool server refused a call to get_facts (HTTP 429)')
    // No second model call is paid for an answer that is not made.
    expect(prompts).toHaveLength(1)
  })

  it('gives an error the tool server answered back to the model, as any AI client does', async () => {
    const { choice, prompts } = agent()
    const arm = armWith(() => {
      throw new Error('Unknown market "Nothland"')
    })
    const result = await answerQuestion(arm, choice, 'How did orders do in Nothland?')
    expect(result.answer).toBe('Orders fell [itm_abc12345].')
    expect(prompts).toHaveLength(2)
  })
})

describe('the prompt cache of an answer (round 5)', () => {
  const breakpoint = { anthropic: { cacheControl: { type: 'ephemeral' } } }
  /** Where a call's prompt carries a cache breakpoint: the message role, and the part's index. */
  const marks = (prompt: LanguageModelV4Prompt) =>
    prompt.flatMap((message) =>
      message.role === 'system'
        ? message.providerOptions?.anthropic
          ? [`system`]
          : []
        : message.content.flatMap((part, index) =>
            'providerOptions' in part && part.providerOptions?.anthropic
              ? [`${message.role}:${index}`]
              : [],
          ),
    )

  it('marks the instructions and the newest part of every step, as the assistant does', async () => {
    // Round 5: 0 tokens read from the cache in 1,044 answer calls, against about 85% in the
    // assistant, so every step paid for the tools, the instructions and the context in full.
    const { choice, prompts } = agent()
    const arm = armWith(() => ({ status: 'matched', items: [{ id: 'itm_abc12345' }] }))
    const result = await answerQuestion(
      arm,
      { ...choice, cacheBreakpoint: breakpoint },
      'How did orders do in Norway?',
    )
    expect(result.answer).toBe('Orders fell [itm_abc12345].')
    expect(prompts.map(marks)).toEqual([
      ['system', 'user:0'],
      // The question's mark moved on to the context the tool gave: two at most, never more.
      ['system', 'tool:0'],
    ])
    expect(prompts[0]![0]).toMatchObject({
      role: 'system',
      content: answerSystemPrompt,
      providerOptions: breakpoint,
    })
  })

  it('sends the same prompt with no marks to a model without a prompt cache', async () => {
    const { choice, prompts } = agent()
    const arm = armWith(() => ({ status: 'matched', items: [] }))
    await answerQuestion(arm, choice, 'How did orders do in Norway?')
    expect(prompts.map(marks)).toEqual([[], []])
    expect(prompts[0]![0]).toMatchObject({ role: 'system', content: answerSystemPrompt })
  })
})
