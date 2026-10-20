import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { removedNotice } from '../../contract/assistant.ts'
import { AskAnswer, type AnswerActions } from '@/components/assistant/ask-answer'
import { readAnswer, type AskMessage } from '@/lib/assistant'
import { resetAskChat } from '@/lib/assistant-chat'
import { QueryFrame, RouterFrame } from './router-frame'
import { StoryApp } from './story-app'

/*
  The assistant's Ask tab (Assistant board, direction A with C's shared scope) on the mock's
  scripted assistant: the empty state with its suggested questions, an answer with checked
  chips and the facts it read, a greeting that reads no scope, a conversation of two turns that each say who wrote them, an answer rated with a thumb, nothing found, a long answer, a
  table of the domains in the panel and on a phone, a spending limit, a failure part way, a
  refusal, the answer while it works, a short answer shown in full, the question with its metric, market and dates as chips (the
  offer of a chip, the @ list, the dates panel), the "Heed reads" line under the words (as typed,
  carried, pinned, with dates it cannot read, and on a phone), the page and the phone. The last
  stories draw one answer from an invented message: statements the check removed, and a draft
  the assistant wrote, waiting to be confirmed (every field with its source, a page read and an
  unsure date; long words), being saved, and saved with the way to it. Use the viewport menu for
  1440, 1024 and 390 and the theme menu for dark.
*/

const meta = {
  title: 'Assistant/Ask',
  parameters: { layout: 'fullscreen' },
  // Each story starts a new conversation: the chat lives in its module, like the app's.
  beforeEach: () => resetAskChat(),
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const MATCH = 'Which facts apply to Average order value in the United Kingdom in June 2026?'

async function openAsk() {
  await userEvent.click(await screen.findByRole('button', { name: 'Assistant' }, { timeout: 5000 }))
  return screen.findByRole('region', { name: 'Assistant' }, { timeout: 5000 })
}

/** The question's box once it is the chip editor, which is a chunk of its own. */
async function questionBox() {
  await waitFor(
    () =>
      expect(document.querySelector('[data-slot="ask-composer"]')).toHaveAttribute(
        'data-box',
        'chips',
      ),
    { timeout: 5000 },
  )
  return screen.getByRole('textbox', { name: 'Your question' })
}

async function ask(question: string) {
  await userEvent.type(await questionBox(), `${question}{Enter}`)
}

/** The latest answer is done: its words are in, whether or not it had a fact to check. */
const answered = () =>
  waitFor(
    () =>
      expect([...document.querySelectorAll('[data-slot="ask-answer"]')].at(-1)).toHaveAttribute(
        'data-state',
        'done',
      ),
    { timeout: 10_000 },
  )

/** Before the first question: what the assistant does, and five questions that teach it. */
export const Empty: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await expect(
      await within(panel).findByRole('list', { name: 'Suggested questions' }),
    ).toBeVisible()
  },
}

/**
 * Two facts apply, and the two that don't are folded apart: each fact is a block that previews it,
 * and the check's own report.
 */
export const Answer: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    await ask(MATCH)
    await answered()
    await expect(
      screen.getByText('Two facts apply to Average order value, United Kingdom.'),
    ).toBeVisible()
    await expect(screen.getByText('Facts that don’t apply')).toBeVisible()
    // It read a scope: a link to it, and What an agent would get for it.
    await expect(
      screen.getByRole('button', { name: 'Copy a link to these metrics and dates' }),
    ).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Open in Try a question' })).toBeVisible()
  },
}

/** A greeting: answered at once, reading no scope, so it offers no link to one. */
export const Greeting: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    await ask('hello')
    await answered()
    await expect(screen.getByRole('button', { name: 'Copy answer' })).toBeVisible()
    await expect(
      screen.queryByRole('button', { name: 'Copy a link to these metrics and dates' }),
    ).toBeNull()
    await expect(screen.queryByRole('button', { name: 'Open in Try a question' })).toBeNull()
  },
}

