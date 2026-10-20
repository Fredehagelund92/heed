import { APICallError, TypeValidationError } from '@ai-sdk/provider'
import { InvalidToolInputError, NoSuchToolError } from 'ai'
import { describe, expect, it } from 'vitest'
import type { UIMessageChunk } from 'ai'
import {
  assistantCases,
  judge,
  workingNotes,
  type Outcome,
} from '../../../src/server/modules/assistant/cases.ts'
import {
  failedTool,
  plainToolError,
  plainToolErrors,
} from '../../../src/server/modules/assistant/chat.ts'
import { DraftInputError } from '../../../src/server/modules/assistant/tools.ts'
import { webSearchHelp } from '../../../src/server/modules/assistant/turn-context.ts'
import { draftRefused, searchOffReply } from '../../../src/server/modules/models/assistant-mock.ts'
import { errorCode } from '../../../src/server/observability/logger.ts'

const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  answer: '',
  tools: [],
  confirmations: [],
  citations: { cited: [], removed: [], quoted: 0, earlier: 0 },
  ...over,
})
const byId = (id: string) => assistantCases.find((c) => c.id === id)!

describe('the draft cases', () => {
  it('accept a question back when the text lacks facts, or the draft offered to confirm', () => {
    const lacking = byId('draft-from-text')
    const asked = outcome({ answer: 'Which metric does it affect, and what does the source say?' })
    expect(judge(lacking, asked, null, true)).toEqual([])
    const offered = outcome({ tools: ['create_draft'], confirmations: ['create_draft'] })
    expect(judge(lacking, offered, null, true)).toEqual([])
    expect(judge(lacking, outcome({ answer: 'Done.' }), null, true)).toEqual([
      'neither asked to confirm create_draft nor asked for what is missing',
    ])
  })

  it('accept a request for what is missing in any words, and not a question mark in a link', () => {
    const lacking = byId('draft-from-text')
    // Round 6: Sonnet listed what was missing and asked for it without a question mark.
    for (const answer of [
      "I haven't drafted it yet.\n\n- **Quote:** You've given the link but no quote.\n\nPlease send the quote, and say which domain and metrics you want if they differ from my defaults.",
      'The source has no quote yet. Send me the quote and I will draft it.',
      'I need two things first:\n\n1. **Metric:** tell me which metric it affects.\n2. **Quote:** paste the sentence from the source.',
      'Reply with the metric and a quote, and I will draft it.',
      'Which metric does it affect (or all of them?)',
      'I will use Commercial. **Which metric?**',
    ])
      expect(judge(lacking, outcome({ answer }), null, true), answer).toEqual([])
    // A question mark in a page's path asks nothing, and neither does a statement.
    for (const answer of [
      'An owner drafts it under [To review](/proposals?view=review).',
      'Drafts wait under Mine (/proposals?view=mine) until someone sends them for review.',
      'Unless you tell me otherwise, I will use Commercial.',
      'I will send it for review once it is drafted.',
      'Share of voice fell in DE.',
      'Findings:\n\n- Give or take two points.\n- Tell nobody yet.',
    ])
      expect(judge(lacking, outcome({ answer }), null, true), answer).toEqual([
        'neither asked to confirm create_draft nor asked for what is missing',
      ])
  })

  it('require the draft to be offered when the text holds every fact', () => {
    const complete = byId('draft-from-complete-text')
    expect(complete.say(null as never)).toMatch(/https:\/\/example\.test\/law, which says "/)
    const asked = outcome({ answer: 'Which metric does it affect?' })
    expect(judge(complete, asked, null, true)).toEqual(['did not ask to confirm create_draft'])
    const offered = outcome({ tools: ['create_draft'], confirmations: ['create_draft'] })
    expect(judge(complete, offered, null, true)).toEqual([])
  })
})

describe('the drafting rule cases', () => {
  const longSummary = `${'Online sales to Norway stopped by a customs rule. '.repeat(8)}`.trim()
  const draft = (input: Record<string, unknown>) =>
    outcome({ tools: ['create_draft'], confirmations: ['create_draft'], inputs: [input] })

  it('want web search off said plainly, with who switches it on and that a link works now', () => {
    const off = byId('search-off-look-up')
    expect(off.webSearch).toBe('off')
    expect(
      judge(
        off,
        outcome({ answer: 'I cannot search the web, so I cannot look it up.' }),
        null,
        true,
      ),
    ).toEqual(['did not say "admin"', 'did not say "link"'])
    for (const answer of [
      "Web search is off here. An admin can switch it on in Administration under Limits. Paste a link and I'll read it now.",
      'Web search is off. You can switch it on yourself in Administration. Or paste a link to the source.',
    ])
      expect(judge(off, outcome({ answer }), null, true), answer).toEqual([])
    expect(judge(off, outcome({ answer: 'x', tools: ['search_web'] }), null, true)).toContain(
      'called search_web',
    )
  })

  it('want the returns draft made with its dates flagged, never held for the date', () => {
    const returns = byId('returns-unsure-date')
    expect(returns.webSearch).toBe('off')
    const unsure = returns.then![0]!
    expect(
      judge(
        unsure,
        draft({
          draft: { summary: 'Customers have 14 days to send back online orders.' },
          dates_uncertain: true,
        }),
        null,
        true,
      ),
    ).toEqual([])
    expect(
      judge(
        unsure,
        draft({ draft: { summary: 'Customers have 14 days to send back online orders.' } }),
        null,
        true,
      ),
    ).toEqual(['proposed a draft without flagging its dates as uncertain'])
    // Holding the draft for the date the person said they do not know.
    expect(
      judge(unsure, outcome({ answer: 'What date did the rule take effect?' }), null, true),
    ).toEqual(['asked for the date the person did not know'])
    // Asking for something else it cannot fill is still right.
    expect(
      judge(
        unsure,
        outcome({ answer: 'Which domain is it about: Finance or Marketing?' }),
        null,
        true,
      ),
    ).toEqual([])
  })

  it('want a summary within its limit, with the detail in the body', () => {
    const short = byId('draft-short-summary')
    expect([...short.say(null as never)].length).toBeGreaterThan(280)
    expect(
      judge(
        short,
        draft({ draft: { summary: 'Online sales to Norway stopped on 4 August 2026.' } }),
        null,
        true,
      ),
    ).toEqual([])
    const [problem] = judge(short, draft({ draft: { summary: longSummary } }), null, true)
    expect(problem).toMatch(
      /^proposed a draft whose summary is too long: The summary has \d+ characters/,
    )
  })
})

describe('working notes', () => {
  const text = (id: string, words: string): UIMessageChunk[] => [
    { type: 'text-start', id },
    ...(words.match(/\S+\s*/g) ?? []).map((delta) => ({ type: 'text-delta' as const, id, delta })),
    { type: 'text-end', id },
  ]
  const call = (toolCallId: string, toolName: string): UIMessageChunk[] => [
    { type: 'tool-input-available', toolCallId, toolName, input: {}, dynamic: true },
  ]
  const step = (...parts: UIMessageChunk[][]): UIMessageChunk[] => [
    { type: 'start-step' },
    ...parts.flat(),
    { type: 'finish-step' },
  ]

  it('finds the words written in a step that went on to call a tool', () => {
    // Round 6: Sonnet wrote "Year is unclear; try searching." between two tool calls.
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      ...step(call('a', 'get_context')),
      ...step(text('t1', 'Year is unclear; try searching.'), call('b', 'find_context')),
      ...step(text('t2', 'One item applies [itm_gspiinote1].')),
      { type: 'finish', finishReason: 'stop' },
    ]
    expect(workingNotes(chunks)).toEqual(['Year is unclear; try searching.'])
  })

  it('leaves the answer and the words that ask the person to confirm a draft', () => {
    const chunks: UIMessageChunk[] = [
      ...step(text('t1', 'Here is the draft for you to confirm.'), call('a', 'create_draft'), [
        { type: 'tool-approval-request', approvalId: 'p', toolCallId: 'a' },
      ]),
      ...step(text('t2', 'Nothing applies.')),
    ]
    expect(workingNotes(chunks)).toEqual([])
  })

  it('leaves the words of a draft Heed sent back, which the next step explains', () => {
    // The real model on the returns case: it said what it filled and assumed, Heed could not match
    // the EU as a market, and it said so and drafted again.
    const chunks: UIMessageChunk[] = [
      ...step(text('t1', 'I took 1 October 2026 as the start, flagged uncertain.'), [
        {
          type: 'tool-input-error',
          toolCallId: 'a',
          toolName: 'create_draft',
          input: {},
          errorText: 'No single term called "EU".',
          dynamic: true,
        },
      ]),
      ...step(
        text('t2', 'The EU did not match a market, so I named it in the text.'),
        call('b', 'create_draft'),
        [{ type: 'tool-approval-request', approvalId: 'p', toolCallId: 'b' }],
      ),
    ]
    expect(workingNotes(chunks)).toEqual([])
  })

  it('fail a turn that showed the person a working note', () => {
    const answered = outcome({ answer: 'Year is unclear; try searching.\n\nOne item applies.' })
    expect(
      judge(
        { expect: {} },
        { ...answered, notes: ['Year is unclear; try searching.'] },
        null,
        true,
      ),
    ).toEqual(['wrote to the person before a tool call: "Year is unclear; try searching."'])
    expect(judge({ expect: {} }, answered, null, true)).toEqual([])
  })
})

