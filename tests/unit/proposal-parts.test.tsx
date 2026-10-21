import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposalStates, type ProposalState } from '@domain/proposal-state'
import { ProposalStatusBadge, proposalStateLook } from '@/components/item/item-marks'
import { AgentPreview } from '@/components/proposal/agent-preview'
import { COPIED_FOR_MS, EditionLabel } from '@/components/proposal/edition-label'
import { CheckOutcomes, GateResult } from '@/components/proposal/gate-result'
import { OverlapList } from '@/components/proposal/overlap-list'
import { DraftProvenanceNotice, ExternalSources } from '@/components/proposal/provenance-notes'
import { PersonChip } from '@/components/proposal/person-chip'
import {
  Timeline,
  TimelineEvent,
  timelineEventKinds,
  timelineEventLook,
} from '@/components/proposal/timeline'
import {
  conflictReply,
  domains,
  fullOverlap,
  highGate,
  matchedReply,
  mixedGate,
  noOverlap,
  noMatchReply,
  normalGate,
} from '@/design-preview/proposal-samples'
import { QueryFrame, RouterFrame } from '@/stories/router-frame'
import { proposalStateNames } from '@/lib/proposals'

afterEach(() => {
  vi.useRealTimers()
})

describe('the proposal states on the badge family', () => {
  it('has a look and a name for every state, and nothing else (exhaustive by type)', () => {
    // A new state is a type error in item-marks (Record<ProposalState, ...>) and fails here too.
    const looks: Record<ProposalState, unknown> = proposalStateLook
    expect(Object.keys(looks).sort()).toEqual([...proposalStates].sort())
    expect(Object.keys(proposalStateNames).sort()).toEqual([...proposalStates].sort())
  })

  it('is soft while it waits for someone, bare for a draft or a closed proposal', () => {
    const soft = proposalStates.filter((state) => proposalStateLook[state].tone !== null)
    expect(soft).toEqual(['submitted', 'in_review', 'changes_requested', 'rejected'])
    for (const state of proposalStates) {
      const { unmount } = render(<ProposalStatusBadge state={state} />)
      const badge = screen.getByText(proposalStateNames[state]).parentElement
      expect(badge).toHaveAttribute('data-form', soft.includes(state) ? 'soft' : 'bare')
      expect(badge?.querySelector('svg')).not.toBeNull()
      unmount()
    }
  })

  it('gives every state its own glyph, so colour is never the only sign', () => {
    const glyphs = new Set(proposalStates.map((state) => proposalStateLook[state].glyph))
    expect(glyphs.size).toBe(proposalStates.length)
  })
})