/**
 * "What you mean?" after an answer is about that answer: it is answered from the chat, with no
 * step, no fact, no scope carried from the question before and no date assumed.
 */
export const FollowUp: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await ask('Make this clearer: why did average order value drop in the Netherlands?')
    await answered()
    await ask('what you mean?')
    await waitFor(() => expect(panel.querySelectorAll('[data-slot="ask-answer"]')).toHaveLength(2))
    await answered()
    const second = [...panel.querySelectorAll<HTMLElement>('[data-slot="ask-answer"]')].at(-1)!
    await expect(second).toHaveTextContent(/Let me put it another way\./)
    await expect(
      within(second).queryByRole('button', { name: /What the assistant did/ }),
    ).toBeNull()
    const question = [...panel.querySelectorAll<HTMLElement>('[data-slot="ask-question"]')].at(-1)!
    await expect(question).not.toHaveTextContent(/from your last question|No dates given/)
    await expect(within(question).queryByRole('list', { name: 'Asked about' })).toBeNull()
    // Both answers in view: the first one's row is not left under the panel's bar.
    panel.querySelector('[data-slot="ask-question"]')?.scrollIntoView({ block: 'center' })
  },
}

/** Two questions and their answers: each turn says who wrote it, You on the right. */
export const Conversation: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await ask(MATCH)
    await answered()
    await ask('Which facts apply to Average order value in the United Kingdom in January 2019?')
    await expect(
      await within(panel).findByText('Nothing is written down for this', {}, { timeout: 10_000 }),
    ).toBeVisible()
    const labels = panel.querySelectorAll<HTMLElement>('[data-slot="ask-turn-label"]')
    await expect([...labels].map((label) => label.dataset.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    // Both answers in view: the first one's row is not left under the panel's bar.
    panel.querySelector('[data-slot="ask-question"]')?.scrollIntoView({ block: 'center' })
  },
}

/**
 * Thumbs up on an answer (FR-712): the service counts the verdict in the answer's domain and
 * keeps nothing else, so the thumb stays pressed and the answer takes no second rating.
 */
export const Rated: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    await ask(MATCH)
    await answered()
    await userEvent.click(screen.getByRole('button', { name: 'Good answer' }))
    const given = await screen.findByRole('button', { name: 'You rated this a good answer' })
    await expect(given).toHaveAttribute('aria-pressed', 'true')
    await expect(screen.getByRole('button', { name: 'Something was wrong' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(screen.getByText('Thanks. We keep only the count.')).toBeVisible()
  },
}

/** Nothing applies: it says so, names the nearby facts and why, and offers a draft. */
export const NotFound: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    await ask('Which facts apply to Average order value in the United Kingdom in January 2019?')
    await expect(
      await screen.findByText('Nothing is written down for this', {}, { timeout: 10_000 }),
    ).toBeVisible()
  },
}

/** A short answer: shown in full, with no fade and no Show the rest of the answer. */
export const Short: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    await ask('Make this clearer: why did average order value drop in the Netherlands?')
    await answered()
    await expect(screen.queryByRole('button', { name: 'Show the rest of the answer' })).toBeNull()
    await expect(document.querySelector('[data-slot="ask-answer-text"]')).not.toHaveAttribute(
      'data-folded',
    )
  },
}

/** A summary of a domain: folded, and stopped at its length limit. */
export const Long: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    await ask('What does the Sales domain cover?')
    await expect(
      await screen.findByText('The answer reached its length limit', {}, { timeout: 10_000 }),
    ).toBeVisible()
  },
}

/** Today's limit reached: which, when it resets, and What an agent would get still works. */
export const Limit: Story = {
  render: () => <StoryApp path="/" scenario="assistant-limit" />,
  play: async () => {
    await openAsk()
    await ask(MATCH)
    await expect(
      await screen.findByText(
        'You’ve reached today’s limit for the assistant',
        {},
        { timeout: 10_000 },
      ),
    ).toBeVisible()
  },
}

