import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'
import { mockAssistantTurn } from '@/api/mock-assistant'
import { createMockWorkflow } from '@/api/mock-workflow'
import { applyChunk, newStreamState, StreamError } from '@/lib/ask-stream'
import type { AskMessage } from '@/lib/assistant'
import { getFixtureItems, versionDays } from '@/mocks/fixtures'
import { areas, FIXTURE_TODAY, people, roleGrants, vocabulary } from '@/mocks/reference-data'
import matched from '../fixtures/assistant/matched.json'
import noMatch from '../fixtures/assistant/no-match.json'

/*
  The Ask tab reads the assistant's stream with its own small reader (lib/ask-stream.ts). It must
  build the same message as the AI SDK's reader, so the conversation goes back to the service in
  the shape the service validates: checked here on turns recorded from the service and on every
  kind of turn the mock's scripted assistant streams.
*/

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

async function bySdk(chunks: readonly UIMessageChunk[]) {
  let last: AskMessage | undefined
  for await (const message of readUIMessageStream<AskMessage>({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
  }))
    last = message
  return last!
}

function byReader(chunks: readonly UIMessageChunk[], id: string) {
  const state = newStreamState()
  return chunks.reduce<AskMessage>((message, chunk) => applyChunk(message, chunk, state), {
    id,
    role: 'assistant',
    parts: [],
  })
}

const workflow = createMockWorkflow({
  today: FIXTURE_TODAY,
  areas,
  people,
  vocabulary,
  items: getFixtureItems,
  approvers: roleGrants.approvers,
  administrators: roleGrants.administrators,
  versionDays,
})
async function mockTurn(question: string, about?: string) {
  const chunks: UIMessageChunk[] = []
  for await (const chunk of mockAssistantTurn(
    workflow.as('per_maria').assistantReads(),
    [
      {
        id: 'q',
        role: 'user',
        parts: [{ type: 'text', text: question }],
        metadata: about ? { scope: { about, from: '2026-06-01', to: '2026-06-30' } } : {},
      },
    ],
    { pause: () => Promise.resolve() },
  ))
    chunks.push(chunk)
  return chunks
}

describe('the Ask tab’s stream reader', () => {
  it.each([
    ['a recorded answer with facts', matched],
    ['a recorded answer with none', noMatch],
  ])('builds the SDK’s message from %s', async (_, chunks) => {
    const list = chunks as UIMessageChunk[]
    const expected = await bySdk(list)
    expect(json(byReader(list, expected.id))).toEqual(json(expected))
  })

  it.each([
    [
      'a scope question',
      'Which facts apply?',
      'metric:average_order_value,val:market/united_kingdom',
    ],
    ['an area summary', 'What does the Commercial domain cover?', undefined],
    ['a request to write a fact', 'Help me write down a change.', undefined],
    ['a question to sharpen', 'Make this clearer: why did orders drop?', undefined],
  ])('builds the SDK’s message from the mock’s %s', async (_, question, about) => {
    const chunks = await mockTurn(question, about)
    const expected = await bySdk(chunks)
    expect(json(byReader(chunks, expected.id))).toEqual(json(expected))
  })

  it('marks a signed confirmation request on the tool call, and stops on an error chunk', async () => {
    const state = newStreamState()
    let message: AskMessage = { id: 'a', role: 'assistant', parts: [] }
    const chunks = [
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'create_draft',
        input: { draft: { title: 'Late orders', areaId: 'area_commercial' } },
        dynamic: true,
      },
      // The service signs the request; the input the model gave, before Heed matched its names.
      {
        type: 'tool-approval-request',
        approvalId: 'ap1',
        toolCallId: 'c1',
        signature: 'c2lnbmVk',
        inputSchemaInput: { draft: { title: 'Late orders', areaId: 'Commercial' } },
      },
    ] as UIMessageChunk[]
    for (const chunk of chunks) message = applyChunk(message, chunk, state)
    expect(message.parts).toEqual([
      {
        type: 'dynamic-tool',
        toolName: 'create_draft',
        toolCallId: 'c1',
        state: 'approval-requested',
        input: { draft: { title: 'Late orders', areaId: 'area_commercial' } },
        approval: {
          id: 'ap1',
          signature: 'c2lnbmVk',
          inputSchemaInput: { draft: { title: 'Late orders', areaId: 'Commercial' } },
        },
      },
    ])
    // The SDK's own reader keeps the same: the confirmation goes back in the shape it signed.
    expect(json(message.parts)).toEqual(json((await bySdk(chunks)).parts))
    expect(() =>
      applyChunk(message, { type: 'error', errorText: 'The assistant could not finish.' }, state),
    ).toThrow(StreamError)
  })
})
