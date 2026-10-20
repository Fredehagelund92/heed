import type * as Router from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/api'
import { MOCK_SCENARIO_KEY } from '@/api/mock-scenario'
import { AskComposer } from '@/components/assistant/ask-composer'
import { carriedOf } from '@/components/assistant/ask-reads'
import { AskTranscript } from '@/components/assistant/ask-view'
import { NewChatButton, NewChatConfirm } from '@/components/app-shell/new-chat'
import { TooltipProvider } from '@/components/ui/tooltip'
import { readQuestion } from '@/lib/assistant'
import { askChat, askInNewChat, resetAskChat } from '@/lib/assistant-chat'
import type { TryItScope } from '@/lib/try-it'

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useRouterState: () => '/',
  Link: ({
    to,
    params,
    children,
    ...props
  }: ComponentProps<'a'> & { to: string; params?: Record<string, string> }) => (
    <a
      href={Object.entries(params ?? {}).reduce((h, [k, v]) => h.replace(`$${k}`, v), to)}
      {...props}
    >
      {children}
    </a>
  ),
}))

// jsdom lays nothing out, and the chip editor (ProseMirror) measures where the caret is, so here
// the editor fails to load: these tests are the composer's fallback, the plain box with its scope
// picker, which takes over when the editor's chunk cannot load. The chip editor itself is tested in
// Chromium (tests/e2e/ask-chips.spec.ts) and its document here (ask-doc.test.ts).
vi.mock('@/components/assistant/ask-editor', () => ({
  default: () => {
    throw new Error('The chip editor needs a browser that lays out text.')
  },
}))

beforeEach(() => resetAskChat())
afterEach(() => window.localStorage.removeItem(MOCK_SCENARIO_KEY))