/** The model's service stopped part way: what came stays, with Try again. */
export const Failed: Story = {
  render: () => <StoryApp path="/" scenario="assistant-fails" />,
  play: async () => {
    await openAsk()
    await ask(MATCH)
    await expect(
      await screen.findByText('The assistant couldn’t finish', {}, { timeout: 10_000 }),
    ).toBeVisible()
  },
}

/** The model declined: a plain note that the assistant can't answer, and the facts it read. */
export const Refused: Story = {
  render: () => <StoryApp path="/" scenario="assistant-refuses" />,
  play: async () => {
    await openAsk()
    await ask(MATCH)
    await expect(
      await screen.findByText('The assistant can’t answer this one', {}, { timeout: 10_000 }),
    ).toBeVisible()
  },
}

/** While it works: the steps so far, lines that wait for words, and Stop. */
export const Working: Story = {
  render: () => <StoryApp path="/" scenario="slow" />,
  play: async () => {
    await openAsk()
    await ask(MATCH)
    await expect(
      await screen.findByText(
        'Working on it. Each sentence shows once it’s checked.',
        {},
        { timeout: 10_000 },
      ),
    ).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible()
  },
}

/**
 * The captain's question as typed (Heed composer, stage 2): Heed reads "net revenue", "United Kingdom"
 * and "2026", underlines them and offers each as a chip under the words, which Tab or a click
 * takes. Nothing becomes a chip by itself.
 */
export const ChipOffer: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await userEvent.type(await questionBox(), 'what was net revenue in the United Kingdom in 2026?')
    await expect(
      await within(panel).findByText('a chip?', { exact: false }, { timeout: 5000 }),
    ).toBeVisible()
    await expect(
      within(panel).getByRole('button', { name: 'Make “net revenue” Net revenue, metric' }),
    ).toBeVisible()
  },
}

/**
 * The question with its metric, its market and its dates as chips in the words: the dates chip
 * shows the days it reads, each chip has a remove button, and the "Heed reads" line mirrors them.
 */
export const ChipsInQuestion: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    const box = await questionBox()
    await userEvent.type(box, 'what was net revenue in the United Kingdom in 2026?')
    for (const words of ['net revenue', 'United Kingdom', '2026']) {
      await within(panel).findByText(`“${words}”`, {}, { timeout: 5000 })
      await userEvent.keyboard('{Tab}')
    }
    await waitFor(() => expect(box.querySelectorAll('[data-chip="ask"]')).toHaveLength(3))
    await expect(await readsLine(panel)).toHaveTextContent('1 Jan to 31 Dec 2026')
  },
}

/** @ lists metrics, values and dimensions at the caret, above the box, with a row for dates. */
export const ChipList: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    await userEvent.type(await questionBox(), 'orders in @high')
    await expect(
      await screen.findByRole('listbox', {
        name: 'Mention a metric, value, dimension, fact or domain',
      }),
    ).toBeVisible()
    await expect(screen.getByRole('option', { name: 'Pick dates…' })).toBeVisible()
  },
}

/**
 * @ lists what item text can mention, grouped by type: metrics, values and dimensions, accepted
 * items and domains (the shared picker). People are never offered in the question.
 */
export const MentionList: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    await userEvent.type(await questionBox(), 'what is @co')
    const list = await screen.findByRole('listbox', {
      name: 'Mention a metric, value, dimension, fact or domain',
    })
    await expect(within(list).getByRole('group', { name: 'Facts' })).toBeVisible()
    await expect(within(list).getByRole('group', { name: 'Domains' })).toBeVisible()
  },
}

