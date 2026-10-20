import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { areaSchema, domainHues } from '@domain/item'
import { areas } from '@/mocks/reference-data'
import userEvent from '@testing-library/user-event'
import { AudienceBadge, ClaimBadge, RiskBadge, VersionBadge } from '@/components/item/fact-badges'
import {
  CountBadge,
  DateBadge,
  DomainBadge,
  KindBadge,
  KindIcon,
  Owner,
  StatusBadge,
} from '@/components/item/item-marks'
import { StatusIcon } from '@/components/library/status-icon'
import { ArchiveIcon, HeedDomainIcon, ICON_STROKE, IconProvider } from '@/components/icons'
import { itemDisplayStatuses } from '@domain/status'
import { statusHints, statusNames } from '@/lib/library'
import { BlockedButton } from '@/components/ui/blocked-button'
import { MENTION_TITLE_LIMIT, MentionChip, mentionText } from '@/components/item/mention-chip'
import { Badge } from '@/components/ui/badge'

const TODAY = '2026-10-07'

describe('the domain hue ring', () => {
  it('has eight hues and never red or amber', () => {
    expect(domainHues).toHaveLength(8)
    expect(domainHues).not.toContain('amber')
    expect(domainHues).not.toContain('red')
  })

  it('is the only set of labels an area takes, and Paid media is violet', () => {
    for (const area of areas) expect(domainHues).toContain(area.label)
    const paidMedia = areas.find((area) => area.name === 'Paid media')
    expect(paidMedia?.label).toBe('violet')
    expect(areaSchema.safeParse({ ...paidMedia, label: 'amber' }).success).toBe(false)
  })
})

describe('Badge', () => {
  it('names its form, size and tone, and prints the label after the mark', () => {
    render(
      <Badge form="soft" tone="teal" icon={HeedDomainIcon}>
        Commercial
      </Badge>,
    )
    const badge = screen.getByText('Commercial').parentElement
    expect(badge).toHaveAttribute('data-form', 'soft')
    expect(badge).toHaveAttribute('data-size', 'md')
    expect(badge).toHaveAttribute('data-tone', 'teal')
    expect(badge?.querySelector('svg')).not.toBeNull()
    expect(badge).toHaveClass('rounded-badge', 'badge-md', 'font-normal')
  })
})

describe('DomainBadge', () => {
  it('is a soft badge in the ring hue that the container sizes, not a cap of its own', () => {
    render(<DomainBadge name="Paid media" label="violet" />)
    const badge = screen.getByText('Paid media').parentElement
    expect(badge).toHaveAttribute('data-slot', 'domain-badge')
    expect(badge).toHaveAttribute('data-tone', 'violet')
    expect(badge).toHaveAttribute('data-form', 'soft')
    expect(badge).toHaveClass('min-w-0', 'max-w-full', 'shrink')
    expect(badge).not.toHaveClass('max-w-column-domain')
    // A name that fits has no tooltip: the native title is gone too, a row's link covers it.
    expect(badge).not.toHaveAttribute('title')
    expect(badge).not.toHaveAttribute('data-cut')
  })
})

describe('StatusBadge: tint means look at this', () => {
  it('is soft in the warning tone when the status asks for a look', () => {
    render(<StatusBadge status="stale" />)
    const badge = screen.getByText('Check due').parentElement
    expect(badge).toHaveAttribute('data-form', 'soft')
    expect(badge).toHaveAttribute('data-tone', 'warning')
    expect(badge?.querySelector('svg')).not.toBeNull()
  })

  it('is bare and muted when the status is quiet', () => {
    render(<StatusBadge status="accepted" />)
    const badge = screen.getByText('Accepted').parentElement
    expect(badge).toHaveAttribute('data-form', 'bare')
    expect(badge).toHaveClass('text-muted-foreground')
  })
})

