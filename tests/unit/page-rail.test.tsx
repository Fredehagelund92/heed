import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { HashIcon } from '@/components/icons'
import { PageRail, RailSection } from '@/components/page/page-rail'
import { GateResult } from '@/components/proposal/gate-result'
import { PartCard } from '@/components/proposal/part-card'
import { normalGate } from '@/design-preview/proposal-samples'

const frame = ['rounded-lg', 'border', 'bg-card']

describe('the page rail', () => {
  it('is a flat column with a hairline on its left from a wide page', () => {
    render(<PageRail aria-label="Checks and details" />)
    const rail = screen.getByRole('complementary', { name: 'Checks and details' })
    expect(rail).toHaveAttribute('data-placement', 'responsive')
    expect(rail).toHaveClass('@6xl:border-l', '@6xl:w-companion', 'border-t')
    expect(rail).not.toHaveClass('rounded-lg', 'bg-card')
  })

  it('takes a fixed place for a page that measures itself, and no frame in a panel', () => {
    const { rerender } = render(<PageRail aria-label="Rail" placement="beside" />)
    expect(screen.getByRole('complementary')).toHaveClass('border-l', 'w-companion')
    rerender(<PageRail aria-label="Rail" placement="below" />)
    expect(screen.getByRole('complementary')).toHaveClass('border-t', 'w-full')
    rerender(<PageRail aria-label="Rail" placement="panel" />)
    // In a docked panel the panel is the landmark: the rail is a plain column without a frame.
    expect(screen.queryByRole('complementary')).toBeNull()
    const panel = document.querySelector('[data-slot="page-rail"]')
    expect(panel).toHaveAttribute('role', 'none')
    expect(panel).not.toHaveClass('border-l')
    expect(panel).not.toHaveClass('border-t')
  })

  it('puts the hairline on the other side when it stacks above the main column', () => {
    render(<PageRail aria-label="Rail" stack="above" />)
    expect(screen.getByRole('complementary')).toHaveClass('border-b', '@6xl:border-b-0')
  })

  it('names each section by its heading and parts it from the one before', () => {
    render(
      <PageRail aria-label="Rail">
        <RailSection title="What changed" description="Against the edition before">
          <p>Three items</p>
        </RailSection>
        <RailSection title="Details" headingLevel={3}>
          <p>Facts</p>
        </RailSection>
      </PageRail>,
    )
    const first = screen.getByRole('region', { name: 'What changed' })
    expect(within(first).getByText('Against the edition before')).toBeInTheDocument()
    expect(first).toHaveClass('border-t', 'first:border-t-0')
    expect(screen.getByRole('heading', { level: 3, name: 'Details' })).toBeInTheDocument()
  })
})

describe('a part in the rail', () => {
  it('is a card in a main column and a flat section in a rail', () => {
    const { unmount } = render(<PartCard title="Checks">No check results yet.</PartCard>)
    expect(screen.getByText('No check results yet.')).toHaveClass(...frame)
    unmount()
    render(
      <PageRail aria-label="Rail">
        <PartCard title="Checks" data-slot="gate-result">
          No check results yet.
        </PartCard>
      </PageRail>,
    )
    const section = screen.getByRole('region', { name: 'Checks' })
    expect(section).toHaveAttribute('data-slot', 'gate-result')
    for (const name of frame) expect(section).not.toHaveClass(name)
  })

  it('keeps every check when the checks are flat', () => {
    render(
      <PageRail aria-label="Rail">
        <GateResult gate={normalGate} risk="normal" />
      </PageRail>,
    )
    const checks = screen.getByRole('region', { name: 'Checks' })
    expect(within(checks).getAllByRole('listitem').length).toBeGreaterThan(0)
    for (const name of frame) expect(checks).not.toHaveClass(name)
  })

  it('folds the checks to one flat row in a rail', () => {
    const { container } = render(
      <PageRail aria-label="Rail">
        <GateResult gate={normalGate} variant="folded" />
      </PageRail>,
    )
    const folded = container.querySelector('[data-variant="folded"]')
    expect(folded).toHaveClass('border-t', 'first:border-t-0')
    expect(folded).not.toHaveClass('rounded-lg')
    expect(screen.getByRole('button', { name: /Checks:/ })).toBeInTheDocument()
  })

  it('lists the fields with no table frame in a rail', () => {
    const table = (
      <FieldTable label="Details">
        <FieldRow icon={HashIcon} label="Proposal">
          #11
        </FieldRow>
      </FieldTable>
    )
    const { unmount } = render(table)
    expect(screen.getByRole('definition').parentElement?.parentElement).toHaveClass(...frame)
    unmount()
    render(<PageRail aria-label="Rail">{table}</PageRail>)
    const list = screen.getByLabelText('Details')
    expect(list).toHaveAttribute('data-flat')
    for (const name of frame) expect(list).not.toHaveClass(name)
    expect(screen.getByRole('definition')).toHaveTextContent('#11')
    expect(screen.getByRole('definition')).not.toHaveClass('border-l')
  })
})