/** A domain and an item as chips in the question: the domain in its hue, the item with its kind. */
export const MentionChips: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    await openAsk()
    const box = await questionBox()
    await userEvent.type(box, 'what does @sales')
    await userEvent.click(await screen.findByRole('option', { name: /^Sales/ }))
    await userEvent.type(box, 'say about @comparing order')
    const list = await screen.findByRole('listbox', {
      name: 'Mention a metric, value, dimension, fact or domain',
    })
    await userEvent.click(
      within(within(list).getByRole('group', { name: 'Facts' })).getAllByRole('option')[0]!,
    )
    await waitFor(() => expect(box.querySelectorAll('[data-chip="ask"]')).toHaveLength(2))
  },
}

/**
 * The dates of the question, from the Dates button: quick periods, the first and last day, and
 * today, which a new one starts at. It opens above the composer, on a phone too.
 */
export const DatesPanel: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await userEvent.type(await questionBox(), 'orders in the United Kingdom ')
    await userEvent.click(within(panel).getByRole('button', { name: 'Dates of the question' }))
    await expect(await screen.findByText('Dates of the question')).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}

const readsLine = (panel: HTMLElement) =>
  within(panel).findByRole('list', { name: 'About' }, { timeout: 5000 })

/**
 * "Heed reads", under the words (Heed composer, stage 1): the market and the whole year the words
 * name, and "revenue", which names two metrics, with one click for each. The question goes with
 * exactly what the line shows, and the assistant's tool calls read it.
 */
export const ReadsAsTyped: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await userEvent.type(await questionBox(), 'what was revenue in the United Kingdom in 2026')
    const line = await readsLine(panel)
    await within(line).findByText('which one?', { exact: false }, { timeout: 5000 })
    await expect(
      within(line).getByRole('button', { name: 'Use Net revenue for “revenue”' }),
    ).toBeVisible()
    await expect(line).toHaveTextContent('1 Jan to 31 Dec 2026')
  },
}

/**
 * The follow-up: the market in the words replaces the market carried, and the metric and the
 * dates of the last question are carried, dashed, each with a remove button.
 */
export const ReadsCarried: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await ask(MATCH)
    await answered()
    await userEvent.type(await questionBox(), 'and in the Netherlands?')
    const line = await readsLine(panel)
    await within(line).findByText('Netherlands', {}, { timeout: 5000 })
    await expect(
      within(line).getByRole('button', {
        name: 'Remove Average order value, carried from your last question',
      }),
    ).toBeVisible()
  },
}

/**
 * A scope picked outside the question (from the address, or What an agent would get) and pinned:
 * it stays for the next questions, solid, with the pin pressed.
 */
export const ReadsPinned: Story = {
  render: () => <StoryApp path="/assistant?about=metric:average_order_value" />,
  play: async () => {
    await questionBox()
    const pin = await screen.findByRole(
      'button',
      { name: 'Keep what you picked for the next questions' },
      { timeout: 5000 },
    )
    await userEvent.click(pin)
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
  },
}

/** Words that name dates Heed cannot read are named, with Pick dates beside them. */
export const ReadsUnreadableDates: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await userEvent.type(await questionBox(), 'orders in the United Kingdom since the launch')
    const line = await readsLine(panel)
    await expect(
      await within(line).findByRole('button', { name: 'Pick dates' }, { timeout: 5000 }),
    ).toBeVisible()
  },
}

const COMPARE = 'Compare the domains side by side'

/**
 * Every domain side by side: a table as models write one, straight after its sentence and with
 * lines after it, which scrolls sideways in the panel with its first column in view; the page's
 * path at the end is a link to it.
 */
export const DomainsTable: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const panel = await openAsk()
    await ask(COMPARE)
    await answered()
    await expect(within(panel).getByRole('table')).toBeVisible()
    await expect(within(panel).getByRole('link', { name: '/library?view=attention' })).toBeVisible()
    await expect(within(panel).queryByText(/\|/)).toBeNull()
  },
}