describe('GateResult', () => {
  it('lists the required levels with an outcome in words and the edition they ran against', () => {
    render(<GateResult gate={normalGate} risk="normal" />)
    expect(screen.getByRole('heading', { name: 'Checks', level: 2 })).toBeInTheDocument()
    expect(
      screen.getByText('Normal risk: all four checks must pass before it can be accepted.'),
    ).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Checks' })).getAllByRole('listitem')
    expect(rows.map((row) => row.getAttribute('data-level'))).toEqual([
      'format',
      'matching',
      'delivery',
      'answer_impact',
    ])
    expect(screen.getAllByRole('img', { name: 'Passed' })).toHaveLength(4)
    // A review names the day of what AI apps got, never an edition's number.
    expect(
      screen.getByText('Checked against what AI apps got on 7 October 2026'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/2026-10-07\.2/)).toBeNull()
  })

  it('numbers the levels on the review screen and names every outcome', () => {
    render(<GateResult gate={mixedGate} risk="high" numbered />)
    expect(
      screen.getByText('High risk: all five checks must pass before it can be accepted.'),
    ).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    for (const name of ['Passed', 'Failed', 'Running', "Couldn't finish"])
      expect(screen.getAllByRole('img', { name }).length).toBeGreaterThan(0)
  })

  it('folds into one row that opens the list', async () => {
    const user = userEvent.setup()
    render(<GateResult gate={highGate} risk="high" variant="folded" />)
    const trigger = screen.getByRole('button', { name: /5 of 5 passed/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('All 31 test questions of the domain pass.')).toBeVisible()
  })

  it('puts the outcomes on one line for a timeline row', () => {
    render(<CheckOutcomes gate={mixedGate} />)
    const items = within(screen.getByRole('list', { name: 'Check outcomes' })).getAllByRole(
      'listitem',
    )
    expect(items.map((item) => item.textContent)).toEqual([
      'Complete',
      'Finds the right questions',
      'Reaches AI apps',
      'Answers stay right',
      'Whole domain',
    ])
  })
})

describe('Timeline', () => {
  it('has a glyph for every event kind, each one different', () => {
    expect(Object.keys(timelineEventLook).sort()).toEqual([...timelineEventKinds].sort())
    const glyphs = new Set(timelineEventKinds.map((kind) => timelineEventLook[kind].glyph))
    expect(glyphs.size).toBe(timelineEventKinds.length)
  })

  it('says who did what and when, and keeps a comment as written', () => {
    render(
      <Timeline>
        <TimelineEvent
          kind="changes_requested"
          actor="Jon Abara"
          action="asked for changes"
          at="2026-10-08T09:12:00Z"
          body={'Add the link.\nSay which markets.'}
        />
        <TimelineEvent
          kind="claimed"
          actor="Jon Abara"
          action="claimed this review"
          at="2026-10-08T09:05:00Z"
        />
      </Timeline>,
    )
    const list = screen.getByRole('list', { name: 'Activity' })
    const [first] = within(list).getAllByRole('listitem')
    expect(first).toHaveTextContent('Jon Abara asked for changes')
    const time = within(first!).getByText('8 Oct, 09:12')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('dateTime', '2026-10-08T09:12:00Z')
    expect(time).toHaveAttribute('title', '8 October 2026 at 09:12 UTC')
    expect(first!.querySelector('[data-slot="timeline-body"]')?.textContent).toBe(
      'Add the link.\nSay which markets.',
    )
    expect(first!.querySelector('[data-slot="timeline-mark"]')).toHaveAttribute(
      'data-tone',
      'warning',
    )
  })

  it('lets a check run that failed take the danger tone', () => {
    render(
      <Timeline>
        <TimelineEvent kind="checked" tone="danger" action="Checks ran" at="2026-10-08T09:12:00Z" />
      </Timeline>,
    )
    expect(document.querySelector('[data-slot="timeline-mark"]')).toHaveAttribute(
      'data-tone',
      'danger',
    )
  })
})

describe('EditionLabel', () => {
  it('copies the edition number and says Copied for two seconds', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<EditionLabel label="2026-10-07.2" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy edition 2026-10-07.2' }))
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith('2026-10-07.2')
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
    // Async: the timer starts in an effect, which may still be pending on a busy machine.
    await act(() => vi.advanceTimersByTimeAsync(COPIED_FOR_MS))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('says so when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    })
    render(<EditionLabel label="itm_gsw2q4i1 v2" what="version" />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy version itm_gsw2q4i1 v2' }))
    expect(await screen.findByText("Couldn't copy")).toBeInTheDocument()
  })

  it('can be the text alone', () => {
    render(<EditionLabel label="2026-10-07.2" copy={false} />)
    expect(screen.getByText('2026-10-07.2')).toHaveClass('font-mono')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PersonChip', () => {
  it('is an outline chip that names the part and the person', () => {
    render(<PersonChip role="proposer" name="Maria Lindqvist" you date="2026-10-07" />)
    const chip = screen.getByText('Proposed by you, 7 Oct 2026').parentElement
    expect(chip).toHaveAttribute('data-form', 'outline')
    expect(chip).toHaveAttribute('title', 'Proposed by you, 7 Oct 2026 (Maria Lindqvist)')
  })

  it('is soft in the info tone when it asks for a look', () => {
    render(<PersonChip role="claimed" name="Jon Abara" you form="soft" />)
    const chip = screen.getByText('Claimed by you').parentElement
    expect(chip).toHaveAttribute('data-form', 'soft')
    expect(chip).toHaveAttribute('data-tone', 'info')
  })
})

describe('AgentPreview', () => {
  // A served fact's review stamp reads who accepted it through the data layer.
  const renderPreview = (ui: ReactElement) => render(ui, { wrapper: QueryFrame })

  it('shows what was found, the dates, the source and what an AI app may say about cause', () => {
    renderPreview(
      <AgentPreview
        state="ready"
        result={matchedReply}
        about={['Units sold', 'Norway']}
        domainOf={() => domains.sales}
        draftItemId="itm_prp231draft"
      />,
    )
    expect(screen.getByText('Not shared yet')).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'The question is about' })).getAllByRole('listitem'),
    ).toHaveLength(2)
    expect(screen.getByText('Found')).toBeInTheDocument()
    expect(screen.getByText('1 fact')).toBeInTheDocument()
    expect(screen.getByText('Sales').parentElement).toHaveAttribute('data-slot', 'domain-badge')
    expect(screen.getByRole('link', { name: 'regulator.example' })).toHaveAttribute(
      'rel',
      'noreferrer noopener',
    )
    expect(screen.getByText(/From 4 August 2026, still going on/)).toBeInTheDocument()
    expect(screen.getByText('could explain')).toBeInTheDocument()
    // The draft is not reviewed yet: an agent gets it only once an owner accepts it.
    expect(
      screen.getByText(/Not reviewed yet. AI apps get it once the owner of Sales/),
    ).toBeInTheDocument()
  })

  it('stamps a served fact with how it was reviewed (FR-326)', () => {
    renderPreview(
      <AgentPreview state="ready" result={conflictReply} draftItemId="itm_prp231draft" />,
    )
    const stamps = document.querySelectorAll('[data-slot="review-stamp"]')
    expect([...stamps].map((stamp) => stamp.getAttribute('data-state'))).toEqual([
      'pending',
      'accepted',
    ])
    // The stamp says who accepted it and when; the edition's label stays off it (voice V5).
    expect(stamps[1]).toHaveTextContent(/^Accepted 2 August 2026 by the owner of Sales/)
    expect(stamps[1]).not.toHaveTextContent('2026-08-02.1')
  })

  it('says a live fact with no accept decision has no review on record, not that it is a draft', () => {
    renderPreview(<AgentPreview state="ready" result={conflictReply} />)
    const stamps = document.querySelectorAll('[data-slot="review-stamp"]')
    expect([...stamps].map((stamp) => stamp.getAttribute('data-state'))).toEqual([
      'unrecorded',
      'accepted',
    ])
    expect(screen.queryByText(/Not reviewed yet/)).toBeNull()
  })

  it('warns about a conflict, a fact that may be out of date and a cut reply', () => {
    renderPreview(<AgentPreview state="ready" result={conflictReply} />)
    expect(screen.getByText('Found, with a conflict')).toBeInTheDocument()
    expect(screen.getByText(/this fact may be out of date/)).toBeInTheDocument()
    expect(screen.getByText(/More facts apply than fit/)).toBeInTheDocument()
    expect(screen.getByText('Applies to brand: Lucky North only.')).toBeInTheDocument()
  })

  it('says plainly when it is waiting or loading, and marks only an unpublished reply', () => {
    const { rerender } = renderPreview(<AgentPreview state="waiting" />)
    expect(screen.getByText(/you'll see what AI apps would get/)).toBeInTheDocument()
    rerender(<AgentPreview state="loading" />)
    expect(screen.getByText('Asking as an AI app would')).toBeInTheDocument()
    rerender(<AgentPreview state="ready" result={noMatchReply} />)
    expect(screen.getByText('Not shared yet')).toBeInTheDocument()
    rerender(<AgentPreview state="ready" result={noMatchReply} published />)
    expect(screen.getByText(/nothing is written down for this/)).toBeInTheDocument()
    // An absence is a statement about what was checked, not an empty list (contract 9.5).
    expect(
      screen.getByText('Nothing written down for this question').closest('div[data-slot]'),
    ).toHaveAttribute('data-slot', 'agent-preview-no-match')
    expect(screen.queryByText('Not shared yet')).toBeNull()
  })
})

describe('OverlapList', () => {
  it('links accepted items and the person own proposals, and only says yes for others', async () => {
    render(
      <RouterFrame>
        <OverlapList overlap={fullOverlap} />
      </RouterFrame>,
    )
    const item = await screen.findByRole('link', {
      name: 'Norway launch campaign started on 21 September 2025',
    })
    expect(item).toHaveAttribute('href', '/library/itm_jyfuvl07')
    expect(screen.getByText('Accepted · Sales')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '#226 First-time buyers exclude test accounts' }),
    ).toHaveAttribute('href', '/proposals/7d0e1c52-3a54-4c8e-9a76-0c4f1b6d2a31')
    expect(
      screen.getByText("Someone else has an open proposal that overlaps. You can't see it."),
    ).toBeInTheDocument()
  })

  it('says when nothing overlaps', async () => {
    render(
      <RouterFrame>
        <OverlapList overlap={noOverlap} title="Already in the library" />
      </RouterFrame>,
    )
    expect(await screen.findByText(/Nothing in the library overlaps/)).toBeInTheDocument()
    expect(screen.getByText('Nobody else has an open proposal that overlaps.')).toBeInTheDocument()
  })

  it('keeps a long list short until the person asks for all of it', async () => {
    const accepted = Array.from({ length: 8 }, (_, index) => ({
      id: `itm_long000${index}`,
      title: `Accepted item ${index + 1}`,
    }))
    render(
      <RouterFrame>
        <OverlapList
          overlap={{ accepted, ownProposals: [], otherProposalExists: false }}
          limit={5}
        />
      </RouterFrame>,
    )
    await screen.findByRole('link', { name: 'Accepted item 1' })
    expect(screen.queryByRole('link', { name: 'Accepted item 6' })).not.toBeInTheDocument()
    expect(screen.getByText('8 overlap')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show 3 more' }))
    expect(screen.getByRole('link', { name: 'Accepted item 8' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByRole('link', { name: 'Accepted item 6' })).not.toBeInTheDocument()
  })
})

describe('DraftProvenanceNotice', () => {
  it('asks the person to check the fields to check, and names nobody as the writer', () => {
    const { container } = render(
      <DraftProvenanceNotice
        provenance={{
          by: 'agent',
          fields: { summary: 'prefilled', validity: 'prefilled', scope: 'confirmed' },
          flags: [],
        }}
      />,
    )
    const notice = document.querySelector('[data-slot="provenance-notice"]')
    expect(notice).toHaveTextContent('Check this draft before you send it')
    expect(notice).toHaveTextContent('Nobody else sees it until you send it.')
    expect(notice).toHaveTextContent('Check the')
    expect(notice).not.toHaveTextContent(/AI app|assistant/i)
    // No mark beside a field and no line beside a value.
    expect(container.querySelector('[data-slot="provenance-mark"]')).toBeNull()
  })
})

describe('ExternalSources', () => {
  const page = 'https://consumer.example/eu/right-of-withdrawal'
  const provenance = (quoteFound: boolean) => ({
    by: 'assistant' as const,
    fields: { evidence: 'prefilled' as const },
    flags: [],
    external: [
      {
        url: page,
        quote: 'Consumers have 14 days to withdraw from an online purchase',
        readOn: '2026-10-15',
        quoteFound,
      },
    ],
  })

  it('labels evidence from a page Heed read as an unreviewed external source, with its site and day', () => {
    render(<DraftProvenanceNotice provenance={provenance(true)} />)
    const source = document.querySelector('[data-slot="external-source"]')
    expect(source).toHaveTextContent('Outside source, not checked yet.')
    expect(source).toHaveTextContent(
      'We read consumer.example on 15 Oct 2026 and the sentence was copied from it. Open the link and check the sentence before you send it.',
    )
    // The sentence was on the page: no warning.
    expect(document.querySelector('[data-slot="quote-warning"]')).toBeNull()
  })

  it('warns, and only warns, when the sentence was not on the page', () => {
    render(<ExternalSources provenance={provenance(false)} where="review" />)
    expect(document.querySelector('[data-slot="external-source"]')).toHaveTextContent(
      'We read consumer.example on 15 Oct 2026 for the proposer. Open the link and check the sentence before you accept.',
    )
    expect(document.querySelector('[data-slot="quote-warning"]')).toHaveTextContent(
      "Sentence not found on the page. We didn't find the quoted sentence word for word on the page from consumer.example. Check it against the page.",
    )
  })

  it('shows nothing for a draft without external sources', () => {
    const { container } = render(
      <ExternalSources provenance={{ by: 'agent', fields: {}, flags: [] }} where="editor" />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
