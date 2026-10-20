import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import { SCOPE_LINE } from '../../../src/contract/assistant.ts'
import { toneProblems } from '../../../src/server/modules/assistant/tone.ts'
import {
  pickedScope,
  scriptedAssistantModel,
} from '../../../src/server/modules/models/assistant-mock.ts'

describe('the scripted assistant reads the scope picked in the Ask tab', () => {
  it('as get_context’s fields, and leaves the question’s own words', () => {
    const fields = {
      metrics: ['metric:average_order_value'],
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/netherlands'] }],
      window: { from: '2026-09-01', to: '2026-09-30' },
    }
    expect(
      pickedScope(`Which facts apply in September 2026?\n${SCOPE_LINE} ${JSON.stringify(fields)}`),
    ).toEqual({ words: 'Which facts apply in September 2026?', scope: fields })
  })

  it('keeps only get_context’s scope fields, and ignores a line that is not JSON', () => {
    expect(pickedScope(`Why?\n${SCOPE_LINE} {"edition":"x","metrics":["metric:a"]}`).scope).toEqual(
      {
        metrics: ['metric:a'],
      },
    )
    expect(pickedScope(`Why?\n${SCOPE_LINE} not json`)).toEqual({
      words: `Why?\n${SCOPE_LINE} not json`,
      scope: {},
    })
    expect(pickedScope('Why?')).toEqual({ words: 'Why?', scope: {} })
  })
})

/*
  The captain, 14 October 2026: "what can you do" was answered with "Which metric, market and
  dates do you mean?", because the scripted model sent every message it could not place to
  get_context. A message about the assistant itself is answered at once; a data question is
  asked only for what it lacks; words it cannot place get the demo model's plain answer.
*/
describe('the scripted assistant answers messages about itself', () => {
  const system = [
    "Heed's context for this turn (from Heed, not from the person).",
    "You are talking to Maria Lindqvist, signed in to Heed: they aren't an owner, approver or admin.",
    'Domains (name and id, then what it is, how many facts it holds and what they are mostly about, its own metrics and dimensions, and its owners):',
    '- Sales (area_sales): 120 facts, mostly about Orders, Units sold. Names it knows: 2 metrics. Owner: Jon Abara.',
    '- Marketing (area_marketing): 40 facts. No names of its own yet. No owner yet.',
  ].join('\n')
  const tools = ['get_context', 'find_context', 'improve_question', 'domain_overview'].map(
    (name) => ({ type: 'function' as const, name, inputSchema: { type: 'object' as const } }),
  )
  const prompt = (text: string, result?: unknown): LanguageModelV4Prompt => [
    { role: 'system', content: system },
    { role: 'user', content: [{ type: 'text', text }] },
    ...(result === undefined
      ? []
      : [
          {
            role: 'assistant' as const,
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'call_1',
                toolName: 'get_context',
                input: {},
              },
            ],
          },
          {
            role: 'tool' as const,
            content: [
              {
                type: 'tool-result' as const,
                toolCallId: 'call_1',
                toolName: 'get_context',
                output: { type: 'json' as const, value: result as never },
              },
            ],
          },
        ]),
  ]
  const step = async (text: string, result?: unknown) => {
    const generated = await scriptedAssistantModel().doGenerate({
      prompt: prompt(text, result),
      tools,
    })
    const call = generated.content.find((part) => part.type === 'tool-call')
    const words = generated.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    return { tool: call?.type === 'tool-call' ? call.toolName : null, words }
  }
  const scopeQuestion = /\bwhich (?:metrics?|markets?|dates?)\b[^.?!]*\?/i

  it.each([
    'what can you do',
    'hi',
    'help',
    'how does this work?',
    'who are you?',
    'thanks!',
    'tell me a joke',
    'what can I ask you?',
    'what do you know about?',
    'how do I add something?',
    'Good morning! What can you help me with?',
    "what's the weather in Canada today?",
  ])('answers %j at once, with no tool and no question about the scope', async (text) => {
    const { tool, words } = await step(text)
    expect(tool).toBeNull()
    expect(words).not.toMatch(scopeQuestion)
    // In the voice of docs/design/voice.md, as the tone check of every test run reads it.
    expect(words.length).toBeGreaterThan(10)
    expect(toneProblems(words, [text])).toEqual([])
  })

  it.each([
    'Which facts apply to orders outside Europe?',
    'Which joke T-shirts launched in the Netherlands?',
    'Rain jacket sales in Norway',
    'snow report feed in the Netherlands',
  ])('sends %j to the tools, never declining it as outside Heed', async (text) => {
    const { tool, words } = await step(text)
    expect({ tool, words }).toEqual({ tool: 'get_context', words: '' })
  })

  it('greets the person by name, and says what it can do with a question to try', async () => {
    expect((await step('hi')).words).toBe('Hi Maria. Try: *Which facts apply to Orders last week?*')
    expect((await step('thanks!')).words).toBe("You're welcome.")
    const { words } = await step('what can you do')
    expect(words).toMatch(/^I help you find, understand and write down facts about your numbers\./)
    expect(words).toContain('Try: *Which facts apply to Orders last week?*')
    expect(words.match(/^- /gm)).toHaveLength(3)
  })

  it('asks a data question only for what it lacks', async () => {
    expect((await step('Why did revenue go down?')).tool).toBe('get_context')
    const nothing = {
      status: 'need_more_detail',
      options: [{ field: 'scope' }, { field: 'dates' }],
    }
    expect((await step('Why did revenue go down?', nothing)).words).toBe(
      'Which metric, market and dates do you mean?',
    )
    const dates = { status: 'need_more_detail', options: [{ field: 'dates' }] }
    expect((await step('Why did orders drop?', dates)).words).toBe('Which dates do you mean?')
  })

  it('says it is the demo model for words it cannot place, never asking for the scope', async () => {
    const nothing = {
      status: 'need_more_detail',
      options: [{ field: 'scope' }, { field: 'dates' }],
    }
    const { words } = await step('zebra crossing', nothing)
    expect(words).toMatch(/^I couldn't match that to a metric, a market or a domain I know\./)
    expect(words).toContain('This is a demo version of me')
    expect(words).not.toMatch(scopeQuestion)
  })
})