/** The same table on a phone, where the panel fills the screen. */
export const DomainsTablePhone: Story = {
  render: () => <StoryApp path="/" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async () => {
    await openAsk()
    await ask(COMPARE)
    await answered()
    await expect(screen.getByRole('table')).toBeVisible()
  },
}

/** The line on a phone: chips wrap, and the choices are touch targets. */
export const ReadsPhone: Story = {
  render: () => <StoryApp path="/" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: ReadsAsTyped.play,
}

/** The page: the same conversation with room, and what the latest answer read beside it. */
export const Page: Story = {
  render: () => (
    <StoryApp path="/assistant?about=metric:average_order_value,val:market/united_kingdom&from=2026-06-01&to=2026-06-30" />
  ),
  play: async () => {
    await ask('Which facts apply to this scope?')
    await answered()
  },
}

/** The phone: the panel fills the screen. */
export const Phone: Story = {
  render: () => <StoryApp path="/" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async () => {
    await openAsk()
    await ask(MATCH)
    await answered()
  },
}

/** The library's words for the facts of an invented answer: kind, domain and dates. */
const library: Record<
  string,
  {
    kind: 'event' | 'note'
    areaName: string
    summary: string
    validity: { start: string; end: string | null }
    until: string | null
  }
> = {
  itm_bc82d3vq: {
    kind: 'event',
    areaName: 'Paid media',
    summary: 'We switched the Netherlands to a new payment provider on 19 February 2025.',
    validity: { start: '2025-02-19', end: null },
    until: null,
  },
  itm_kuof5rah: {
    kind: 'event',
    areaName: 'Marketing',
    summary: 'We switched the Netherlands to a new payment provider on 27 September 2024.',
    validity: { start: '2024-09-27', end: null },
    until: null,
  },
  itm_0im6wo6d: {
    kind: 'note',
    areaName: 'Sales',
    summary: 'Which markets moved most against the Netherlands?',
    validity: { start: '2026-05-16', end: '2027-01-18' },
    until: '2027-01-17',
  },
}

const noop = () => undefined
const actions: AnswerActions = {
  onOpenAgent: noop,
  agentHref: () => '/try-it',
  onCopy: noop,
  onRetry: noop,
  onContinue: noop,
  onNewChat: noop,
  onApprove: noop,
  rating: { given: null, sending: false, onRate: noop },
}

/** An invented answer: one fact read, and two statements the citation check removed. */
const removed: AskMessage = {
  id: 'a1',
  role: 'assistant',
  parts: [
    {
      type: 'dynamic-tool',
      toolName: 'read_item',
      toolCallId: 'c1',
      state: 'output-available',
      input: { id: 'itm_wsd3duw0' },
      output: {
        edition: '2026-10-07.2',
        item: {
          id: 'itm_wsd3duw0',
          kind: 'event',
          title: 'Payment provider switched in the United Kingdom on 12 June 2026',
        },
      },
    },
    {
      type: 'text',
      state: 'done',
      text: `[itm_wsd3duw0] says figures before and after 12 June may not be comparable. ${removedNotice.unknown_item} ${removedNotice.unverified_quote}`,
    },
    {
      type: 'data-citations',
      data: {
        cited: ['itm_wsd3duw0'],
        removed: [
          { reason: 'unknown_item', ids: ['itm_madeup01'] },
          { reason: 'unverified_quote', ids: [] },
        ],
        quoted: 0,
      },
    },
  ],
}

/**
 * An invented answer to a question about a change: it starts with what the facts cannot show, then
 * lists the facts that apply as blocks. Two facts share a title and differ by their dates, one
 * title is long enough to wrap, and a fact that doesn't apply waits in a folded list of its own.
 */
