import { render as renderOnly, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { noChanges } from '@domain/editions'
import { EditionChangeCard, EditionChangeSummary } from '@/components/editions/change-card'
import {
  changeAttribution,
  changeCountParts,
  countItemChanges,
  itemChangeSentence,
  partitionEditionFields,
} from '@/lib/edition-diff'
import {
  changedComparison,
  comparisonState,
  editionDiffLookups,
  pagedComparison,
} from '@/stories/edition-diff-fixtures'

// The card links to the item's page, so it renders inside a router.
const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() })
const render = (ui: ReactNode) =>
  renderOnly(<RouterContextProvider router={router}>{ui}</RouterContextProvider>)

describe('edition change sentences and counts', () => {
  it('keeps checked, saved again, retired and removed separate, without changing inputs', () => {
    const items = Object.freeze(
      ['added', 'changed', 'checked', 'resaved', 'retired', 'removed', 'changed'].map((change) =>
        Object.freeze({ change }),
      ),
    )
    const counts = countItemChanges(items as Parameters<typeof countItemChanges>[0])
    expect(counts).toEqual({ added: 1, changed: 2, checked: 1, resaved: 1, retired: 1, removed: 1 })
    expect(changeCountParts(counts).map((part) => part.text)).toEqual([
      '1 added',
      '2 changed',
      '1 checked, still correct',
      '1 saved again, nothing different',
      '1 archived',
      '1 no longer shared',
    ])
    expect(countItemChanges([])).toEqual(noChanges())
    expect(changeCountParts(noChanges())).toEqual([])
    expect(changeCountParts({ ...noChanges(), added: 1200 })[0]?.text).toBe('1,200 added')
  })

  it('never confuses removal by going back with retirement', () => {
    expect(itemChangeSentence(comparisonState('removed').change!)).toBe(
      'Agents no longer get this fact in this edition. Its history stays.',
    )
    expect(itemChangeSentence(comparisonState('retired').change!)).toContain('Archived.')
    expect(itemChangeSentence(comparisonState('checked').change!)).toContain(
      'Checked, still correct.',
    )
    expect(itemChangeSentence(comparisonState('resaved').change!)).toContain(
      'What agents read is the same.',
    )
  })

  it('keeps every decision and reason, and does not invent a missing actor', () => {
    const why = changedComparison.change!.why
    expect(
      changeAttribution(
        {
          ...why,
          editedBy: 'unknown',
          decisions: [
            ...why.decisions,
            {
              ...why.decisions[0]!,
              decidedBy: 'approver',
              capacity: 'approver',
              reason: 'Verified the dates.',
            },
          ],
        },
        () => null,
      ),
    ).toEqual([
      'Proposed by a person whose name is unavailable through the form.',
      'Edited during review by a person whose name is unavailable.',
      'Accepted by a person whose name is unavailable as owner.',
      'Why: Confirmed the delay with the source owner.',
      'Accepted by a person whose name is unavailable as approver.',
      'Why: Verified the dates.',
    ])
    expect(changeAttribution(comparisonState('resaved').change!.why, () => null)).toEqual([
      'No decision on record for this change.',
    ])
  })

  it('uses the service system flag even for fields introduced later', () => {
    const fields = [
      ...changedComparison.fields,
      { field: 'futureField', before: null, after: 'new', systemFilled: true },
    ]
    const result = partitionEditionFields(fields)
    expect(result.system.map((field) => field.field)).toEqual([
      'references',
      'changeMarks',
      'summaryMarkup',
      'futureField',
    ])
    expect(result.content).toHaveLength(5)
    expect(fields).toHaveLength(9)
  })
})

describe('edition change card', () => {
  // Scope chips need a router. Text-only samples isolate the card's own interactions.
  const comparison = {
    ...changedComparison,
    fields: changedComparison.fields.filter((field) =>
      ['summary', 'summaryMarkup'].includes(field.field),
    ),
  }
  it('marks words and reveals system fields only on request', async () => {
    render(<EditionChangeCard comparison={comparison} lookups={editionDiffLookups} />)
    expect(document.querySelector('del')).toHaveTextContent('one day')
    expect(document.querySelector('ins')).toHaveTextContent('two days')
    const trigger = screen.getByRole('button', { name: '1 field the system fills in' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByText('What happened')).toHaveLength(1)
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText('What happened')).toHaveLength(2)
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Proposed version|Live version/)).not.toBeInTheDocument()
  })

  it('leads to the fact page from its header, where the surface does not', () => {
    const { unmount } = render(
      <EditionChangeCard comparison={comparison} lookups={editionDiffLookups} />,
    )
    expect(
      screen.getByRole('link', { name: `Open fact: ${comparison.change!.title}` }),
    ).toHaveAttribute('href', `/library/${comparison.change!.itemId}`)
    unmount()
    render(
      <EditionChangeCard comparison={comparison} lookups={editionDiffLookups} header={false} />,
    )
    expect(screen.queryByRole('link', { name: /Open fact/ })).not.toBeInTheDocument()
  })

  it('leaves its badges and title to a surface that shows them, and is named by the title', () => {
    render(
      <EditionChangeCard comparison={comparison} lookups={editionDiffLookups} header={false} />,
    )
    const card = screen.getByRole('article', {
      name: `What changed in ${comparison.change!.title}`,
    })
    expect(card.querySelector('h3')).toBeNull()
    expect(card).not.toHaveTextContent('Version 1 to 2')
    expect(document.querySelector('ins')).toHaveTextContent('two days')
  })

  it.each(['added', 'retired', 'removed'] as const)(
    'shows the complete %s content without false word changes',
    (state) => {
      const sample = comparisonState(state)
      render(
        <EditionChangeCard
          comparison={{
            ...sample,
            fields: sample.fields.filter((field) => field.field === 'summary'),
          }}
          lookups={editionDiffLookups}
        />,
      )
      expect(screen.getByText(/Online share lags by two days/)).toBeVisible()
      expect(document.querySelector('ins, del')).toBeNull()
    },
  )

  it.each(['resaved', 'checked'] as const)('explains %s even without content changes', (state) => {
    render(<EditionChangeCard comparison={comparisonState(state)} lookups={editionDiffLookups} />)
    expect(screen.getByText(itemChangeSentence(comparisonState(state).change!))).toBeVisible()
    expect(screen.queryByText('What happened')).not.toBeInTheDocument()
  })

  it('shows an unchanged fact and a summary with global counts rather than paged rows', () => {
    const { unmount } = render(
      <EditionChangeCard
        comparison={{ ...comparison, change: null, fields: [] }}
        lookups={editionDiffLookups}
      />,
    )
    expect(screen.getByText('This fact is the same in both editions.')).toBeVisible()
    unmount()
    render(<EditionChangeSummary summary={pagedComparison} />)
    expect(screen.getByText('12 changed')).toBeVisible()
    expect(screen.getByText(pagedComparison.sentence)).toBeVisible()
  })
})
