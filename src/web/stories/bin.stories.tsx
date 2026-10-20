import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * The Bin: the items an administrator moved out of the library, with who moved each, when and
 * why, and Restore. Ravi is an administrator; anyone else is told whose page it is. Use the
 * viewport menu for 1440, 1024 and 390 and the theme menu for dark.
 */
const meta = {
  title: 'Library/Bin',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Three items moved with one reason (the `binned` scenario). */
export const WithItems: Story = {
  render: () => <StoryApp path="/library/bin" person="per_ravi" scenario="binned" />,
  play: async ({ canvasElement }) => {
    const table = await within(canvasElement).findByRole(
      'table',
      { name: 'Bin' },
      { timeout: 10_000 },
    )
    await expect(within(table).getAllByRole('button', { name: /^Restore / })).toHaveLength(3)
  },
}

export const Empty: Story = {
  render: () => <StoryApp path="/library/bin" person="per_ravi" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('The Bin is empty', {}, { timeout: 10_000 }),
    ).toBeVisible()
  },
}

/** Every row selected from the header box, with Restore on the selection bar. */
export const AllSelected: Story = {
  render: () => <StoryApp path="/library/bin" person="per_ravi" scenario="binned" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole(
        'checkbox',
        { name: 'Select every fact in the Bin' },
        { timeout: 10_000 },
      ),
    )
    const bar = canvas.getByRole('region', { name: 'Selected rows' })
    await expect(within(bar).getByText('3 selected')).toBeVisible()
  },
}

export const RestoreDialog: Story = {
  render: () => <StoryApp path="/library/bin" person="per_ravi" scenario="binned" />,
  play: async ({ canvasElement }) => {
    const [first] = await within(canvasElement).findAllByRole(
      'button',
      { name: /^Restore / },
      { timeout: 10_000 },
    )
    await userEvent.click(first!)
    await expect(
      await screen.findByRole('alertdialog', { name: 'Restore this fact?' }),
    ).toBeVisible()
  },
}

/** A row's title opens the item to read before restoring it, with Restore on its banner. */
export const ItemInTheBin: Story = {
  render: () => <StoryApp path="/library/bin" person="per_ravi" scenario="binned" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = await canvas.findByRole('table', { name: 'Bin' }, { timeout: 10_000 })
    const [title] = within(table).getAllByRole('link')
    await userEvent.click(title!)
    await expect(
      await canvas.findByText("In the Bin. AI apps don't get it.", {}, { timeout: 10_000 }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Restore' })).toBeVisible()
  },
}

export const Phone: Story = {
  render: () => <StoryApp path="/library/bin" person="per_ravi" scenario="binned" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

/** Someone who is not an administrator opens the address: whose page it is, nothing of it read. */
export const NotAnAdministrator: Story = {
  render: () => <StoryApp path="/library/bin" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('The Bin is for admins', {}, { timeout: 10_000 }),
    ).toBeVisible()
  },
}
