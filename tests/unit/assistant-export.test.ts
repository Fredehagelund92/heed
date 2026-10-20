import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'
import { readAnswer, type AnswerView, type AskMessage } from '@/lib/assistant'
import {
  buildChatExport,
  exportAsJson,
  exportAsMarkdown,
  exportFileName,
  type ExportInput,
} from '@/lib/assistant-export'
import matched from '../fixtures/assistant/matched.json'

/*
  Export chat: what the export holds, and what it must never hold. The answer is recorded from
  the service (tests/fixtures/assistant/matched.json); the question and the metadata around it
  are built here, with the things that must stay out put in the places they could leak from.
*/

async function assemble(chunks: readonly unknown[]): Promise<AskMessage> {
  let last: AskMessage | undefined
  for await (const message of readUIMessageStream<AskMessage>({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk as UIMessageChunk)
        controller.close()
      },
    }),
  }))
    last = message
  return last!
}

const SECRET = 'About our business: we sell hand-made kites to Ada Lovelace'

async function setup(): Promise<{ input: ExportInput; answer: AnswerView }> {
  const reply = await assemble(matched)
  const assistant: AskMessage = {
    ...reply,
    id: 'msg-assistant-session-9f3a',
    parts: [
      ...reply.parts,
      // Places the secrets could come from: a seal, a stray part, and the metadata.
      { type: 'data-evidence', id: 'x', data: { seal: 'seal-token-abc123' } } as never,
      { type: 'data-session', id: 's', data: { sessionId: 'sess-4711' } } as never,
    ],
    metadata: {
      at: '2026-10-20T12:01:30.000Z',
      model: { name: 'scripted-demo', mock: true },
      scopeText: SECRET,
    },
  }
  const question: AskMessage = {
    id: 'msg-user-session-1c2d',
    role: 'user',
    parts: [{ type: 'text', text: 'Which facts apply to Italy in June 2026?' }],
    metadata: {
      at: '2026-10-20T12:01:00.000Z',
      scope: { about: 'val:market/italy', from: '2026-06-01', to: '2026-06-30' },
      scopeText: SECRET,
    },
  }
  const read = readAnswer(assistant, { titleOf: () => undefined })
  // The review stamp the service gives a served fact, with the name of whoever accepted it.
  const answer: AnswerView = {
    ...read,
    facts: read.facts.map((fact) => ({
      ...fact,
      reviewed: { acceptedOn: '2026-06-15', by: 'Jon Abara', edition: '2026-10-07.1' },
    })),
  }
  return {
    answer,
    input: {
      messages: [question, assistant],
      answers: new Map([[assistant.id, answer]]),
      factRow: (id) => ({
        status: 'Accepted',
        domain: id === 'itm_is8x9bcp' ? 'Sales' : 'Finance',
      }),
      scopeWords: (scope) => `Italy${scope.from ? ', June 2026' : ''}`,
      build: { version: '0.0.0', build: 'abc123' },
      exportedAt: '2026-10-20T12:03:00.000Z',
      origin: 'https://heed.example',
      timeZone: 'UTC',
    },
  }
}

