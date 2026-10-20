import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import {
  EditionChangeCard,
  EditionChangeCounts,
  EditionChangeSummary,
} from '@/components/editions/change-card'
import { countItemChanges } from '@/lib/edition-diff'
import { editionChangeKinds } from '@domain/editions'
import { RouterFrame } from './router-frame'
import {
  changedComparison,
  comparisonState,
  editionDiffLookups,
  pagedComparison,
} from './edition-diff-fixtures'

const meta = {
  title: 'Release/Edition diff kit',
  component: EditionChangeCard,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
  args: { comparison: changedComparison, lookups: editionDiffLookups },
  decorators: [
    (Story) => (
      <RouterFrame>
        <main className="flex max-w-reading min-w-0 flex-col gap-4 p-4">
          <h1 className="sr-only">Edition changes</h1>
          <Story />
        </main>
      </RouterFrame>
    ),
  ],
} satisfies Meta<typeof EditionChangeCard>
export default meta
type Story = StoryObj<typeof meta>

export const Changed: Story = {}
export const Added: Story = { args: { comparison: comparisonState('added') } }
export const Retired: Story = { args: { comparison: comparisonState('retired') } }
export const NoLongerServed: Story = { args: { comparison: comparisonState('removed') } }
export const SavedAgain: Story = { args: { comparison: comparisonState('resaved') } }
export const Checked: Story = { args: { comparison: comparisonState('checked') } }
export const NothingDifferent: Story = {
  args: { comparison: { ...changedComparison, change: null, fields: [] } },
}
export const AllStates: Story = {
  render: () => (
    <>
      <EditionChangeCounts
        counts={countItemChanges(editionChangeKinds.map((change) => ({ change })))}
      />
      {editionChangeKinds.map((change) => (
        <EditionChangeCard
          key={change}
          comparison={comparisonState(change)}
          lookups={editionDiffLookups}
        />
      ))}
    </>
  ),
}
export const SystemFields: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: '3 fields the system fills in' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Source marks')).toBeVisible()
  },
}
export const LongTextAndMentions: Story = {
  args: {
    comparison: {
      ...changedComparison,
      change: {
        ...changedComparison.change!,
        title:
          'What changed in the source definitions for the reporting markets and why the latest numbers need an extra check before comparing them across domains',
        why: {
          ...changedComparison.change!.why,
          proposerId: 'unavailable-person',
          editedBy: 'per_jon',
        },
      },
      mentions: {
        removed: [{ field: 'summary', position: 0, target: 'metric:orders', label: 'Orders' }],
        added: [
          {
            field: 'summary',
            position: 0,
            target: 'metric:marketing_spend',
            label: 'Marketing spend',
          },
        ],
      },
    },
  },
}

/** Earlier and later are the selected sides, even when going back several versions. */
export const Backwards: Story = {
  args: {
    comparison: {
      ...changedComparison,
      from: changedComparison.to,
      to: changedComparison.from!,
      backwards: true,
      change: {
        ...changedComparison.change!,
        from: changedComparison.change!.to,
        to: changedComparison.change!.from,
      },
      fields: changedComparison.fields.map((field) => ({
        ...field,
        before: field.after,
        after: field.before,
      })),
    },
  },
}

export const RangeSummary: Story = {
  render: () => <EditionChangeSummary summary={pagedComparison} />,
}
