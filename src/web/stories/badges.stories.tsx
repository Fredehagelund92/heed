import { useLayoutEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { domainHues, itemKinds, riskLevels } from '@domain/item'
import { proposalStates } from '@domain/proposal-state'
import { itemDisplayStatuses } from '@domain/status'
import { expect, userEvent, waitFor } from 'storybook/test'
import { HeedDomainIcon, HeedRecheckDueIcon, heedMarks } from '@/components/icons'
import { AudienceBadge, ClaimBadge, RiskBadge, VersionBadge } from '@/components/item/fact-badges'
import {
  CountBadge,
  DateBadge,
  DomainBadge,
  EditWaitingBadge,
  KindBadge,
  KindIcon,
  KindMark,
  NeedsALookBadge,
  Owner,
  ProposalStatusBadge,
  StatusBadge,
  StatusMark,
} from '@/components/item/item-marks'
import { CatalogueStatusBadge } from '@/components/catalogue/catalogue-marks'
import { RowStatus, StatusIcon } from '@/components/library/status-icon'
import { statusHints, statusNames } from '@/lib/library'
import { MentionChip } from '@/components/item/mention-chip'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { gridCell } from '@/components/page/grid'
import { cn } from '@/lib/utils'

/**
 * The badge system (contract 6.13): one anatomy, four forms, eight domain hues on a ring, and the
 * badges built from it. Switch the theme in the toolbar to see dark mode; every story reads the
 * same tokens. "Contrast" measures the painted colours of every tone in the current theme.
 */
const meta = {
  title: 'Library/Badges',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const TODAY = '2026-10-07'
const longName = 'Media sales and advertising technology for every market we operate in'

function Caption({ children }: { children: string }) {
  return <span className="text-caption text-muted-foreground">{children}</span>
}

/** One anatomy, four forms, two sizes. */
export const Forms: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-6">
          <Badge form="soft" tone="teal" icon={HeedDomainIcon} size={size}>
            Sales
          </Badge>
          <Badge form="outline" tone="teal" icon={HeedDomainIcon} size={size}>
            Sales
          </Badge>
          <Badge form="bare" tone="teal" icon={HeedDomainIcon} size={size}>
            Sales
          </Badge>
          <Badge form="solid" size={size}>
            3
          </Badge>
          <Badge form="soft" tone="warning" icon={HeedRecheckDueIcon} size={size}>
            Check due
          </Badge>
          <Caption>{size === 'md' ? 'md, 24 high' : 'sm, 20 high'}</Caption>
        </div>
      ))}
    </div>
  ),
}

/** Every hue on the ring in every form. Red and amber are not on it: they belong to state. */
export const DomainHues: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-4 text-dense">
      {domainHues.map((hue) => (
        <div key={hue} className="flex flex-col items-start gap-2">
          <Badge form="soft" tone={hue} icon={HeedDomainIcon}>
            {`Domain ${hue}`}
          </Badge>
          <Badge form="outline" tone={hue} icon={HeedDomainIcon}>
            {`Domain ${hue}`}
          </Badge>
          <Badge form="bare" tone={hue} icon={HeedDomainIcon}>
            {`Domain ${hue}`}
          </Badge>
          <Badge form="soft" tone={hue} icon={HeedDomainIcon} size="sm">
            {`Domain ${hue}`}
          </Badge>
          <Caption>{hue}</Caption>
        </div>
      ))}
    </div>
  ),
}

/**
 * The domain badge for the five domains. Paid media is violet, not amber: amber means warning. A
 * badge is as wide as its name, up to the room its container gives; the long name here has room.
 */
export const Domains: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <DomainBadge name="Sales" label="teal" />
        <DomainBadge name="Marketing" label="pink" />
        <DomainBadge name="Customer value" label="indigo" />
        <DomainBadge name="Paid media" label="violet" />
        <DomainBadge name="Sandbox" label="gray" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DomainBadge name={longName} label="indigo" />
        <DomainBadge name="Sales" label="teal" form="outline" />
        <DomainBadge name="Sales" label="teal" form="bare" />
        <DomainBadge name="Sales" label="teal" size="sm" />
      </div>
    </div>
  ),
}

