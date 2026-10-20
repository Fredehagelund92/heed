import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen } from 'storybook/test'
import { HeedDomainIcon, SearchIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/person-avatar'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { people } from '@/mocks/reference-data'

const meta = {
  title: 'Parts/Small parts',
  parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2 p-6">
      {(['soft', 'outline', 'bare', 'solid'] as const).map((form) => (
        <Badge
          key={form}
          form={form}
          tone="teal"
          icon={form === 'solid' ? undefined : HeedDomainIcon}
        >
          {form}
        </Badge>
      ))}
    </div>
  ),
}

export const Avatars: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2 p-6">
      {people.map((person) => (
        <PersonAvatar key={person.id} person={person} />
      ))}
    </div>
  ),
}

export const Shortcuts: Story = {
  render: () => (
    <KbdGroup className="p-6">
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>
  ),
}

export const InputAndSkeleton: Story = {
  render: () => (
    <div className="flex w-popover flex-col gap-4 p-6">
      <Input aria-label="Example input" placeholder="Search items" />
      <Skeleton className="h-control-md w-full" />
    </div>
  ),
}

/**
 * The text sizes of a text input (contract 6.5): a toolbar search reads in 13 like the toolbar's
 * buttons and the table beside it, a form field in 14 like the rest of the form. A coarse pointer
 * gets 16 in both, so iOS does not zoom.
 */
export const InputSizes: Story = {
  render: () => (
    <div className="flex w-popover flex-col gap-4 p-6">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput aria-label="Toolbar search" placeholder="Search the library" />
      </InputGroup>
      <Input aria-label="Toolbar field" defaultValue="A toolbar field, 32 high" />
      <Input aria-label="Form field" size="lg" defaultValue="A form field, 40 high" />
      <Input
        aria-label="Long text"
        size="lg"
        defaultValue="Payment provider delays order data in Poland for every market it serves"
      />
      <Input aria-label="Disabled field" size="lg" disabled defaultValue="Disabled" />
    </div>
  ),
  play: async () => {
    const size = (name: string) => getComputedStyle(screen.getByRole('textbox', { name })).fontSize
    if (matchMedia('(pointer: coarse)').matches) return
    await expect(size('Toolbar search')).toBe('13px')
    await expect(size('Toolbar field')).toBe('13px')
    await expect(size('Form field')).toBe('14px')
  },
}