describe('the companion cases', () => {
  it('want last week counted from today, not from the edition', () => {
    const lastWeek = byId('last-week')
    const asked = (from: string, to: string) =>
      outcome({ tools: ['get_context'], windows: [{ from, to }] })
    expect(judge(lastWeek, asked('2026-10-05', '2026-10-11'), null, true, '2026-10-12')).toEqual([])
    // The week before the edition's date (7 October) is not last week on 12 October.
    expect(judge(lastWeek, asked('2026-09-28', '2026-10-04'), null, true, '2026-10-12')).toEqual([
      'did not ask about last week (2026-10-05 to 2026-10-11)',
    ])
  })

  it('fail an answer that asks the person who they are', () => {
    const own = byId('own-identity')
    for (const answer of [
      'What is your user ID so I can set you as owner?',
      'Could you give me your UUID?',
      'Please share your email address.',
    ])
      expect(judge(own, outcome({ answer }), null, true)).toEqual(['asked the person who they are'])
    expect(
      judge(
        own,
        outcome({ answer: 'I drafted it in Commercial with you as owner. Confirm?' }),
        null,
        true,
      ),
    ).toEqual([])
  })
})

describe('the attachment case', () => {
  it('fails an answer that asks which metric, market and dates, or does not name what is attached', () => {
    const attached = byId('what-is-attached')
    const subject = { dimension: { key: 'dim:product', name: 'Product' } } as never
    expect(attached.say(subject)).toMatch(/^What is this\?\nScope picked for this question/)
    expect(attached.say(subject)).toContain('"dimension":"dim:product","values":[]')
    expect(
      judge(
        attached,
        outcome({ answer: 'Which metric, market and dates do you mean?' }),
        subject,
        true,
      ),
    ).toEqual([
      'asked which metric, market or dates, with them attached',
      'did not say what Product is',
    ])
    expect(
      judge(
        attached,
        outcome({ answer: 'Product is a dimension: the product the activity belongs to.' }),
        subject,
        true,
      ),
    ).toEqual([])
  })
})