describe('the structured export', () => {
  it('holds the question, the answer, the facts read and how they stand', async () => {
    const { input, answer } = await setup()
    const chat = buildChatExport(input)
    expect(chat).toMatchObject({
      title: 'Which facts apply to Italy in June 2026?',
      exportedAt: '2026-10-20T12:03:00.000Z',
      app: { version: '0.0.0', build: 'abc123' },
      model: 'scripted-demo',
      mode: 'mock',
      edition: '2026-10-07.2',
    })
    const [you, assistant] = chat.messages
    expect(you).toEqual({
      role: 'you',
      at: '2026-10-20T12:01:00.000Z',
      text: 'Which facts apply to Italy in June 2026?',
      asked: { words: 'Italy, June 2026', from: '2026-06-01', to: '2026-06-30' },
    })
    expect(assistant).toMatchObject({
      role: 'assistant',
      at: '2026-10-20T12:01:30.000Z',
      text: answer.plain,
      model: 'scripted-demo',
      mode: 'mock',
      edition: '2026-10-07.2',
    })
    expect(assistant!.role === 'assistant' && assistant!.steps).toEqual([
      expect.objectContaining({ words: 'Looked up facts', counts: '2 checked, 2 apply' }),
    ])
    expect(assistant!.role === 'assistant' && assistant!.facts[0]).toEqual({
      id: 'itm_is8x9bcp',
      title: answer.facts[0]!.title,
      status: 'Accepted',
      domain: 'Sales',
      verdict: 'applies',
      reason: answer.facts[0]!.reason,
      edition: '2026-10-07.1',
      asOf: '2026-06-15',
    })
  })

  it('says nothing about the model of an answer that never named one', async () => {
    const { input } = await setup()
    const [question, assistant] = input.messages as [AskMessage, AskMessage]
    const chat = buildChatExport({
      ...input,
      messages: [question, { ...assistant, metadata: { at: assistant.metadata?.at } }],
    })
    expect(chat).toMatchObject({ model: null, mode: null })
  })

  it('names a real model and its mode', async () => {
    const { input } = await setup()
    const [question, assistant] = input.messages as [AskMessage, AskMessage]
    const chat = buildChatExport({
      ...input,
      messages: [question, { ...assistant, metadata: { model: { name: 'a-model', mock: false } } }],
    })
    expect(chat).toMatchObject({ model: 'a-model', mode: 'real' })
  })

  it('keeps out ids, seals, the scope line the model read and anything else not shown', async () => {
    const { input } = await setup()
    const json = exportAsJson(buildChatExport(input))
    const text = exportAsMarkdown(input)
    for (const leak of [
      SECRET,
      'hand-made kites',
      'Ada Lovelace',
      'seal-token-abc123',
      'sess-4711',
      'msg-assistant-session-9f3a',
      'msg-user-session-1c2d',
      'sessionId',
      'scopeText',
    ]) {
      expect(json).not.toContain(leak)
      expect(text).not.toContain(leak)
    }
  })

  it('never adds who asked: the person is You, with no name or email', async () => {
    const { input } = await setup()
    const json = exportAsJson(buildChatExport(input))
    expect(json).toContain('"role": "you"')
    expect(json).not.toMatch(/@\w+\.\w+/)
    expect(json).not.toMatch(/"(name|email|person|personId|author|by)"/)
  })

  it('leaves out the name of whoever accepted a fact, and the fact’s body', async () => {
    const { input, answer } = await setup()
    const accepter = answer.facts[0]!.reviewed!.by
    const json = exportAsJson(buildChatExport(input))
    expect(json).not.toContain(accepter)
    expect(exportAsMarkdown(input)).not.toContain(accepter)
    expect(json).not.toMatch(/"(body|bodyMarkup|summary)"/)
  })

  it('has no facts, and no model, for a chat whose answers are missing', async () => {
    const { input } = await setup()
    const chat = buildChatExport({ ...input, answers: new Map() })
    expect(chat.messages.map((message) => message.role)).toEqual(['you'])
    expect(chat.edition).toBeNull()
  })

  it('shortens a long first question to a one line title', async () => {
    const { input } = await setup()
    const [question, ...rest] = input.messages as [AskMessage, ...AskMessage[]]
    const long = `${'Which facts apply to Italy?  '.repeat(10)}\nand more`
    const chat = buildChatExport({
      ...input,
      messages: [{ ...question, parts: [{ type: 'text', text: long }] }, ...rest],
    })
    expect(chat.title).toHaveLength(80)
    expect(chat.title).toMatch(/…$/)
    expect(chat.title).not.toContain('\n')
  })
})

describe('the text export', () => {
  it('reads as a conversation a person can paste', async () => {
    const { input } = await setup()
    const text = exportAsMarkdown(input)
    expect(text).toContain('# Which facts apply to Italy in June 2026?')
    expect(text).toContain('Exported 20 October 2026, 12:03')
    expect(text).toContain('Heed 0.0.0, build abc123')
    expect(text).toContain('Assistant: scripted-demo (demo data)')
    expect(text).toContain('## You · 20 October 2026, 12:01')
    expect(text).toContain('About: Italy, June 2026.')
    expect(text).toContain('## Assistant · 20 October 2026, 12:01')
    expect(text).toContain('Facts read:')
    expect(text).toMatch(
      /\]\(https:\/\/heed\.example\/library\/itm_[a-z0-9]+\): Accepted, Sales, applies/,
    )
    // The ids in the answer became links, never bare ids in brackets.
    expect(text).not.toMatch(/\[itm_[a-z0-9]+\]/)
  })

  it('is valid for a chat with only a question', async () => {
    const { input } = await setup()
    const text = exportAsMarkdown({ ...input, messages: [input.messages[0]!], answers: new Map() })
    expect(text).toContain('## You')
    expect(text).not.toContain('## Assistant')
  })
})

describe('the file name', () => {
  it('names the day and the minute', () => {
    expect(exportFileName('2026-10-20T12:03:00.000Z')).toMatch(
      /^heed-chat-\d{4}-\d{2}-\d{2}-\d{4}\.json$/,
    )
  })
})
