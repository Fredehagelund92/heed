import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent } from 'storybook/test'
import { demoProposalIds } from '@/api/mock-demo-proposals'
import { formValues, type ContextFormValues } from '@/lib/context-form'
import { StoryApp } from './story-app'

const meta = { title: 'Pages/Add context', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const filled: ContextFormValues = {
  ...formValues(),
  areaId: 'area_sales',
  title: 'Online sales to Norway stopped',
  summaryMarkup: 'Online sales to @[Norway](val:market/norway) stopped after a new customs rule.',
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
  },
  validity: { start: '2026-08-04', end: null },
  evidence: [
    {
      url: 'https://customs.example/norway/notices/online-sales',
      quote: 'Parcels from webshops outside Norway are held at the border.',
      date: '2026-08-05',
    },
  ],
}
const story = (value: ContextFormValues | null) => (
  <StoryApp path="/library/new" preferences={{ 'heed.context.per_maria.new': value }} />
)
export const Empty: Story = { render: () => story(null) }
export const Filled: Story = { render: () => story(filled) }
export const OpenIssue: Story = { render: () => story({ ...filled, kind: 'issue' }) }
export const EndedIssue: Story = {
  render: () =>
    story({
      ...filled,
      kind: 'issue',
      ended: true,
      validity: { start: '2026-08-04', end: '2026-08-06' },
    }),
}
export const LongSummary: Story = {
  render: () => story({ ...filled, summaryMarkup: 'A long observation. '.repeat(20) }),
}
export const GuideWithSteps: Story = {
  render: () =>
    story({
      ...filled,
      kind: 'guide',
      title: 'How to explain a drop after a market closes',
      summaryMarkup:
        'Use this when a metric moves in a market and nobody has said why. Work through the steps in order.',
      bodyMarkup:
        '## Before you start\n\n- Confirm the **period** and the @[Norway](val:market/norway) market.\n\n## Steps\n\n1. Compare the affected market with one that was not affected.\n2. If the dates overlap, say the item *might be related*.\n\n> A closure is not proof of a cause.',
    }),
}
export const TextCheck: Story = {
  render: () =>
    story({
      ...filled,
      bodyMarkup: 'If the owner asks, send the detail to anna.berg@example.com.',
    }),
}
/** Suggest a change: the current version, then an optional line on what is wrong with it. */
export const SuggestAChange: Story = {
  render: () => <StoryApp path="/library/itm_jyfuvl07/suggest" />,
  play: async () => {
    await expect(
      await screen.findByRole('textbox', { name: /What is wrong with the current version/ }),
    ).toBeVisible()
  },
}

/** Edit and resubmit: the reviewer's request at the top, and an optional line on what changed. */
export const ChangesRequested: Story = {
  render: () => <StoryApp path={`/library/new?draft=${demoProposalIds.changes_requested}`} />,
  play: async () => {
    await expect(await screen.findByText(/asked for changes/)).toBeVisible()
    await expect(screen.getByText(/Please add the link to the customs notice/)).toBeVisible()
    await expect(screen.getByRole('textbox', { name: /What you changed/ })).toBeVisible()
  },
}

/** A draft started from a gap: the month people asked about is a hint, never its dates. */
export const DraftFromGap: Story = {
  render: () => <StoryApp path={`/library/new?draft=${demoProposalIds.draft}&asked=2026-10`} />,
  play: async () => {
    await expect(await screen.findByText(/People asked about October 2026/)).toBeVisible()
  },
}

/** The day the source was read: one press fills in today, never silently. */
export const EvidenceReadToday: Story = {
  render: () => story({ ...filled, evidence: [{ ...filled.evidence[0]!, date: '' }] }),
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Date you read it: today' }))
    await expect(screen.getByRole('textbox', { name: 'Date you read it' })).not.toHaveValue('')
  },
}

/** A metric with no domain: Heed cannot choose the item's domain from it, and says what to do. */
export const MetricWithoutDomain: Story = {
  render: () =>
    story({
      ...formValues(),
      scope: { metrics: ['metric:on_time_shipping_rate'], dimensions: [], dimensionValues: [] },
    }),
  play: async () => {
    await expect(
      await screen.findByText(/On-time shipping rate has no domain yet/, {}, { timeout: 10_000 }),
    ).toBeVisible()
  },
}