it('logs an error by kind and code only, never its message or the request it carries', () => {
  const failed = new APICallError({
    message: 'Bad request: the prompt "Why did revenue fall in Zephyrland?" is too long',
    url: 'https://ai-gateway.vercel.sh/v1/chat/completions',
    requestBodyValues: {
      messages: [{ role: 'user', content: 'Why did revenue fall in Zephyrland?' }],
    },
    statusCode: 400,
  })
  expect(errorCode(failed)).toEqual({ type: 'AI_APICallError', statusCode: 400 })
  expect(JSON.stringify(errorCode(failed))).not.toContain('Zephyrland')
  expect(errorCode(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toEqual({
    type: 'Error',
    code: 'ECONNRESET',
  })
  expect(errorCode('a thrown string')).toEqual({ type: 'string' })
})

it('names the tool of a failed tool call, as an error or as the message the SDK passes on', () => {
  const invalid = new InvalidToolInputError({
    toolName: 'improve_question',
    toolInput: '{"question":"Why did revenue fall in Zephyrland?"}',
    cause: new Error(
      'Type validation failed: Value: {"question":"Why did revenue fall in Zephyrland?"}',
    ),
  })
  expect(failedTool(invalid)).toEqual({
    name: 'improve_question',
    type: 'AI_InvalidToolInputError',
  })
  expect(failedTool(`${invalid.name}: ${invalid.message}`)).toEqual({
    name: 'improve_question',
    type: 'AI_InvalidToolInputError',
  })
  expect(failedTool(new NoSuchToolError({ toolName: 'publish_item' }))).toEqual({
    name: 'publish_item',
    type: 'AI_NoSuchToolError',
  })
  expect(failedTool(new Error('Provider overloaded'))).toBeNull()
  expect(failedTool('Provider overloaded')).toBeNull()
})

it("gives the model a plain sentence for a failed tool call, never the SDK's error", () => {
  const own = new InvalidToolInputError({
    toolName: 'create_draft',
    toolInput: '{"draft":{"title":"Door sensor failed"}}',
    cause: new DraftInputError(
      'Say which domain it is about, as areaId: Practice (invented). Nothing was saved, and the person was not asked to confirm.',
    ),
  })
  // What the SDK hands the model: the error's kind, then its message.
  expect(plainToolError(own.toString())).toBe(
    'Say which domain it is about, as areaId: Practice (invented). Nothing was saved, and the person was not asked to confirm.',
  )
  const schema = new InvalidToolInputError({
    toolName: 'improve_question',
    toolInput: '{"question":"Why did revenue fall in Zephyrland?"}',
    cause: new TypeValidationError({
      value: { question: 'Why did revenue fall in Zephyrland?' },
      cause: new Error('Expected a string at window.from'),
    }),
  })
  const plainError = new InvalidToolInputError({
    toolName: 'improve_question',
    toolInput: '{}',
    cause: new Error('Expected a string'),
  })
  for (const error of [
    schema.toString(),
    plainError.toString(),
    new NoSuchToolError({ toolName: 'publish_item' }).toString(),
  ]) {
    const plain = plainToolError(error)
    expect(plain).not.toMatch(/AI_|Invalid input|Zephyrland|publish_item|validation/)
  }
  expect(plainToolError('Provider overloaded')).toBe('Provider overloaded')

  const messages = plainToolErrors([
    { role: 'user', content: 'Draft this' },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'create_draft',
          output: { type: 'error-text', value: own.toString() },
        },
        {
          type: 'tool-result',
          toolCallId: 'c2',
          toolName: 'get_context',
          output: { type: 'json', value: { items: [] } },
        },
      ],
    },
  ])
  expect(messages[0]).toEqual({ role: 'user', content: 'Draft this' })
  expect(JSON.stringify(messages)).not.toContain('AI_InvalidToolInputError')
  expect(JSON.stringify(messages[1])).toContain('{"items":[]}')
})

