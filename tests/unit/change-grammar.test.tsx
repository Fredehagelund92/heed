import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DraftConfirm } from '@/components/assistant/ask-draft-card'
import { ChangeCard } from '@/components/change/change-card'
import { StepTrail, type TrailStep } from '@/components/change/step-trail'
import { FileTextIcon, GlobeIcon, SearchIcon } from '@/components/icons'
import { readAnswer, stepsSummary, type AskMessage, type DraftProposal } from '@/lib/assistant'

/*
  One grammar for an agent's change (contract 7.2, 9.8): the step trail, whose verbs are in the
  present while a step runs and in the past once it is done, and which folds once the work is
  done; the change card about the object, with the line beside what the agent wrote and one
  decision; and the
  trail of how a draft an agent wrote came to be, on its review page.
*/

const step = (overrides: Partial<TrailStep> & Pick<TrailStep, 'id' | 'words'>): TrailStep => ({
  icon: SearchIcon,
  running: false,
  failed: false,
  ...overrides,
})

const done = [
  step({ id: 'a', words: 'Looked up facts', counts: '4 checked, 2 apply' }),
  step({ id: 'b', icon: GlobeIcon, words: 'Read', object: 'consumer.example' }),
  step({ id: 'c', icon: FileTextIcon, words: 'Read a fact' }),
]

function trail(props: Partial<Parameters<typeof StepTrail>[0]> = {}) {
  return render(
    <StepTrail
      steps={done}
      label="What the assistant did"
      summary="3 steps · read 1 page"
      {...props}
    />,
  )
}

describe('the step trail', () => {
  it('stays open while the work goes on, with the running step in the present', () => {
    trail({
      working: true,
      steps: [done[0]!, step({ id: 'd', icon: GlobeIcon, words: 'Reading', running: true })],
    })
    const list = screen.getByRole('list', { name: 'What the assistant did' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['Looked up facts · 4 checked, 2 apply', 'Reading'])
    expect(list.querySelector('[data-running]')).not.toBeNull()
    // Nothing to fold while it works.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('folds two or more steps once the work is done, and opens again on a click', async () => {
    trail()
    const toggle = screen.getByRole('button', { name: /3 steps · read 1 page/ })
    expect(toggle).toHaveAccessibleName('What the assistant did: 3 steps · read 1 page')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('list', { name: 'What the assistant did' })
    // The object stands in the foreground colour, the verb stays muted.
    expect(within(list).getByText('consumer.example')).toHaveClass('text-foreground')
  })

  it('keeps a trail open when a step did not work, and says so', () => {
    trail({
      steps: [
        done[0]!,
        step({
          id: 'e',
          icon: GlobeIcon,
          words: 'Tried to read',
          object: 'x.example',
          failed: true,
        }),
      ],
    })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('list', { name: 'What the assistant did' })).toHaveTextContent(
      "Tried to read x.example: it didn't work",
    )
  })

  it('shows one step as it is, without a row to fold it', () => {
    trail({ steps: [done[0]!] })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('listitem')).toHaveTextContent('Looked up facts · 4 checked, 2 apply')
  })

  it('opens a step to what it returned', async () => {
    trail({
      steps: [
        step({ id: 'f', words: 'Read a fact', opens: <a href="/library/itm_1">Payments</a> }),
      ],
    })
    const row = screen.getByText('Read a fact').closest('details')!
    expect(row.open).toBe(false)
    await userEvent.click(screen.getByText('Read a fact'))
    expect(row.open).toBe(true)
  })
})