/** Realistic names a business gives its domains, and one far longer than any should be. */
const domainNames = [
  { name: 'Sales', label: 'teal' },
  { name: 'Audience & Engagement', label: 'pink' },
  { name: 'Product & Subscription', label: 'indigo' },
  { name: 'Stores & Suppliers', label: 'violet' },
  {
    name: 'Regulatory Reporting, Returns, Repairs and Customer Protection Operations',
    label: 'gray',
  },
] as const

/**
 * The label rule (contract 6.13): the container decides how much of a domain's name shows. The
 * badge shrinks inside its box and never past it, a name with no room ends in an ellipsis and
 * keeps the whole name in a tooltip (hover the last one in the column), and a badge beside a
 * title is capped at one Domain column. The Domain column (192) prints realistic names whole.
 */
export const LongDomainNames: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Caption>In the Domain column</Caption>
        <div role="table" aria-label="Domains in a column" className="rounded-lg border text-dense">
          {domainNames.map(({ name, label }) => (
            <div
              role="row"
              key={name}
              className="flex h-row items-stretch border-b last:border-b-0"
            >
              <div role="cell" data-slot="domain-cell" className={cn(gridCell, 'w-column-domain')}>
                <DomainBadge name={name} label={label} size="sm" />
              </div>
              <div role="cell" className={cn(gridCell, 'min-w-0 flex-1')}>
                <span className="truncate">Norway launch campaign started</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Caption>Beside a title, capped at one Domain column</Caption>
        <div className="flex w-popover items-center gap-2 rounded-lg border px-3 py-2 text-dense">
          <span className="min-w-0 flex-1 truncate">
            Online sales to Norway stopped after a customs rule
          </span>
          <DomainBadge
            name={domainNames[4].name}
            label="gray"
            size="sm"
            className="max-w-column-domain"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Caption>With room, in a panel header</Caption>
        <div data-slot="domain-wrap" className="flex w-dock flex-wrap items-center gap-2">
          {domainNames.map(({ name, label }) => (
            <DomainBadge key={name} name={name} label={label} />
          ))}
        </div>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const badges = [...canvasElement.querySelectorAll<HTMLElement>('[data-slot="domain-badge"]')]
    await expect(badges).toHaveLength(11)
    // No badge leaves the content box of its container: never past a cell's padding or line.
    for (const badge of badges) {
      const box = badge.parentElement!
      const style = getComputedStyle(box)
      const right = box.getBoundingClientRect().right - parseFloat(style.paddingRight)
      await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(right + 0.5)
    }
    const label = (badge: Element) => badge.querySelector<HTMLElement>('[data-slot="badge-label"]')!
    const cut = (badge: Element) => label(badge).scrollWidth > label(badge).clientWidth
    // The column prints the four realistic names whole; only the longest is cut.
    const column = [...canvasElement.querySelectorAll('[data-slot="domain-cell"] > *')]
    await expect(column.map(cut)).toEqual([false, false, false, false, true])
    // With room, every name prints whole but the longest, which wraps to its own line.
    const wrap = [...canvasElement.querySelectorAll('[data-slot="domain-wrap"] > *')]
    await expect(wrap.slice(0, 4).map(cut)).toEqual([false, false, false, false])
    // A cut name keeps the whole name one step away, in the tooltip.
    const longest = column[4]!
    await waitFor(() => expect(longest).toHaveAttribute('data-cut'))
    await userEvent.hover(longest)
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        domainNames[4].name,
      ),
    )
    await userEvent.unhover(longest)
    // A name that fits has no tooltip to announce.
    await expect(column[0]).not.toHaveAttribute('data-cut')
  },
}