describe('Reference: the label and the mark in one ink (contract 6.13)', () => {
  it("paints a soft badge's label in the ink and its mark in the dot, the same ink", () => {
    render(
      <Badge form="soft" tone="warning" icon={ArchiveIcon}>
        Source missing
      </Badge>,
    )
    const badge = screen.getByText('Source missing').parentElement
    expect(badge).toHaveClass('text-tone-ink', '[&>svg]:text-tone-dot')
  })

  it('draws a kind as its bare glyph, muted, with no tile behind it', () => {
    render(<KindIcon kind="event" />)
    const icon = screen.getByRole('img', { name: 'Event' })
    expect(icon.tagName.toLowerCase()).toBe('svg')
    expect(icon).toHaveClass('lucide-heed-event', 'size-4', 'text-muted-foreground')
    expect(icon).not.toHaveClass('bg-tone-tint')
  })
})

describe('StatusIcon: the status column is one glyph, the name in its tooltip', () => {
  it('names the status for assistive technology and draws one 18 pixel glyph', () => {
    render(<StatusIcon status="source_missing" />)
    const icon = screen.getByRole('img', { name: 'Source missing' })
    expect(icon).toHaveAttribute('data-slot', 'status-icon')
    expect(icon.querySelectorAll('svg')).toHaveLength(1)
    expect(icon.querySelector('svg')).toHaveClass('size-icon-status', 'text-status-warning-icon')
    expect(icon).not.toHaveTextContent('Source missing')
  })

  it('keeps a healthy item neutral, never green', () => {
    render(<StatusIcon status="accepted" />)
    expect(screen.getByRole('img', { name: 'Accepted' }).querySelector('svg')).toHaveClass(
      'text-muted-foreground',
    )
  })

  it('shows the name and what it means on hover', async () => {
    render(<StatusIcon status="stale" />)
    await userEvent.hover(screen.getByRole('img', { name: 'Check due' }))
    const tip = await screen.findByText(statusHints.stale)
    expect(tip.parentElement).toHaveTextContent(statusNames.stale)
  })

  it('gives each of the seven statuses its own shape', () => {
    const { container } = render(
      <>
        {itemDisplayStatuses.map((status) => (
          <StatusIcon key={status} status={status} />
        ))}
      </>,
    )
    const shapes = [...container.querySelectorAll('[data-slot="status-icon"] svg')].map((svg) =>
      [...svg.classList].find((name) => name.startsWith('lucide-')),
    )
    expect(new Set(shapes).size).toBe(itemDisplayStatuses.length)
  })
})

describe('the icon stroke (contract 6.11)', () => {
  it("draws every icon under the provider at 1.5, not Lucide's default 2", () => {
    render(
      <IconProvider>
        <ArchiveIcon data-testid="glyph" />
      </IconProvider>,
    )
    expect(ICON_STROKE).toBe(1.5)
    expect(screen.getByTestId('glyph')).toHaveAttribute('stroke-width', '1.5')
  })

  it("gives a small badge's 12 pixel glyph the heavier small stroke", () => {
    render(
      <Badge form="soft" tone="warning" size="sm" icon={ArchiveIcon}>
        Retired
      </Badge>,
    )
    expect(screen.getByText('Retired').parentElement).toHaveClass('[&>svg]:stroke-icon-sm')
  })
})

describe('DateBadge: colour is time pressure only', () => {
  const label = (date: string | null, deadline = false) => {
    const { container, unmount } = render(
      <DateBadge date={date} today={TODAY} deadline={deadline} />,
    )
    const badge = container.querySelector('[data-slot="date-badge"]')
    const result = {
      text: badge?.textContent,
      form: badge?.getAttribute('data-form'),
      tone: badge?.getAttribute('data-tone'),
    }
    unmount()
    return result
  }

  it('reads Ongoing without a date and a plain date far away', () => {
    expect(label(null)).toMatchObject({ text: 'Ongoing', form: 'bare' })
    expect(label('2027-01-13')).toMatchObject({ text: '13 Jan 2027', form: 'bare' })
  })

  it('turns soft amber within 30 days', () => {
    expect(label('2026-10-31')).toMatchObject({ text: 'in 24 days', tone: 'warning' })
    expect(label('2026-10-08')).toMatchObject({ text: 'in 1 day', tone: 'warning' })
    expect(label(TODAY)).toMatchObject({ text: 'Today', tone: 'warning' })
    expect(label('2026-11-07')).toMatchObject({ form: 'bare' })
  })

  it('turns soft red only when a deadline has passed', () => {
    expect(label('2026-10-04', true)).toMatchObject({ text: '3 days overdue', tone: 'danger' })
    expect(label('2026-10-04')).toMatchObject({ text: '4 Oct 2026', form: 'bare' })
  })
})