describe('the change card', () => {
  const card = (props: Partial<Parameters<typeof ChangeCard>[0]> = {}) =>
    render(
      <ChangeCard
        label="New draft"
        kind="event"
        title="Payment provider switched in the United Kingdom"
        status="Saving the draft"
        actions={<button type="button">Create draft</button>}
        {...props}
      >
        <p>From 12 June 2026</p>
      </ChangeCard>,
    )

  it('is named by what the object is and its title', () => {
    card()
    expect(
      screen.getByRole('region', {
        name: 'New draft: Payment provider switched in the United Kingdom',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Saving the draft')
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeInTheDocument()
  })

  it('has no footer when there is nothing to decide', () => {
    const { container } = card({ status: undefined, actions: undefined })
    expect(container.querySelector('[data-slot="change-card-footer"]')).toBeNull()
  })
})

/** One tool call of the assistant, in the given state. */
const call = (toolName: string, state: 'input-available' | 'output-available', output = {}) =>
  ({
    type: 'dynamic-tool',
    toolName,
    toolCallId: `call_${toolName}`,
    input: {},
    state,
    ...(state === 'output-available' ? { output } : {}),
  }) as AskMessage['parts'][number]

const stepOf = (toolName: string, state: 'input-available' | 'output-available') =>
  readAnswer({ id: 'a1', role: 'assistant', parts: [call(toolName, state)] }).steps[0]!

describe('the tense of a step', () => {
  it.each([
    ['check_draft', 'Running the checks', 'Ran the checks'],
    ['find_overlaps', 'Looking for facts that overlap', 'Looked for facts that overlap'],
    ['estimate_impact', 'Previewing what agents would get', 'Previewed what agents would get'],
    ['read_gap', 'Reading a reported gap', 'Read a reported gap'],
    [
      'improve_question',
      'Looking at how the question is worded',
      'Looked at how the question is worded',
    ],
    ['read_item', 'Reading a fact', 'Read a fact'],
    ['explain_item', 'Checking whether 1 fact applies', 'Checked whether 1 fact applies'],
    ['some_new_tool', 'Looking something up', 'Looked something up'],
  ])('%s reads in the present while it runs and in the past once done', (tool, now, then) => {
    expect(stepOf(tool, 'input-available')).toMatchObject({ words: now, running: true })
    expect(stepOf(tool, 'output-available')).toMatchObject({ words: then, running: false })
  })

  it('says what a finished trail read, from what the tools returned', () => {
    const answer = readAnswer({
      id: 'a2',
      role: 'assistant',
      parts: [
        call('read_source', 'output-available', {
          url: 'https://consumer.example/eu/right-of-withdrawal',
        }),
        call('read_item', 'output-available', { item: { id: 'itm_1' } }),
        call('get_facts', 'output-available', { items: [{ id: 'itm_1' }, { id: 'itm_2' }] }),
      ],
    })
    expect(stepsSummary(answer.steps)).toEqual({ steps: '3 steps', read: '2 facts, 1 page' })
    expect(stepsSummary(answer.steps.slice(0, 1))).toEqual({ steps: '1 step', read: '1 page' })
  })
})

describe('the draft card', () => {
  const draft = (url: string): DraftProposal => ({
    toolCallId: 'c1',
    approvalId: 'approval-1',
    state: 'asking',
    webSites: [],
    saved: null,
    card: {
      itemId: null,
      kind: 'event',
      title: 'Payment provider switched in the United Kingdom',
      summary: 'Orders in the United Kingdom come through a new provider.',
      body: null,
      notToConclude: null,
      domain: 'Commercial',
      where: ['Orders'],
      dates: { from: '2026-06-12', to: null, uncertain: false },
      reviewDate: null,
      evidence: [{ url, site: 'evidence', quote: 'A sentence.', readOn: null, fromPage: false }],
      sources: { summary: { kind: 'person' }, validity: { kind: 'suggested' } },
    },
  })

  it('links a web address, and shows any other address as words', () => {
    const { unmount } = render(
      <DraftConfirm draft={draft('https://news.example/a')} onApprove={() => {}} />,
    )
    expect(screen.getByRole('link', { name: /evidence/ })).toHaveAttribute(
      'href',
      'https://news.example/a',
    )
    unmount()
    render(<DraftConfirm draft={draft('javascript:alert(1)')} onApprove={() => {}} />)
    expect(screen.queryByRole('link', { name: /evidence/ })).toBeNull()
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
  })

  it('does not say who wrote a field, and names only what was left for the person', () => {
    const base = draft('https://news.example/a')
    const { container } = render(
      <DraftConfirm draft={{ ...base, card: { ...base.card, where: [] } }} onApprove={() => {}} />,
    )
    expect(container.querySelector('[data-wrote]')).toBeNull()
    expect(container.querySelector('[data-slot="ask-draft-source"]')).toBeNull()
    expect(container.querySelector('[data-slot="ask-draft-written"]')).toHaveTextContent(
      'Left for you: where it applies.',
    )
    expect(container).not.toHaveTextContent(/Assistant wrote|filled in/)
  })
})