it('has the mock say what the turn context says when web search is off', () => {
  expect(searchOffReply(webSearchHelp({ name: 'Ravi', roles: [], areas: [] }))).toBe(
    "Web search is off here, so I can't look it up. An admin can switch it on in Administration under Limits, the setting \"Web search by the assistant\". Paste a link to the source and I'll read it now. If you're not sure when it happened, I can draft it anyway with the dates marked as uncertain.",
  )
  expect(
    searchOffReply(webSearchHelp({ name: 'Ada', roles: ['administrator'], areas: [] })),
  ).toContain(
    'You can switch it on yourself in Administration under Limits, the setting "Web search by the assistant" ([Limits](/admin?section=limits)).',
  )
})

it("has the mock ask what a real model would when a draft was refused, in the person's words", () => {
  const reason = (text: string) =>
    `${text} Nothing was saved, and the person was not asked to confirm.`
  expect(
    draftRefused(reason('Say which domain it is about, as areaId: Practice (invented), Traffic.')),
  ).toBe(
    "I couldn't draft it yet, so nothing is saved. Which domain is it about: Practice (invented), Traffic?",
  )
  expect(
    draftRefused(reason('No domain is called "Ops". The domains are Practice (invented).')),
  ).toBe(
    'I couldn\'t draft it yet, so nothing is saved. No domain is called "Ops". The domains are Practice (invented). Which should I use?',
  )
  for (const text of [
    reason(
      '"Jon" is not an owner of that domain. Leave ownerId out: the domain\'s owner is set for you.',
    ),
    'The input did not fit what this tool takes, so nothing was done. Check the fields and try again.',
  ]) {
    const said = draftRefused(text)
    expect(said).not.toMatch(/ownerId|areaId|the person|tool/)
    expect(said).toMatch(/^I couldn't draft it yet, so nothing is saved\./)
  }
})