const facts: AskMessage = {
  id: 'a2',
  role: 'assistant',
  parts: [
    {
      type: 'dynamic-tool',
      toolName: 'get_context',
      toolCallId: 'c2',
      state: 'output-available',
      input: {},
      output: {
        edition: '2026-10-07.2',
        items: [
          {
            id: 'itm_bc82d3vq',
            kind: 'event',
            title: 'Payment provider switched in the Netherlands on 19 February 2025',
          },
          {
            id: 'itm_kuof5rah',
            kind: 'event',
            title: 'Payment provider switched in the Netherlands on 27 September 2024',
          },
          {
            id: 'itm_0im6wo6d',
            kind: 'note',
            title:
              'Which markets drove the change in Online share, with the Netherlands as the baseline?',
          },
        ],
      },
    },
    {
      type: 'dynamic-tool',
      toolName: 'explain_item',
      toolCallId: 'c3',
      state: 'output-available',
      input: {},
      output: {
        id: 'itm_00ci02mc',
        title: 'Outage affected tracking in the Netherlands on 3 March 2026',
        applies: false,
        reason: "It's about other metrics.",
      },
    },
    {
      type: 'text',
      state: 'done',
      text: [
        "**The facts can't show whether Average order value in the Netherlands dropped, or why.**",
        "Three facts are related to Average order value, Netherlands. A fact can't prove a cause.",
        '- [itm_bc82d3vq] We switched the Netherlands to a new payment provider on 19 February 2025.',
        '- [itm_kuof5rah] We switched the Netherlands to a new payment provider on 27 September 2024.',
        '- [itm_0im6wo6d]',
      ].join('\n\n'),
    },
    {
      type: 'data-citations',
      data: {
        cited: ['itm_bc82d3vq', 'itm_kuof5rah', 'itm_0im6wo6d'],
        removed: [],
        quoted: 0,
      },
    },
  ],
}

export const FactBlocks: Story = {
  render: () => (
    <QueryFrame>
      <RouterFrame>
        <div className="max-w-dock p-6">
          <AskAnswer
            answer={readAnswer(facts)}
            scope={null}
            scopeText={null}
            lookup={(id) => library[id] ?? null}
            working={false}
            failed={null}
            latest
            actions={actions}
          />
        </div>
      </RouterFrame>
    </QueryFrame>
  ),
  play: async () => {
    await expect(
      await screen.findByText(
        "The facts can't show whether Average order value in the Netherlands dropped, or why.",
      ),
    ).toBeVisible()
    // That they were read for this answer is said once, above the list; each block has its whole
    // title, a quiet line that tells the two switches apart, and what it says.
    await expect(screen.getAllByText('Facts I read for this answer')).toHaveLength(1)
    const blocks = document.querySelectorAll('[data-slot="answer-fact"]')
    await expect(blocks).toHaveLength(3)
    await expect(blocks[0]).toHaveTextContent('Event · Paid media · from 19 Feb 2025')
    await expect(blocks[1]).toHaveTextContent('Event · Marketing · from 27 Sept 2024')
    await expect(blocks[2]).toHaveTextContent(
      'Which markets drove the change in Online share, with the Netherlands as the baseline?',
    )
    await expect(blocks[2]).toHaveTextContent('Note · Sales · 16 May 2026 to 17 Jan 2027')
    // The fact that doesn't apply is folded apart, never in the words.
    const apart = document.querySelector('[data-slot="ask-facts-apart"]')!
    await expect(apart).not.toHaveAttribute('open')
    await expect(within(apart as HTMLElement).getByText('Facts that don’t apply')).toBeVisible()
  },
}

export const RemovedStatements: Story = {
  render: () => (
    <QueryFrame>
      <RouterFrame>
        <div className="max-w-dock p-6">
          <AskAnswer
            answer={readAnswer(removed)}
            scope={null}
            scopeText={null}
            lookup={() => null}
            working={false}
            failed={null}
            latest
            actions={actions}
          />
        </div>
      </RouterFrame>
    </QueryFrame>
  ),
  play: async () => {
    // Each removed statement stays visible as a notice where it was, and the checked row
    // counts it and says why.
    for (const words of [
      'I removed a sentence that named a fact I hadn’t read.',
      'I removed a quote I couldn’t find in the facts I read.',
      'Left out a sentence that named a fact I hadn’t read, marked above.',
      'Left out a quote I couldn’t find in the facts I read, marked above.',
    ])
      await expect(await screen.findByText(words)).toBeVisible()
  },
}

