import type { Meta, StoryObj } from '@storybook/react-vite'
import { DetailsList } from '@/components/page/details-list'

const meta = {
  title: 'Page/Details list',
  component: DetailsList,
  decorators: [
    (Story) => (
      <div className="w-item-details p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    label: 'Details',
    rows: [
      { label: 'Status', value: 'Accepted' },
      { label: 'Owner', value: 'Priya Nair' },
    ],
  },
} satisfies Meta<typeof DetailsList>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const LongValues: Story = {
  args: {
    rows: [
      { label: 'Who can see it', value: 'The Sales team and the regional knowledge owners' },
      { label: 'Confirmed', value: 'Not recorded' },
    ],
  },
}
export const Empty: Story = { args: { rows: [] } }
