import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@/components/ui/button'
import { SearchIcon } from '@/components/icons'

const meta = {
  title: 'Parts/Button',
  component: Button,
  parameters: { layout: 'centered' },
  args: { children: 'Save changes' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-4 p-6">
      {(['default', 'outline', 'ghost', 'destructive', 'link'] as const).map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
}

/** Control heights come from tokens.css: 24, 32, 36 and 40 pixels. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-4 p-6">
      {(['sm', 'default', 'lg', 'touch'] as const).map((size) => (
        <Button key={size} {...args} size={size}>
          {size}
        </Button>
      ))}
      <Button {...args} size="icon" aria-label="Search">
        <SearchIcon />
      </Button>
    </div>
  ),
}

export const Disabled: Story = { args: { disabled: true } }