describe('owner, kind and count', () => {
  it('draws the owner chip as an outline chip with a 20 pixel avatar', () => {
    const { container } = render(<Owner name="Noor Haddad" initials="NH" chip />)
    const chip = container.querySelector('[data-slot="owner"]')
    expect(chip).toHaveClass('border', 'rounded-full', 'h-6')
    expect(container.querySelector('[data-slot="avatar"]')).toHaveAttribute('data-size', 'xs')
  })

  it('marks the avatar of a proposer who drafted with an AI app, and says so in words', () => {
    const { container } = render(<Owner name="Priya Nair" drafted="agent" />)
    const owner = container.querySelector('[data-slot="owner"]')
    expect(owner).toHaveAttribute('data-drafted', 'agent')
    expect(owner).toHaveAttribute('title', 'Priya Nair with an AI app')
    expect(owner).toHaveTextContent('Priya Nair with an AI app')
    // The app is a mark on the person's avatar, never an avatar of its own.
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1)
    expect(container.querySelector('[data-slot="ai-app-mark"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('draws a person without the mark when they wrote it themselves', () => {
    const { container } = render(<Owner name="Noor Haddad" />)
    expect(container.querySelector('[data-slot="ai-app-mark"]')).toBeNull()
    expect(container.querySelector('[data-slot="owner"]')).not.toHaveAttribute('title')
  })

  it('draws the kind badge as an outline badge with the muted kind icon', () => {
    render(<KindBadge kind="event" />)
    const badge = screen.getByText('Event').parentElement
    expect(badge).toHaveAttribute('data-form', 'outline')
    expect(badge).toHaveAttribute('data-tone', 'neutral')
    expect(badge).toHaveClass('[&>svg]:text-muted-foreground')
  })

  it('formats a count and tints it only for a look', () => {
    const { container } = render(<CountBadge count={1407} tone="attention" />)
    const count = container.querySelector('[data-slot="count-badge"]')
    expect(count).toHaveTextContent('1,407')
    expect(count).toHaveAttribute('data-tone', 'warning')
  })
})

describe('MentionChip', () => {
  it('keeps the domain badge look for an area', () => {
    render(<MentionChip target={{ type: 'area', label: 'violet' }} name="Paid media" />)
    const chip = screen.getByTitle('Domain: Paid media')
    expect(chip).toHaveAttribute('data-tone', 'violet')
    expect(chip).toHaveClass('bg-tone-tint', 'mention-chip', 'rounded-badge')
    expect(chip.querySelector('svg.lucide-heed-domain')).not.toBeNull()
  })

  it('is a quiet chip with a glyph for a metric, a dimension and a value', () => {
    for (const type of ['metric', 'dim', 'val'] as const) {
      const { container, unmount } = render(<MentionChip target={{ type }} name="Orders" />)
      const chip = container.querySelector('[data-slot="mention-chip"]')
      expect(chip).toHaveAttribute('data-tone', 'neutral')
      expect(chip?.querySelector('svg')).not.toBeNull()
      unmount()
    }
  })

  it('gives an item its kind glyph and truncates a long title on a word', () => {
    const title = 'New tax rate in Poland from 8 June 2026 applies to every product'
    render(<MentionChip target={{ type: 'item', kind: 'event' }} name={title} />)
    const chip = screen.getByTitle(`Fact: ${title}`)
    expect(chip.querySelector('svg')).toHaveClass('lucide-heed-event', 'text-muted-foreground')
    const shown = mentionText('item', title)
    expect([...shown].length).toBeLessThanOrEqual(MENTION_TITLE_LIMIT)
    expect(shown.endsWith('…')).toBe(true)
    expect(chip).toHaveTextContent(shown)
    expect(mentionText('metric', title)).toBe(title)
  })

  it('shows a missing target as a dashed chip with a struck label', () => {
    render(<MentionChip target={{ type: 'item', kind: 'note' }} name="Old note" missing />)
    const chip = screen.getByTitle('Old note (no longer in the library)')
    expect(chip).toHaveAttribute('data-missing', 'true')
    expect(chip).toHaveClass('border-dashed')
    expect(screen.getByText('Old note')).toHaveClass('line-through')
  })
})

describe('the issue kind', () => {
  it('reads an active issue as a soft warning status, an ended one as bare Ended', () => {
    render(<StatusBadge status="active_issue" />)
    const badge = screen.getByText('Active issue').parentElement
    expect(badge).toHaveAttribute('data-form', 'soft')
    expect(badge).toHaveAttribute('data-tone', 'warning')
  })

  it('draws an issue that applies in amber, and keeps an ended one muted', () => {
    render(
      <>
        <KindIcon kind="issue" active />
        <KindBadge kind="issue" active />
        <MentionChip target={{ type: 'item', kind: 'issue' }} name="Partner outage" />
      </>,
    )
    expect(screen.getByRole('img', { name: 'Issue' })).toHaveClass('text-status-warning-icon')
    expect(screen.getByText('Issue').parentElement).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByTitle('Fact: Partner outage').querySelector('svg')).toHaveClass(
      'text-status-warning-icon',
    )
  })

  it('keeps an ended issue, and every other kind, muted', () => {
    render(
      <>
        <KindIcon kind="issue" />
        <KindIcon kind="note" active />
        <KindBadge kind="issue" />
        <MentionChip target={{ type: 'item', kind: 'issue', calm: true }} name="Partner outage" />
      </>,
    )
    for (const icon of screen.getAllByRole('img')) expect(icon).toHaveClass('text-muted-foreground')
    expect(screen.getByText('Issue').parentElement).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByTitle('Fact: Partner outage').querySelector('svg')).toHaveClass(
      'text-muted-foreground',
    )
  })
})