/**
 * One icon per kind, everywhere (the Home glyph): bare and muted, 16 in rows and 14 in running
 * metadata, inside an outline badge where there is room. Amber only for an issue that applies.
 */
export const Kinds: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex items-center gap-3">
          {itemKinds.map((kind) => (
            <KindIcon key={kind} kind={kind} size={size} />
          ))}
          <Caption>{`icon ${size === 'md' ? 16 : 14}`}</Caption>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {itemKinds.map((kind) => (
          <KindBadge key={kind} kind={kind} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <KindIcon kind="issue" active />
        <KindBadge kind="issue" active />
        <KindIcon kind="issue" />
        <KindBadge kind="issue" />
        <Caption>an issue: amber while it applies, muted once ended</Caption>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-dense">
        {itemKinds.map((kind) => (
          <KindMark key={kind} kind={kind} />
        ))}
        <Caption>running metadata</Caption>
      </div>
    </div>
  ),
}

/** Tint means look at this: a status is soft only when it asks for a look. */
export const Statuses: Story = {
  render: () => (
    <div className="flex flex-col gap-4 text-dense">
      {(['md', 'sm'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-4">
          {itemDisplayStatuses.map((status) => (
            <StatusBadge key={status} status={status} size={size} />
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-4">
        <NeedsALookBadge />
        <EditWaitingBadge size="md" />
        {itemDisplayStatuses.map((status) => (
          <StatusMark key={status} status={status} iconOnly />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {proposalStates.map((state) => (
          <ProposalStatusBadge key={state} state={state} />
        ))}
      </div>
    </div>
  ),
}

/**
 * The Heed marks (contract 6.11): the product's own glyphs for its kinds, its states and the
 * domain, risk and validity fields, at 24, 18, 16 and 14. The shell says the family (a scene for a
 * kind, a ring for a state, an outline for a field), the point says which one. Muted, the point
 * stays in the foreground; in a tone, the whole mark takes the hue.
 */
export const HeedMarks: Story = {
  render: () => (
    <div className="grid max-w-overview grid-cols-3 gap-3 text-dense">
      {Object.entries(heedMarks).map(([name, Mark]) => (
        <div
          key={name}
          data-slot="heed-mark-sample"
          className="flex flex-col gap-3 rounded-lg border p-4"
        >
          <div className="flex items-end gap-3 text-muted-foreground heed-ink">
            <Mark aria-hidden="true" className="size-6" />
            <Mark aria-hidden="true" className="size-icon-status" />
            <Mark aria-hidden="true" className="size-4" />
            <Mark aria-hidden="true" className="size-icon-sm" />
          </div>
          <div data-tone="warning" className="flex items-end gap-3 text-tone-dot">
            <Mark aria-hidden="true" className="size-6" />
            <Mark aria-hidden="true" className="size-icon-status" />
            <Mark aria-hidden="true" className="size-4" />
            <Mark aria-hidden="true" className="size-icon-sm" />
          </div>
          <Caption>{name}</Caption>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const samples = canvasElement.querySelectorAll('[data-slot="heed-mark-sample"]')
    await expect(samples).toHaveLength(15)
    for (const sample of samples) {
      // Four sizes, muted and in a tone, and every one with its point.
      await expect(sample.querySelectorAll('svg.lucide')).toHaveLength(8)
      for (const svg of sample.querySelectorAll('svg')) {
        await expect(svg.querySelector('.heed-point, .heed-point-fill')).not.toBeNull()
      }
    }
  },
}

/**
 * The status column (round 2.1 of the design): one 16 pixel glyph, seven statuses with seven
 * shapes, the name in the tooltip and the accessible name. Hover a glyph to see its tooltip. The
 * key below each is what the tooltip says.
 */
export const StatusColumn: Story = {
  render: () => (
    <div className="flex max-w-reading flex-col gap-4 text-dense">
      {itemDisplayStatuses.map((status) => (
        <div key={status} className="flex items-start gap-3 rounded-lg border p-3">
          <StatusIcon status={status} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-bold">{statusNames[status]}</span>
            <span className="text-muted-foreground">{statusHints[status]}</span>
          </div>
        </div>
      ))}
    </div>
  ),
}

/**
 * The item page's facts (S5 of the item page design): risk as three ascending bars, soft red only
 * for high; cause, audience and version as outline facts.
 */
export const Facts: Story = {
  render: () => (
    <div className="flex flex-col gap-4 text-dense">
      <div className="flex flex-wrap items-center gap-3">
        {riskLevels.map((level) => (
          <RiskBadge key={level} level={level} />
        ))}
        {riskLevels.map((level) => (
          <RiskBadge key={level} level={level} form="bare" />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ClaimBadge level="effect_stated" />
        <ClaimBadge level="fact_only" />
        <ClaimBadge level="effect_stated" short />
        <ClaimBadge level="fact_only" short />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <AudienceBadge audience={{ kind: 'everyone' }} />
        <AudienceBadge audience={{ kind: 'groups', groups: ['finance', 'legal'] }} />
        <VersionBadge version={1} />
        <VersionBadge version={12} />
      </div>
    </div>
  ),
}

/** Colour in a date is time pressure only. Today is 7 October 2026 here. */
export const Dates: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6 text-dense">
      <DateBadge date={null} today={TODAY} />
      <DateBadge date="2027-01-13" today={TODAY} />
      <DateBadge date="2026-10-31" today={TODAY} />
      <DateBadge date="2026-10-08" today={TODAY} />
      <DateBadge date={TODAY} today={TODAY} />
      <DateBadge date="2026-06-23" today={TODAY} />
      <DateBadge date="2026-10-04" today={TODAY} deadline />
      <DateBadge date="2026-10-31" today={TODAY} size="sm" />
    </div>
  ),
}

/**
 * People are initials on a soft tint of their own (from their id): bare in cells (28), an outline
 * chip in headers and filters (20), and with a role line on the item page (32), where the name
 * and the role start at one edge.
 */
export const Owners: Story = {
  render: () => (
    <div className="flex w-column-owner flex-col gap-3 text-dense">
      <Owner name="Noor Haddad" initials="NH" />
      <Owner name="Noor Haddad" initials="NH" size="md" />
      <Owner name="Noor Haddad" initials="NH" size="lg" />
      <Owner name="Noor Haddad" initials="NH" chip />
      <Owner name={null} />
      <Owner name={longName} initials="MS" />
      <Owner name="Noor Haddad" initials="NH" showName={false} />
      <Owner name="Priya Nair" initials="PN" size="lg" role="Owner of Paid media" />
      <Owner name={longName} initials="MS" size="lg" role="Owner of Sales and Sandbox" />
    </div>
  ),
}

/** Counts: quiet in lists, a chip in a control, ink for what waits for you, amber for a look. */
export const Counts: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <CountBadge count={1407} tone="quiet" />
      <CountBadge count={38} />
      <CountBadge count={3} tone="ink" />
      <CountBadge count={96} tone="attention" />
    </div>
  ),
}

/** The @ mention in running text: an inline chip with the look of what it points at. */
export const Mentions: Story = {
  render: () => (
    <div className="flex max-w-reading flex-col gap-6">
      <p className="text-large">
        Online sales of <MentionChip target={{ type: 'area', label: 'teal' }} name="Sales" />{' '}
        products to <MentionChip target={{ type: 'val' }} name="Poland" /> stopped after the customs
        notice. Compare <MentionChip target={{ type: 'metric' }} name="New customers" /> and{' '}
        <MentionChip target={{ type: 'metric' }} name="Orders" /> split by{' '}
        <MentionChip target={{ type: 'dim' }} name="Channel" />, and read{' '}
        <MentionChip
          target={{ type: 'item', kind: 'event' }}
          name="New tax rate in Poland from 8 June 2026 applies to every product"
        />{' '}
        first. The old note{' '}
        <MentionChip target={{ type: 'item', kind: 'note' }} name="Retired payments note" missing />{' '}
        no longer exists.
      </p>
      <p className="text-dense">
        At 13 pixels: <MentionChip target={{ type: 'area', label: 'violet' }} name="Paid media" />{' '}
        and <MentionChip target={{ type: 'metric' }} name="New customers" />.
      </p>
    </div>
  ),
}

type Rgb = [number, number, number]

/** Paints a CSS colour on a 1 pixel canvas and reads back the 8 bit sRGB the browser drew. */
function painted(colour: string): Rgb {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return [0, 0, 0]
  context.fillStyle = colour
  context.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

function contrast(one: Rgb, two: Rgb): number {
  const luminance = ([r, g, b]: Rgb) => {
    const linear = (channel: number) => {
      const c = channel / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  }
  const high = Math.max(luminance(one), luminance(two))
  const low = Math.min(luminance(one), luminance(two))
  return Math.floor(((high + 0.05) / (low + 0.05)) * 10) / 10
}

const checkedTones: BadgeTone[] = [
  ...domainHues,
  'success',
  'warning',
  'info',
  'danger',
  ...itemKinds,
]

function ContrastRow({ tone }: { tone: BadgeTone }) {
  const ref = useRef<HTMLTableRowElement>(null)
  const [ratios, setRatios] = useState<{ text: number; mark: number } | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const style = getComputedStyle(element)
      const tint = painted(style.getPropertyValue('--tone-tint'))
      setRatios({
        text: contrast(painted(style.getPropertyValue('--tone-ink')), tint),
        mark: contrast(painted(style.getPropertyValue('--tone-dot')), tint),
      })
    }
    measure()
    // The theme menu switches a class on the root element: measure again in the new theme.
    const observer = new MutationObserver(measure)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  const verdict = (ratio: number, min: number) => (
    <span className={ratio >= min ? 'text-foreground' : 'font-bold text-destructive'}>
      {ratio.toFixed(1)} {ratio >= min ? 'pass' : 'FAIL'}
    </span>
  )
  return (
    <tr ref={ref} data-tone={tone} className="border-b">
      <td className="py-2 pr-4">
        <Badge form="soft" tone={tone} icon={HeedDomainIcon}>
          {tone}
        </Badge>
      </td>
      <td className="py-2 pr-4 tabular-nums">{ratios ? verdict(ratios.text, 4.5) : null}</td>
      <td className="py-2 pr-4 tabular-nums">{ratios ? verdict(ratios.mark, 3) : null}</td>
    </tr>
  )
}

/**
 * The contrast check: every tone's label (ink) and mark (dot) measured on its tint, as the
 * browser paints them in the current theme. Text needs 4.5, a mark 3 (it is never the only cue).
 * tests/lint/tokens.test.ts checks the same pairs from tokens.css in both themes.
 */
export const Contrast: Story = {
  render: () => (
    <table className="text-dense">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2 pr-4 font-bold">Tone</th>
          <th className="py-2 pr-4 font-bold">Label on tint (4.5)</th>
          <th className="py-2 pr-4 font-bold">Mark on tint (3)</th>
        </tr>
      </thead>
      <tbody>
        {checkedTones.map((tone) => (
          <ContrastRow key={tone} tone={tone} />
        ))}
      </tbody>
    </table>
  ),
}

/** Calm phone rows retain accessible status names; warnings and open work keep their words. */
export const PhoneStatuses: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <RowStatus status="accepted" />
      <RowStatus status="source_missing" />
      <CatalogueStatusBadge status="in_sync" size="sm" iconOnly />
      <CatalogueStatusBadge status="changed" tool="Cube" size="sm" />
      <ProposalStatusBadge state="accepted" size="sm" iconOnly />
      <ProposalStatusBadge state="changes_requested" size="sm" />
    </div>
  ),
}
