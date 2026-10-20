import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { itemKinds } from '@domain/item'
import { itemDisplayStatuses } from '@domain/status'
import {
  HEED_STROKE,
  HeedDomainIcon,
  HeedEditWaitingIcon,
  HeedEventIcon,
  heedMarks,
  IconProvider,
} from '@/components/icons'
import {
  EditWaitingBadge,
  KindBadge,
  KindIcon,
  StatusBadge,
  StatusMark,
  kindGlyphs,
  statusGlyphs,
} from '@/components/item/item-marks'
import { ColumnHeader, fieldIcons } from '@/components/library/item-list'
import { StatusIcon } from '@/components/library/status-icon'
import { FieldRow, FieldTable } from '@/components/item/field-table'

/*
  The Heed marks (contract 6.11): fifteen glyphs of the product's own, for the item kinds, the
  item states, and the domain, risk and validity fields. Drawn through Lucide's icon component,
  so they size and colour like any icon; each has a shell and one point that says which it is.
*/

const marks = Object.entries(heedMarks)

function drawn(Mark: (typeof heedMarks)[keyof typeof heedMarks]) {
  const { container, unmount } = render(<Mark data-testid="mark" />)
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('no svg')
  return { svg, unmount }
}

describe('the Heed marks', () => {
  it('are fifteen, each its own shape', () => {
    expect(marks).toHaveLength(15)
    const names = marks.map(([, Mark]) => {
      const { svg, unmount } = drawn(Mark)
      const name = [...svg.classList].find((part) => part.startsWith('lucide-heed-'))
      unmount()
      return name
    })
    expect(new Set(names).size).toBe(15)
    expect(names).toContain('lucide-heed-event')
    expect(names).toContain('lucide-heed-source-missing')
  })

  it('draw on the 24 unit grid, decorative unless named, with one point each', () => {
    for (const [name, Mark] of marks) {
      const { svg, unmount } = drawn(Mark)
      expect(svg, name).toHaveAttribute('viewBox', '0 0 24 24')
      expect(svg, name).toHaveAttribute('aria-hidden', 'true')
      expect(svg, name).toHaveAttribute('fill', 'none')
      const points = svg.querySelectorAll('.heed-point, .heed-point-fill')
      expect(points.length, `${name} has a point`).toBeGreaterThan(0)
      // The shell is everything else, and there is always one.
      expect(svg.children.length - points.length, `${name} has a shell`).toBeGreaterThan(0)
      unmount()
    }
  })

  it("draw at the family's 1.75 stroke under the app's 1.5 provider, and take a caller's stroke", () => {
    expect(HEED_STROKE).toBe(1.75)
    render(
      <IconProvider>
        <HeedEventIcon data-testid="default" />
        <HeedEventIcon data-testid="set" strokeWidth={2} />
      </IconProvider>,
    )
    expect(screen.getByTestId('default')).toHaveAttribute('stroke-width', '1.75')
    expect(screen.getByTestId('set')).toHaveAttribute('stroke-width', '2')
  })

  it('size and colour like any icon', () => {
    render(<HeedDomainIcon data-testid="mark" size={18} className="text-tone-dot" />)
    const svg = screen.getByTestId('mark')
    expect(svg).toHaveAttribute('width', '18')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveClass('lucide', 'text-tone-dot')
  })

  it('are not hidden when a caller names them', () => {
    render(<HeedEditWaitingIcon aria-label="Edit waiting" />)
    expect(screen.getByLabelText('Edit waiting')).not.toHaveAttribute('aria-hidden')
  })
})

describe('the glyph maps (contract 6.1 and 7.2)', () => {
  const markOf = (Mark: unknown) => marks.find(([, candidate]) => candidate === Mark)?.[0]

  it('draw every kind with its Heed mark', () => {
    expect(itemKinds.map((kind) => markOf(kindGlyphs[kind]))).toEqual([
      'note',
      'event',
      'guide',
      'example',
      'issue',
    ])
  })

  it('draw the seven statuses with seven Heed marks, an active issue with the issue mark', () => {
    expect(
      Object.fromEntries(itemDisplayStatuses.map((s) => [s, markOf(statusGlyphs[s])])),
    ).toEqual({
      accepted: 'accepted',
      stale: 'recheck-due',
      needs_check: 'source-changed',
      source_missing: 'source-missing',
      active_issue: 'issue',
      expired: 'ended',
      retired: 'retired',
    })
  })

  it('draw the domain and valid until fields with their marks', () => {
    expect(markOf(fieldIcons.domain)).toBe('domain')
    expect(markOf(fieldIcons.until)).toBe('valid-until')
  })
})

describe('where the marks are drawn', () => {
  it('a kind icon and a kind badge draw the same kind mark, muted', () => {
    const { container } = render(
      <>
        <KindIcon kind="guide" />
        <KindBadge kind="note" />
      </>,
    )
    expect(screen.getByRole('img', { name: 'Guide' })).toHaveClass('lucide-heed-guide')
    const badge = container.querySelector('[data-slot="kind-badge"]')
    expect(badge?.querySelector('svg')).toHaveClass('lucide-heed-note')
    expect(badge).toHaveClass('[&>svg]:text-muted-foreground')
    expect(badge).not.toHaveClass('heed-ink')
  })

  it('the status column draws one mark in one colour', () => {
    render(<StatusIcon status="source_missing" />)
    const svg = screen.getByRole('img', { name: 'Source missing' }).querySelector('svg')
    expect(svg).toHaveClass('lucide-heed-source-missing', 'text-status-warning-icon')
    expect(svg).not.toHaveClass('heed-ink')
  })

  it('a quiet status keeps a muted shell and a foreground point', () => {
    render(
      <>
        <StatusBadge status="accepted" />
        <StatusMark status="retired" />
      </>,
    )
    const badge = screen.getByText('Accepted').parentElement
    expect(badge).toHaveClass('text-muted-foreground', 'heed-ink')
    expect(badge?.querySelector('svg')).toHaveClass('lucide-heed-accepted')
    expect(screen.getByText('Archived').parentElement).toHaveClass('heed-ink')
  })

  it('a status that asks for a look is one colour, in its tone', () => {
    render(<StatusBadge status="stale" />)
    const badge = screen.getByText('Check due').parentElement
    expect(badge).not.toHaveClass('heed-ink')
    expect(badge?.querySelector('svg')).toHaveClass('lucide-heed-recheck-due')
  })

  it('an edit waiting badge draws its own mark, never a status glyph', () => {
    render(<EditWaitingBadge />)
    expect(screen.getByText('Edit waiting').parentElement?.querySelector('svg')).toHaveClass(
      'lucide-heed-edit-waiting',
    )
  })

  it('a column header and a field row give the muted field mark a foreground point', () => {
    const { container } = render(
      <>
        <ColumnHeader
          columns={['domain', 'status', 'until']}
          sortState={{ sort: 'title', dir: 'asc' }}
          onSort={() => {}}
        />
        <FieldTable label="Source details">
          <FieldRow icon={HeedDomainIcon} label="Domain">
            Commercial
          </FieldRow>
        </FieldTable>
      </>,
    )
    const header = container.querySelector('.lucide-heed-domain')
    expect(header).toHaveClass('heed-ink')
    expect(container.querySelector('.lucide-heed-valid-until')).toHaveClass('heed-ink')
    expect(container.querySelector('[data-slot="field-row"] dt')).toHaveClass('heed-ink')
  })
})
