import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ContextItem } from '@domain/item'
import { ItemHeader } from '@/components/item/item-header'
import { PageContent } from '@/components/page/page'
import { itemState } from '@/lib/item-state'
import { areas, FIXTURE_TODAY } from '@/mocks/reference-data'

/**
 * The item page header (the note line of the item page design) in every lifecycle state, side by side. The fixtures have no item whose period starts later and no item that ends
 * within 30 days with a warning, so these are one fixture note with its dates changed. Today is
 * 7 October 2026. The actions are left out; the item page stories show them with the shell.
 */
const meta = {
  title: 'Library/Item header',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const note: ContextItem = {
  id: 'itm_story001',
  kind: 'note',
  areaId: 'area_sales',
  status: 'accepted',
  version: 2,
  title: 'Net revenue excludes test accounts',
  summary: 'Net revenue excludes test accounts.',
  references: [],
  scope: { metrics: ['net_revenue'], dimensions: [], dimensionValues: [] },
  validity: { start: '2026-05-14', end: null },
  reviewDate: '2027-01-13',
  reviewQuestion: 'still_correct',
  evidence: [],
  checkFlag: null,
  claimLevel: 'fact_only',
  riskLevel: 'normal',
  notToConclude: 'cause not proven',
  audience: { kind: 'everyone' },
  ownerId: 'per_jon',
  changeMarks: {},
  createdVia: 'form',
  proposerId: 'per_maria',
  createdAt: '2026-05-14T08:00:00Z',
  updatedAt: '2026-05-20T08:00:00Z',
}

const issue: ContextItem = {
  ...note,
  kind: 'issue',
  title: 'Tracking outage in the Spain app',
  validity: { start: '2026-10-02', end: null },
  reviewDate: '2026-10-16',
  reviewQuestion: 'still_going_on',
}

const states: { name: string; item: ContextItem }[] = [
  { name: 'Standing fact, ongoing', item: note },
  {
    name: 'Ends within 30 days',
    item: { ...note, validity: { start: '2026-05-14', end: '2026-10-26' } },
  },
  { name: 'Source missing', item: { ...note, checkFlag: 'source_missing' } },
  {
    name: 'Source missing, high risk',
    item: { ...note, checkFlag: 'source_missing', riskLevel: 'high' },
  },
  {
    name: 'Source changed and the check overdue',
    item: { ...note, checkFlag: 'needs_check', reviewDate: '2026-09-04' },
  },
  {
    name: 'Starts later',
    item: { ...note, validity: { start: '2026-11-01', end: null } },
  },
  { name: 'Active issue, no end date', item: issue },
  {
    name: 'Active issue with an end date',
    item: { ...issue, validity: { start: '2026-09-29', end: '2026-10-11' }, reviewDate: null },
  },
  {
    name: 'Active issue, still going on?',
    item: { ...issue, validity: { start: '2026-09-15', end: null }, reviewDate: '2026-09-29' },
  },
  {
    name: 'Resolved issue',
    item: { ...issue, validity: { start: '2026-08-03', end: '2026-08-15' }, reviewDate: null },
  },
  {
    name: 'Ended',
    item: { ...note, validity: { start: '2024-04-08', end: '2024-05-14' }, reviewDate: null },
  },
  { name: 'Retired', item: { ...note, status: 'retired' } },
]

function Header({ item }: { item: ContextItem }) {
  const area = areas.find((candidate) => candidate.id === item.areaId)
  const state = itemState(item, {
    today: FIXTURE_TODAY,
    ownerName: 'Jon Abara',
    areaName: area?.name ?? null,
    retired: item.status === 'retired' ? { by: 'Jon Abara', date: '2026-09-01' } : null,
  })
  return (
    <PageContent>
      <ItemHeader item={item} area={area} state={state} />
    </PageContent>
  )
}

/** Every state, one header each, with its name above it. */
export const States: Story = {
  render: () => (
    <div className="@container flex flex-col gap-8 pb-16">
      {states.map(({ name, item }) => (
        <section key={name} aria-label={name} className="flex flex-col border-b pb-6">
          <PageContent className="pt-4 pb-0">
            <p className="text-caption text-muted-foreground">{name}</p>
          </PageContent>
          <Header item={item} />
        </section>
      ))}
    </div>
  ),
}

/** A period that starts later: the note says when the item starts. */
export const StartsLater: Story = {
  render: () => (
    <div className="@container">
      <Header item={{ ...note, validity: { start: '2026-11-01', end: null } }} />
    </div>
  ),
}