describe('the item page badges', () => {
  it('draws risk as three bars, soft red only for high', () => {
    const { unmount } = render(<RiskBadge level="normal" />)
    const normal = screen.getByText('Normal risk').parentElement
    expect(normal).toHaveAttribute('data-form', 'outline')
    expect(normal?.querySelectorAll('rect')).toHaveLength(3)
    expect(normal?.querySelectorAll('rect.fill-tone-dot')).toHaveLength(2)
    unmount()
    render(<RiskBadge level="high" />)
    const high = screen.getByText('High risk').parentElement
    expect(high).toHaveAttribute('data-form', 'soft')
    expect(high).toHaveAttribute('data-tone', 'danger')
    expect(high?.querySelectorAll('rect.fill-tone-dot')).toHaveLength(3)
  })

  it('names the cause, the audience and the version as outline facts', () => {
    render(
      <>
        <ClaimBadge level="effect_stated" short />
        <ClaimBadge level="fact_only" />
        <AudienceBadge audience={{ kind: 'groups', groups: ['finance', 'legal_team'] }} />
        <VersionBadge version={3} />
      </>,
    )
    expect(screen.getByText('Stated').parentElement).toHaveAttribute('data-form', 'outline')
    expect(screen.getByText('Cause not proven')).toBeInTheDocument()
    expect(screen.getByText('Only finance, legal team')).toBeInTheDocument()
    expect(screen.getByLabelText('Version 3')).toHaveTextContent('v3')
  })
})

describe('BlockedButton', () => {
  it('stays focusable and says why it cannot act', async () => {
    const user = userEvent.setup()
    render(<BlockedButton reason="The form is not ready yet.">Suggest a change</BlockedButton>)
    const button = screen.getByRole('button', { name: 'Suggest a change' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    await user.click(button)
    expect(
      within(await screen.findByRole('dialog')).getByText('The form is not ready yet.'),
    ).toBeVisible()
  })
})
