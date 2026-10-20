import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, within } from 'storybook/test'
import { removedNotice } from '../../contract/assistant.ts'
import { AskAnswer, type AnswerActions } from '@/components/assistant/ask-answer'
import { readAnswer, type AskMessage } from '@/lib/assistant'
import { answerFixtures, FIXTURE_FACT, type AnswerFixtureName } from '@/mocks/answers'
import { cn } from '@/lib/utils'
import { QueryFrame, RouterFrame } from './router-frame'
import { productName } from '@/lib/brand'

/*
  How the assistant's answers read (lib/answer-markdown.ts): one story for each kind of Markdown
  an answer uses (mocks/answers.ts), the first a real answer word for word, each drawn as the
  docked panel's width and as the page's. A table wider than the answer scrolls sideways in its
  frame with its first column in view; a page of Heed is a link in the app. The last story is an
  answer while it streams: a table's header waits for its delimiter line. Use the viewport menu
  for 1440, 1024 and 390 and the theme menu for dark.
*/

const meta = {
  title: 'Assistant/Answer formatting',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

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

/** An invented answer with these words: it read the fixtures' one fact, and the check's report. */
function messageOf(text: string): AskMessage {
  const removed = Object.entries(removedNotice).flatMap(([reason, notice]) =>
    text.includes(notice) ? [{ reason: reason as keyof typeof removedNotice, ids: [] }] : [],
  )
  return {
    id: 'answer',
    role: 'assistant',
    parts: [
      {
        type: 'dynamic-tool',
        toolName: 'read_item',
        toolCallId: 'read',
        state: 'output-available',
        input: { id: FIXTURE_FACT.id },
        output: { edition: '2026-10-07.2', item: FIXTURE_FACT },
      },
      { type: 'text', state: 'done', text },
      {
        type: 'data-citations',
        data: {
          cited: text.includes(FIXTURE_FACT.id) ? [FIXTURE_FACT.id] : [],
          removed,
          quoted: 0,
        },
      },
    ],
  }
}

/** The answer as the docked panel draws it, and as the page does, side by side when they fit. */
function Frames({ text, working = false }: { text: string; working?: boolean }) {
  const answer = readAnswer(messageOf(text))
  const frames = [
    { label: 'In the docked panel', className: 'max-w-assistant' },
    { label: 'On the assistant page', className: 'max-w-reading' },
  ]
  return (
    <QueryFrame>
      <RouterFrame>
        <div className="flex flex-wrap items-start gap-12 bg-background p-6">
          {frames.map((frame) => (
            <section
              key={frame.label}
              aria-label={frame.label}
              className={cn('flex w-full min-w-0 flex-col gap-3', frame.className)}
            >
              <p className="text-caption text-muted-foreground">{frame.label}</p>
              <AskAnswer
                answer={answer}
                scope={null}
                scopeText={null}
                lookup={() => null}
                working={working}
                failed={null}
                latest
                actions={actions}
              />
            </section>
          ))}
        </div>
      </RouterFrame>
    </QueryFrame>
  )
}

const story = (name: AnswerFixtureName, play?: Story['play']): Story => ({
  name: answerFixtures[name].name,
  render: () => <Frames text={answerFixtures[name].text} />,
  play: async (context) => {
    const panel = await screen.findByRole('region', { name: 'In the docked panel' })
    await expect(within(panel).getByRole('article', { name: 'Answer' })).toBeVisible()
    await play?.(context)
  },
})

/** A real answer: a table straight after its sentence, lines after it, a page's path. */
export const Domains = story('domains', async () => {
  const panel = await screen.findByRole('region', { name: 'In the docked panel' })
  await expect(within(panel).getByRole('table')).toBeVisible()
  await expect(within(panel).getByRole('rowheader', { name: 'Paid media' })).toBeVisible()
  await expect(within(panel).getByRole('link', { name: '/library?view=attention' })).toBeVisible()
  await expect(within(panel).queryByText(/\|/)).toBeNull()
})
export const Prose = story('prose')
export const Lists = story('lists')
export const Tables = story('tables')
export const Wide = story('wide', async () => {
  // Wider than the panel: it scrolls in its own frame, which the keyboard reaches.
  const panel = await screen.findByRole('region', { name: 'In the docked panel' })
  const frame = within(panel).getByRole('group', { name: 'Table' })
  await expect(frame.scrollWidth).toBeGreaterThan(frame.clientWidth)
  await expect(frame).toHaveAttribute('tabindex', '0')
})
export const Code = story('code')
export const Links = story('links')
export const Quote = story('quote')
export const Breaks = story('breaks')
export const Long = story('long')
export const Unsafe = story('unsafe')
export const Removed = story('removed', async () => {
  const panel = await screen.findByRole('region', { name: 'In the docked panel' })
  await expect(
    within(panel).getByText('I removed a sentence that named a fact I hadn’t read.'),
  ).toBeVisible()
  await expect(within(panel).getAllByRole('row')).toHaveLength(4)
})

/** While the answer streams: the table's header has come, its delimiter line not yet. */
export const Streaming: Story = {
  render: () => (
    <Frames text={answerFixtures.domains.text.split('\n').slice(0, 2).join('\n')} working />
  ),
  play: async () => {
    const panel = await screen.findByRole('region', { name: 'In the docked panel' })
    await expect(
      await within(panel).findByText(
        `${productName} has five domains, as of edition 2026-10-07.2.`,
      ),
    ).toBeVisible()
    await expect(within(panel).queryByText(/\|/)).toBeNull()
  },
}