/** The web lookup example: a page read for the evidence, and a date the person was unsure of. */
const PAGE = 'https://consumer.example/eu/right-of-withdrawal'
const returnsInput = {
  draft: {
    kind: 'event',
    title: 'Customers have 14 days to send back online orders',
    summary:
      'From 1 October 2026, customers in Norway have 14 days to send back an online order without giving a reason.',
    body: 'Returns are refunded within 14 days of the customer saying they want to send the order back. The customer pays for sending it back unless we offer free returns.',
    notToConclude: 'This is not legal advice.',
    areaId: 'area_sales',
    scope: {
      metrics: ['metric:returns', 'metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-10-01', end: null },
    reviewDate: '2027-01-29',
    evidence: [
      {
        url: PAGE,
        quote:
          'Consumers have 14 days to withdraw from an online purchase without giving any reason.',
        date: '2026-10-15',
      },
    ],
  },
  sources: {
    summary: 'your_text',
    scope: 'your_text',
    'validity.start': 'suggested',
    areaId: 'suggested',
    evidence: 'suggested',
    notToConclude: 'suggested',
  },
  dates_uncertain: true,
}
const readPage = {
  type: 'dynamic-tool' as const,
  toolName: 'read_source',
  toolCallId: 'r1',
  input: { url: PAGE },
  state: 'output-available' as const,
  output: {
    url: PAGE,
    read_on: '2026-10-15',
    passages: [
      'Consumers have 14 days to withdraw from an online purchase without giving any reason.',
    ],
  },
}
const names: Record<string, string> = {
  'metric:returns': 'Returns',
  'metric:orders': 'Orders',
  'dim:market': 'Market',
  'val:market/norway': 'Norway',
}
const named = {
  areas: [{ id: 'area_sales', name: 'Sales' }],
  nameOf: (key: string) => names[key],
}

/** A draft the assistant wrote, saved only when the person confirms it. */
const proposing = (
  input: Record<string, unknown>,
  part: Record<string, unknown> = { state: 'approval-requested', approval: { id: 'approval-1' } },
): AskMessage => ({
  id: 'a2',
  role: 'assistant',
  parts: [
    readPage,
    {
      type: 'text',
      text: "You weren't sure of the date, so I started it on 1 October 2026 and marked the dates as uncertain for the owner.",
    },
    {
      type: 'dynamic-tool',
      toolName: 'create_draft',
      toolCallId: 'c2',
      input,
      ...part,
    } as AskMessage['parts'][number],
  ],
})

function DraftAnswer({ message }: { message: AskMessage }) {
  return (
    <QueryFrame>
      <RouterFrame>
        <div className="max-w-dock p-6">
          <AskAnswer
            answer={readAnswer(message, named)}
            scope={null}
            scopeText={null}
            lookup={() => null}
            working={false}
            failed={null}
            latest
            actions={actions}
          />
        </div>
      </RouterFrame>
    </QueryFrame>
  )
}

/** Every field to review, its source beside it, the dates flagged and the page it read. */
export const ConfirmDraft: Story = {
  render: () => <DraftAnswer message={proposing(returnsInput)} />,
  play: async () => {
    await expect(await screen.findByText('New fact · not saved yet')).toBeVisible()
    await expect(screen.getByText('Uncertain')).toBeVisible()
    await expect(screen.getByText('From consumer.example')).toBeVisible()
    await expect(screen.getByText('Market: Norway')).toBeVisible()
    await expect(screen.getByText(/of 280 characters$/)).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Create draft' })).toBeVisible()
    await expect(screen.queryByRole('link', { name: /Open draft/ })).toBeNull()
  },
}

/** Long words wrap inside the card; the detail and what not to conclude fold under More. */
export const ConfirmDraftLong: Story = {
  render: () => (
    <DraftAnswer
      message={proposing({
        ...returnsInput,
        draft: {
          ...returnsInput.draft,
          title:
            'Customers in every Norway store and on every marketplace have 14 days to send back what they buy online, without giving any reason',
          summary:
            'From 1 October 2026, customers in Norway have 14 days to send back footwear, clothing, camping and climbing gear they bought online, from the day the order arrives, without giving any reason, and the refund must follow within 14 days of being told.',
          body: `${'Returns are refunded within 14 days of the customer saying they want to send the order back, with the standard shipping cost. '.repeat(4)}The customer pays for sending the order back unless we offer free returns.`,
          evidence: [
            {
              url: `${PAGE}?version=consolidated&anchor=article-9-paragraph-2-point-b-online-orders`,
              quote:
                'Consumers have 14 days to withdraw from an online purchase without giving any reason, counted from the day the consumer, or someone the consumer names, takes physical possession of the goods.',
              date: '2026-10-15',
            },
          ],
        },
      })}
    />
  ),
  play: async () => {
    await expect(await screen.findByText('New fact · not saved yet')).toBeVisible()
    await userEvent.click(screen.getByText(/^More:/))
    await expect(screen.getByText(/The customer pays for sending the order back/)).toBeVisible()
  },
}

/** Confirmed and being saved: the card stays, with nothing left to answer. */
export const DraftSaving: Story = {
  render: () => (
    <DraftAnswer
      message={proposing(returnsInput, {
        state: 'approval-responded',
        approval: { id: 'approval-1', approved: true },
      })}
    />
  ),
  play: async () => {
    await expect(await screen.findByText('Saving the draft')).toBeVisible()
    await expect(screen.queryByRole('button', { name: 'Create draft' })).toBeNull()
  },
}

/** A draft the assistant saved: the card links to it, to check each part and send it for review. */
const saved = (input: Record<string, unknown>): AskMessage => ({
  id: 'a3',
  role: 'assistant',
  parts: [
    {
      type: 'dynamic-tool',
      toolName: 'create_draft',
      toolCallId: 'c3',
      state: 'output-available',
      input: {
        draft: { kind: 'event', title: 'Orders in Poland arrive two days late' },
        ...input,
      },
      output: { proposal_id: 'prp_saved', number: 42, label: 'unreviewed draft' },
    },
    {
      type: 'text',
      text: 'I saved it as your draft. Open it, check each part, then send it for review.',
    },
  ],
})

function SavedAnswer({ message }: { message: AskMessage }) {
  return (
    <QueryFrame>
      <RouterFrame>
        <div className="max-w-dock p-6">
          <AskAnswer
            answer={readAnswer(message)}
            scope={null}
            scopeText={null}
            lookup={() => null}
            working={false}
            failed={null}
            latest
            actions={actions}
          />
        </div>
      </RouterFrame>
    </QueryFrame>
  )
}

export const DraftSaved: Story = {
  render: () => <SavedAnswer message={saved({})} />,
  play: async () => {
    await expect(await screen.findByText('Saved an unreviewed draft')).toBeVisible()
    await expect(screen.getByText('Saved as your draft #42')).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Open draft #42' })).toHaveAttribute(
      'href',
      '/library/new?draft=prp_saved',
    )
  },
}

/** A saved change to an accepted item opens on Suggest a change. */
export const DraftSavedForAChange: Story = {
  render: () => <SavedAnswer message={saved({ item_id: 'itm_poland' })} />,
  play: async () => {
    await expect(await screen.findByRole('link', { name: 'Open draft #42' })).toHaveAttribute(
      'href',
      '/library/itm_poland/suggest?draft=prp_saved',
    )
  },
}
