import type { Meta, StoryObj } from '@storybook/react-vite'
import { CheckIcon, PencilIcon } from '@/components/icons'
import { BlockedButton } from '@/components/ui/blocked-button'

/**
 * A button that cannot act yet and says why (contract 7.2, "BlockedButton"). It stays focusable;
 * pressing it opens the reason. Shown in the default, small, icon-only and long label forms.
 */
const meta = {
  title: 'Components/Blocked button',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const reason =
  'Suggesting a change opens the Add a fact form, which is not ready yet. Until then, tell Jon Abara what should change.'

export const States: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <BlockedButton reason={reason}>
        <PencilIcon />
        Suggest a change
      </BlockedButton>
      <BlockedButton reason={reason} size="sm">
        <CheckIcon />
        Mark as checked
      </BlockedButton>
      <BlockedButton reason={reason} size="icon" aria-label="Mark as checked">
        <CheckIcon />
      </BlockedButton>
      <BlockedButton reason={reason} className="max-w-reading">
        <span className="truncate">
          A very long action label that keeps going until it has to stop somewhere near the end of
          the reading width so the button never pushes the page sideways
        </span>
      </BlockedButton>
    </div>
  ),
}
