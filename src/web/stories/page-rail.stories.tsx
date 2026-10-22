import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import {
  CalendarCheckIcon,
  HashIcon,
  LibraryBigIcon,
  PencilIcon,
  PencilLineIcon,
  TimerIcon,
} from '@/components/icons'
import { Page, PageDocument } from '@/components/page/page'
import { PageRail, RailSection } from '@/components/page/page-rail'
import { GateResult } from '@/components/proposal/gate-result'
import { OverlapList } from '@/components/proposal/overlap-list'
import { PartCard } from '@/components/proposal/part-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { normalGate, statusOverlap } from '@/design-preview/proposal-samples'
import { RouterFrame } from './router-frame'

/**
 * The page rail: the flat column beside a page's main column (the proposal, review, term,
 * editions and Add a fact pages). A hairline on its left, a hairline between sections, the
 * page's own type, no card. Below a 1,152 pixel page it stacks under the main column; the panel
 * placement has no frame, for the contents of a docked panel. The parts that sit in a rail
 * (checks, overlaps, the field table) drop their card frame inside it.
 */
const meta = {
  title: 'Parts/Page rail',
  parameters: { layout: 'fullscreen' },
  // The overlaps link to their items.
  decorators: [
    (Story) => (
      <RouterFrame>
        <Story />
      </RouterFrame>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Details() {
  return (
    <RailSection title="Details">
      <FieldTable label="Details">
        <FieldRow icon={HashIcon} label="Proposal">
          <span className="tabular-nums">#11</span>
        </FieldRow>
        <FieldRow icon={PencilLineIcon} label="Written">
          Web form
        </FieldRow>
        <FieldRow icon={TimerIcon} label="Review due" hint="Paused while changes are requested.">
          <span className="tabular-nums">14 Oct 2026</span>
        </FieldRow>
        <FieldRow icon={CalendarCheckIcon} label="Next check">
          <span className="tabular-nums">20 Jan 2027</span>
        </FieldRow>
      </FieldTable>
    </RailSection>
  )
}

function Paper() {
  return (
    <article data-slot="paper" className="flex w-full max-w-reading min-w-0 flex-col gap-4">
      <p className="text-display font-bold tracking-display">
        New tax rate applied in Poland from 8 June 2026
      </p>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-16" />
    </article>
  )
}

/** Beside the main column on a wide page, below it on a narrow one (viewport menu). */
export const OnAPage: Story = {
  render: () => (
    <Page title="Page rail">
      <PageDocument>
        <Paper />
        <PageRail aria-label="Checks, overlaps and details" className="max-w-reading">
          <GateResult gate={normalGate} risk="normal" />
          <OverlapList overlap={statusOverlap} limit={5} />
          <Details />
        </PageRail>
      </PageDocument>
    </Page>
  ),
  play: async ({ canvasElement }) => {
    const rail = within(canvasElement).getByRole('complementary', {
      name: 'Checks, overlaps and details',
    })
    await expect(within(rail).getByRole('heading', { name: 'Checks' })).toBeVisible()
    await expect(rail.querySelector('[data-slot="part-card"]')).not.toHaveClass('rounded-lg')
  },
}

/** A heading with a muted line under it, an icon, a badge or an action at the end of the row. */
export const Sections: Story = {
  render: () => (
    <div className="flex p-6">
      <PageRail placement="beside" aria-label="Sections">
        <RailSection title="What changed" description="2026-10-07.2 against 2026-10-07.1">
          <p className="text-dense">Three items changed, one was retired.</p>
        </RailSection>
        <RailSection
          title="On the shelf"
          icon={LibraryBigIcon}
          aside={
            <Badge tone="warning" size="sm">
              Needed
            </Badge>
          }
        >
          <p className="text-dense text-muted-foreground">Nothing on the shelf yet.</p>
        </RailSection>
        <PartCard
          title="Review settings"
          aside={
            <Button variant="outline" size="sm">
              <PencilIcon />
              Change
            </Button>
          }
        >
          <p className="text-dense">Only an owner or deputy changes these.</p>
        </PartCard>
      </PageRail>
    </div>
  ),
}

/** Long words wrap inside the 320 column; nothing scrolls sideways. */
export const LongText: Story = {
  render: () => (
    <div className="flex p-6">
      <PageRail placement="beside" aria-label="Long text">
        <RailSection title="Comparing Return on ad spend between Poland, Norway and the United States for every quarter">
          <p className="text-dense break-words">
            Agents are told it may be out of date until the owner of Sales checks the source tool
            again: https://reports.example.com/commercial/return-on-ad-spend/poland/2026
          </p>
        </RailSection>
        <Details />
      </PageRail>
    </div>
  ),
}

/** A section with nothing to show says so in a muted line. */
export const Empty: Story = {
  render: () => (
    <div className="flex p-6">
      <PageRail placement="beside" aria-label="Empty">
        <PartCard title="Checks">
          <p className="text-dense">No check results yet.</p>
        </PartCard>
        <OverlapList overlap={undefined} loading />
      </PageRail>
    </div>
  ),
}

/** The contents of a docked panel: the same sections, with no frame of their own. */
export const InAPanel: Story = {
  render: () => (
    <div className="flex max-w-companion flex-col border-l p-4">
      <PageRail placement="panel" aria-label="Panel">
        <GateResult gate={normalGate} risk="normal" />
        <Details />
      </PageRail>
    </div>
  ),
}