function withQueries(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** The Ask tab as the panel lays it out: New chat in its bar, the transcript, then the composer. */
function Ask({ onOpenAgent = () => undefined }: { onOpenAgent?: (s: TryItScope | null) => void }) {
  const [scope, setScope] = useState<TryItScope | null>(null)
  return (
    <TooltipProvider>
      <NewChatButton />
      <NewChatConfirm />
      <AskTranscript
        scope={scope}
        onScopeChange={setScope}
        onOpenAgent={onOpenAgent}
        agentHref={() => 'https://heed.example/try-it'}
      />
      <AskComposer scope={scope} onScopeChange={setScope} />
    </TooltipProvider>
  )
}

// Each test streams a whole answer from the mock binding: slower than a click on a busy machine.
const slow = { timeout: 10_000 }

/** Renders the Ask tab once its composer has fallen back to the plain box. */
async function renderAsk(props: ComponentProps<typeof Ask> = {}) {
  // React reports the editor's failure, which is what these tests mean to happen.
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const rendered = render(withQueries(<Ask {...props} />))
  await waitFor(() =>
    expect(document.querySelector('[data-slot=ask-composer]')).toHaveAttribute('data-box', 'plain'),
  )
  error.mockRestore()
  return rendered
}

describe('the Ask tab', { timeout: 30_000 }, () => {
  it('falls back to the plain box and its scope picker when the chip editor cannot load', async () => {
    await renderAsk()
    const box = screen.getByRole('textbox', { name: 'Your question' })
    expect(box.tagName).toBe('TEXTAREA')
    expect(screen.getByRole('button', { name: 'Pick what it is about (@)' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Scope: metrics, markets and dates' }),
    ).toBeInTheDocument()
  })

  it('asks a suggested question and says when the answer is ready, with its counts', async () => {
    const user = userEvent.setup()
    await renderAsk()
    const starters = await screen.findByRole('list', { name: 'Suggested questions' }, slow)
    const check = await within(starters).findByRole('button', { name: /See what applies/ }, slow)
    await user.click(check)
    const answer = await screen.findByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(answer).toHaveAttribute('data-state', 'done'), slow)
    // One polite status says it, once; the log itself is not read word by word.
    expect(document.querySelector('[data-slot=ask-announcer]')).toHaveTextContent(
      /^Answer ready\. \w+ facts? appl/,
    )
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off')
    // The question keeps the scope it was asked with; the next one carries it, dashed, with a
    // remove button for each part.
    expect(screen.getByRole('list', { name: 'Asked about' })).toBeInTheDocument()
    const reads = screen.getByRole('list', { name: 'About' })
    expect(
      within(reads).getAllByRole('button', { name: /carried from your last question$/ }),
    ).not.toHaveLength(0)
    expect(within(answer).getByRole('note')).toHaveTextContent(/^Checked before you saw it\./)
    // Editions show only on the Editions page: no edition label in the answer or the composer.
    expect(within(answer).queryByText(/\d{4}-\d{2}-\d{2}\.\d+/)).not.toBeInTheDocument()
    expect(screen.getByText('This chat isn’t saved.')).toBeInTheDocument()
    // The thumbs are ready: nothing rated yet.
    expect(within(answer).getByRole('button', { name: 'Good answer' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  /*
    The captain, 20 October 2026: "Make this clearer: why did average order value drop in
    Netherlands?", then "what you mean?" carried the metric and the market as the new scope,
    assumed a date and looked up eight facts.
  */
  it('answers "what you mean?" from the conversation: nothing carried or assumed, no lookup', async () => {
    const user = userEvent.setup()
    await renderAsk()
    const starters = await screen.findByRole('list', { name: 'Suggested questions' }, slow)
    await user.click(
      await within(starters).findByRole('button', { name: /Sharpen a question/ }, slow),
    )
    const [first] = await screen.findAllByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(first).toHaveAttribute('data-state', 'done'), slow)
    // Asked as a question, the next one would carry the metric and the market.
    const reads = document.querySelector('[data-slot=ask-reads]')!
    expect(reads).not.toHaveAttribute('hidden')
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await user.type(box, 'what you mean?')
    // Typed, it reads nothing: the line is gone, with its carried chips and its assumed day.
    expect(reads).toHaveAttribute('hidden')
    expect(box).not.toHaveAccessibleDescription(/carried|demo|today/i)
    await user.type(box, '{Enter}')
    await waitFor(
      () => expect(screen.getAllByRole('article', { name: 'Answer' })).toHaveLength(2),
      slow,
    )
    const second = screen.getAllByRole('article', { name: 'Answer' })[1]!
    await waitFor(() => expect(second).toHaveAttribute('data-state', 'done'), slow)
    expect(second).toHaveTextContent(/^Assistant\s*Let me put it another way\. The main point: /)
    // No steps, no facts, no checked row: nothing was looked up, so nothing is listed.
    expect(within(second).queryByRole('button', { name: /What the assistant did/ })).toBeNull()
    expect(second.querySelector('[data-slot=ask-facts]')).toBeNull()
    expect(within(second).queryByRole('note')).toBeNull()
    // Its question carries no scope and no note about a day it assumed.
    const questions = [...document.querySelectorAll('[data-slot=ask-question]')]
    const asked = questions.at(-1)!
    expect(asked).toHaveTextContent('what you mean?')
    expect(within(asked as HTMLElement).queryByRole('list', { name: 'Asked about' })).toBeNull()
    expect(asked.querySelector('[data-slot=ask-question-notes]')).toBeNull()
    expect(askChat().store.messages.at(-2)?.metadata).toEqual({})
    // The follow-up has no scope of its own and is passed over: the next question still carries
    // what the one before it was about.
    const messages = askChat().store.messages
    expect(carriedOf(messages)).not.toBeNull()
    expect(carriedOf(messages)).toEqual(readQuestion(messages[0]!).scope)
  })

  it('draws each fact an answer lists as a block with its whole title, and folds the ones that do not apply', async () => {
    const user = userEvent.setup()
    await renderAsk()
    await user.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Why did average order value drop in Netherlands?{Enter}',
    )
    const answer = await screen.findByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(answer).toHaveAttribute('data-state', 'done'), slow)
    // The first sentence says what the facts cannot show.
    expect(answer).toHaveTextContent(/The facts can't show whether .+ dropped, or why\./)
    const blocks = [...answer.querySelectorAll('[data-slot=answer-fact]')]
    expect(blocks.length).toBeGreaterThan(1)
    const titles = blocks.map((block) => block.querySelector('.font-bold')?.textContent)
    // Whole titles, never cut, and two facts with one title tell apart by their line.
    for (const title of titles) expect(title).not.toMatch(/…|\.\.\.$/)
    for (const block of blocks)
      expect(block.textContent).toMatch(/(?:Event|Note|Guide|Example|Issue) · .+ · .*\d{4}/)
    // That the facts were read for this answer is said once, above the list, not on every line.
    expect(within(answer).getAllByText('Facts I read for this answer')).toHaveLength(1)
    expect(answer).not.toHaveTextContent(/read in this answer/i)
    // The facts that do not apply are not in the words, and are folded under their own control.
    const apart = answer.querySelector('[data-slot=ask-facts-apart]')
    expect(apart).not.toBeNull()
    expect(apart).not.toHaveAttribute('open')
    expect(within(apart as HTMLElement).getByText('Facts that don’t apply')).toBeInTheDocument()
    for (const title of apart!.querySelectorAll('.font-bold:not(summary *)'))
      expect(titles).not.toContain(title.textContent)
  })

  it('rates an answer once, sending only the verdict and the metrics of its scope', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'rateAnswer')
    await renderAsk()
    const starters = await screen.findByRole('list', { name: 'Suggested questions' }, slow)
    await user.click(
      await within(starters).findByRole('button', { name: /See what applies/ }, slow),
    )
    const answer = await screen.findByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(answer).toHaveAttribute('data-state', 'done'), slow)
    const question = screen.getByText(/^You asked:/).parentElement!.textContent
    await user.dblClick(within(answer).getByRole('button', { name: 'Something was wrong' }))
    const given = await within(answer).findByRole('button', {
      name: 'You rated this as something wrong',
    })
    expect(given).toHaveAttribute('aria-pressed', 'true')
    expect(within(answer).getByText('Thanks. We keep only the count.')).toBeVisible()
    // The other thumb takes nothing more: a rating cannot be found again to change it.
    const other = within(answer).getByRole('button', { name: 'Good answer' })
    expect(other).toHaveAttribute('aria-disabled', 'true')
    await user.click(other)
    expect(spy).toHaveBeenCalledTimes(1)
    // Only the verdict and metric keys leave the page: no question, answer, person or note.
    const [sent] = spy.mock.calls[0]!
    expect(Object.keys(sent).sort()).toEqual(['metrics', 'verdict'])
    expect(sent).toEqual({ verdict: 'wrong', metrics: [expect.stringMatching(/^metric:/)] })
    expect(JSON.stringify(sent)).not.toContain(question.replace(/^You asked: /, ''))
    spy.mockRestore()
  })

  it('keeps the thumbs ready when a rating is not saved', async () => {
    const user = userEvent.setup()
    const spy = vi
      .spyOn(api, 'rateAnswer')
      .mockRejectedValueOnce(new ApiError('unavailable', 'Too many ratings', { status: 429 }))
    await renderAsk()
    const starters = await screen.findByRole('list', { name: 'Suggested questions' }, slow)
    await user.click(
      await within(starters).findByRole('button', { name: /See what applies/ }, slow),
    )
    const answer = await screen.findByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(answer).toHaveAttribute('data-state', 'done'), slow)
    const good = within(answer).getByRole('button', { name: 'Good answer' })
    await user.click(good)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(good).not.toHaveAttribute('aria-disabled'))
    expect(good).toHaveAttribute('aria-pressed', 'false')
    expect(within(answer).queryByText('Thanks. We keep only the count.')).toBeNull()
    // Asked again, it counts.
    await user.click(good)
    expect(
      await within(answer).findByRole('button', { name: 'You rated this a good answer' }),
    ).toHaveAttribute('aria-pressed', 'true')
    spy.mockRestore()
  })

  it('forgets the ratings with the conversation on New chat', async () => {
    const user = userEvent.setup()
    await renderAsk()
    const starters = await screen.findByRole('list', { name: 'Suggested questions' }, slow)
    await user.click(
      await within(starters).findByRole('button', { name: /See what applies/ }, slow),
    )
    let answer = await screen.findByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(answer).toHaveAttribute('data-state', 'done'), slow)
    await user.click(within(answer).getByRole('button', { name: 'Good answer' }))
    await within(answer).findByRole('button', { name: 'You rated this a good answer' })
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    const again = await screen.findByRole('list', { name: 'Suggested questions' }, slow)
    await user.click(await within(again).findByRole('button', { name: /See what applies/ }, slow))
    answer = await screen.findByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(answer).toHaveAttribute('data-state', 'done'), slow)
    expect(within(answer).getByRole('button', { name: 'Good answer' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('sends on Enter, adds a line on Shift Enter, and brings the last question back on Up', async () => {
    const user = userEvent.setup()
    await renderAsk()
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await user.type(box, 'What does the Commercial domain cover?{Shift>}{Enter}{/Shift}')
    expect(box).toHaveValue('What does the Commercial domain cover?\n')
    await user.type(box, '{Enter}')
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(
      await screen.findByText('What does the Commercial domain cover?', {}, slow),
    ).toBeInTheDocument()
    await waitFor(() => expect(askChat().store.status).toBe('ready'), slow)
    await user.type(box, '{ArrowUp}')
    expect(box).toHaveValue('What does the Commercial domain cover?')
  })

  it('shows a typed question at once while its words are read, and asks without them when that is slow', async () => {
    // The service is slow to read the words, as the local pilot was on a busy computer.
    const read = vi.spyOn(api, 'readTryItQuestion').mockReturnValue(new Promise(() => undefined))
    const chat = vi.spyOn(api, 'assistantChat')
    const user = userEvent.setup()
    await renderAsk()
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await user.type(box, 'Why did orders drop in the Netherlands?{Enter}')
    // The question is in the conversation at once, working on its answer, with Stop.
    expect(box).toHaveValue('')
    expect(
      within(screen.getByRole('log')).getByText('Why did orders drop in the Netherlands?'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(read).toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
    // It waits a little for the words to be read, then asks without them.
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1), slow)
    const answer = await screen.findByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(answer).toHaveAttribute('data-state', 'done'), slow)
    // Only the time it was sent: the scope is not read yet.
    expect(askChat().store.messages[0]?.metadata).toEqual({ at: expect.any(String) })
    read.mockRestore()
    chat.mockRestore()
  })

  it('asks a typed question at once when its words cannot be read', async () => {
    const read = vi
      .spyOn(api, 'readTryItQuestion')
      .mockRejectedValue(new ApiError('unavailable', 'The service is not reachable'))
    const user = userEvent.setup()
    await renderAsk()
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Why?{Enter}')
    const answer = await screen.findByRole('article', { name: 'Answer' }, slow)
    await waitFor(() => expect(answer).toHaveAttribute('data-state', 'done'), slow)
    read.mockRestore()
  })

  it('Stop while the words are read ends the question before it is asked', async () => {
    vi.spyOn(api, 'readTryItQuestion').mockReturnValue(new Promise(() => undefined))
    const chat = vi.spyOn(api, 'assistantChat')
    const user = userEvent.setup()
    await renderAsk()
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await user.type(box, 'Why did orders drop?{Enter}')
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(askChat().store.status).toBe('ready')
    expect(screen.getByText('Why did orders drop?')).toBeVisible()
    // Asking goes on as before.
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 3500))
    expect(chat).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('pauses asking at a spending limit, and points to What an agent would get', async () => {
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'assistant-limit')
    const user = userEvent.setup()
    const onOpenAgent = vi.fn()
    await renderAsk({ onOpenAgent })
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Why?{Enter}')
    expect(
      await screen.findByText('You’ve reached today’s limit for the assistant', {}, slow),
    ).toBeInTheDocument()
    expect(screen.queryByText(/\$2\.00/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your question' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Open Try a question' }))
    expect(onOpenAgent).toHaveBeenCalled()
  })

  it('keeps what came when an answer fails part way, and asks again on Try again', async () => {
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'assistant-fails')
    const user = userEvent.setup()
    await renderAsk()
    const starters = await screen.findByRole('list', { name: 'Suggested questions' }, slow)
    await user.click(
      await within(starters).findByRole('button', { name: /See what applies/ }, slow),
    )
    expect(await screen.findByText('The assistant couldn’t finish', {}, slow)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy what I have' })).toBeInTheDocument()
    window.localStorage.removeItem(MOCK_SCENARIO_KEY)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(
      () =>
        expect(screen.getByRole('article', { name: 'Answer' })).toHaveAttribute(
          'data-state',
          'done',
        ),
      slow,
    )
    expect(screen.queryByText('The assistant couldn’t finish')).not.toBeInTheDocument()
  })

  it('sends a question asked from Home as a new chat’s first, and keeps a typed one', async () => {
    const user = userEvent.setup()
    await renderAsk()
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await user.type(box, 'Why did orders drop?{Enter}')
    await waitFor(() => expect(askChat().store.status).toBe('ready'), slow)
    await user.type(box, 'And in the Netherlands?')

    act(() => askInNewChat('What does the Commercial domain cover?'))
    const log = await screen.findByRole('log')
    await waitFor(
      () =>
        expect(within(log).getByRole('article', { name: 'Answer' })).toHaveAttribute(
          'data-state',
          'done',
        ),
      slow,
    )
    const questions = askChat().store.messages.filter((message) => message.role === 'user')
    expect(questions.map((message) => message.parts)).toEqual([
      [{ type: 'text', text: 'What does the Commercial domain cover?' }],
    ])
    expect(within(log).queryByText('Why did orders drop?')).not.toBeInTheDocument()
    expect(within(log).getByText('What does the Commercial domain cover?')).toBeInTheDocument()
    expect(box).toHaveValue('And in the Netherlands?')
  })

  it('sends a question asked from Home once the Ask tab opens', async () => {
    askInNewChat('What does the Commercial domain cover?')
    await renderAsk()
    await waitFor(() => expect(askChat().store.messages).toHaveLength(2), slow)
    expect(askChat().store.messages[0]!.parts).toEqual([
      { type: 'text', text: 'What does the Commercial domain cover?' },
    ])
  })

  it('starts a new chat at once, and asks first only when a typed question would be lost', async () => {
    const user = userEvent.setup()
    await renderAsk()
    const newChat = screen.getByRole('button', { name: 'New chat' })
    // Nothing to start over from yet.
    expect(newChat).toBeDisabled()
    const box = screen.getByRole('textbox', { name: 'Your question' })
    await user.type(box, 'What does the Commercial domain cover?{Enter}')
    await waitFor(() => expect(askChat().store.status).toBe('ready'), slow)
    expect(screen.getByRole('log')).toBeInTheDocument()

    // Nothing typed: the chat goes at once, with no question asked.
    await user.click(newChat)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(askChat().store.messages).toEqual([])
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    expect(box).toHaveFocus()

    // A typed question that was not sent: New chat asks first, and Keep typing keeps both.
    await user.type(box, 'Why did orders drop?{Enter}')
    await waitFor(() => expect(askChat().store.status).toBe('ready'), slow)
    await user.type(box, 'And in the Netherlands?')
    await user.click(newChat)
    const dialog = await screen.findByRole('alertdialog', { name: 'Start a new chat?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep typing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(askChat().store.messages).toHaveLength(2)
    expect(box).toHaveValue('And in the Netherlands?')

    // Confirmed, the chat and the typed question both go.
    await user.click(newChat)
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Start new chat',
      }),
    )
    await waitFor(() => expect(askChat().store.messages).toEqual([]))
    expect(box).toHaveValue('')
  })
})
