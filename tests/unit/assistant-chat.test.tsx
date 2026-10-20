import { act, render } from '@testing-library/react'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type AssistantChatInput } from '@/api'
import {
  askChat,
  askDraftText,
  askInNewChat,
  resetAskChat,
  setAskDraftText,
  useAskHandoff,
} from '@/lib/assistant-chat'
import type { AskMessage } from '@/lib/assistant'

/*
  Confirming a draft: the service signs each confirmation request, and runs the call only when the
  confirmation carries that signature back (the companion review's finding F2, broken from the
  first Ask tab until the reader and the chat kept it).
*/

const answered = (): AsyncIterable<UIMessageChunk> =>
  new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: 'start' })
      controller.enqueue({ type: 'finish', finishReason: 'stop' })
      controller.close()
    },
  })

afterEach(() => {
  vi.restoreAllMocks()
  resetAskChat()
})

const asked: AskMessage = { id: 'q1', role: 'user', parts: [{ type: 'text', text: 'Draft it' }] }
const proposed: AskMessage = {
  id: 'a1',
  role: 'assistant',
  parts: [
    { type: 'step-start' },
    {
      type: 'dynamic-tool',
      toolName: 'create_draft',
      toolCallId: 'call_1',
      state: 'approval-requested',
      input: { draft: { title: 'Late orders', areaId: 'area_commercial' } },
      approval: {
        id: 'approval_1',
        signature: 'c2lnbmVk',
        inputSchemaInput: { draft: { title: 'Late orders', areaId: 'Commercial' } },
      },
    },
  ],
}

describe('confirming a draft', () => {
  it('sends the signature of the request back with the answer, and the person’s time zone', async () => {
    const sent: AssistantChatInput[] = []
    vi.spyOn(api, 'assistantChat').mockImplementation((input) => {
      sent.push(input)
      return Promise.resolve(answered())
    })
    resetAskChat([asked, proposed])
    await askChat().addToolApprovalResponse({ id: 'approval_1', approved: true })

    expect(sent).toHaveLength(1)
    const [, answer] = sent[0]!.messages as AskMessage[]
    expect(answer!.parts[1]).toMatchObject({
      state: 'approval-responded',
      approval: {
        id: 'approval_1',
        approved: true,
        signature: 'c2lnbmVk',
        inputSchemaInput: { draft: { title: 'Late orders', areaId: 'Commercial' } },
      },
    })
    expect(sent[0]!.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('sends the signature with a refusal too: the service still checks it', async () => {
    const sent: AssistantChatInput[] = []
    vi.spyOn(api, 'assistantChat').mockImplementation((input) => {
      sent.push(input)
      return Promise.resolve(answered())
    })
    resetAskChat([asked, proposed])
    await askChat().addToolApprovalResponse({ id: 'approval_1', approved: false })
    const [, answer] = sent[0]!.messages as AskMessage[]
    expect(answer!.parts[1]).toMatchObject({
      approval: { id: 'approval_1', approved: false, signature: 'c2lnbmVk' },
    })
  })
})

/*
  A question asked outside the assistant (Home's search field) starts a new chat, and the Ask tab
  on screen sends it (the captain's bug: it opened the panel and the question went nowhere).
*/
describe('asking in a new chat', () => {
  /** An answer that never ends until it is stopped. */
  const endless = (signal?: AbortSignal): AsyncIterable<UIMessageChunk> =>
    new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: 'start' })
        controller.enqueue({ type: 'text-start', id: 't1' })
        controller.enqueue({ type: 'text-delta', id: 't1', delta: 'Still' })
        signal?.addEventListener('abort', () =>
          controller.error(new DOMException('', 'AbortError')),
        )
      },
    })

  function handoff() {
    let taken: [string | null, () => string | null] = [null, () => null]
    function Probe() {
      taken = useAskHandoff()
      return null
    }
    render(<Probe />)
    return () => taken
  }

  it('drops the chat so far, an answer still coming included, and leaves the question to send once', async () => {
    vi.spyOn(api, 'assistantChat').mockImplementation((_input, options) =>
      Promise.resolve(endless(options?.signal)),
    )
    void askChat().sendMessage({ text: 'Why did orders drop?' })
    await vi.waitFor(() => expect(askChat().store.status).toBe('streaming'))
    // A question typed in the composer and not sent stays where it is.
    setAskDraftText('And in the Netherlands?')
    const current = handoff()

    act(() => askInNewChat('  What can this app do?  '))
    expect(askChat().store.messages).toEqual([])
    expect(askChat().store.status).toBe('ready')
    expect(askDraftText()).toBe('And in the Netherlands?')
    const [question, take] = current()
    expect(question).toBe('What can this app do?')
    let first: string | null = null
    act(() => {
      first = take()
    })
    expect(first).toBe('What can this app do?')
    expect(current()[0]).toBeNull()
    expect(take()).toBeNull()
  })

  it('does nothing with no words', () => {
    resetAskChat([asked])
    askInNewChat('   ')
    expect(askChat().store.messages).toEqual([asked])
  })
})