describe('the scripted assistant drafts in the domain the words name', () => {
  const system = [
    "Heed's context for this turn (from Heed, not from the person).",
    'Domains (name and id, then whether agents get its items, what it holds, and its owner):',
    '- Practice (invented) (area_practice): live, agents get its items; 4 items. Owner: Practice Owner.',
    '- Sandbox (area_sandbox): live, agents get its items; 2 items. No owner yet.',
  ].join('\n')
  const tools = ['get_context', 'create_draft'].map((name) => ({
    type: 'function' as const,
    name,
    inputSchema: { type: 'object' as const },
  }))
  const draftArea = async (text: string) => {
    const generated = await scriptedAssistantModel().doGenerate({
      prompt: [
        { role: 'system', content: system },
        { role: 'user', content: [{ type: 'text', text }] },
      ],
      tools,
    })
    const call = generated.content.find((part) => part.type === 'tool-call')
    if (call?.type !== 'tool-call' || call.toolName !== 'create_draft') return 'no draft'
    const input = JSON.parse(call.input) as { draft: { areaId?: string } }
    return input.draft.areaId ?? null
  }

  it('names a domain that ends in brackets as well as one that is one word', async () => {
    expect(await draftArea('Draft this: the Practice (invented) oven failed for a day.')).toBe(
      'Practice (invented)',
    )
    expect(await draftArea('Draft this: Sandbox sign-ups were counted twice.')).toBe('Sandbox')
    // A word that only starts like a domain's name names none.
    expect(await draftArea('Draft this: Sandboxes were counted twice.')).toBeNull()
  })
})
