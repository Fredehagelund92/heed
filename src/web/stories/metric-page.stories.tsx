import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * A metric of the catalogue (FR-136, design contract 5, the term page) in the real shell: the
 * note line header with the read chip, the On the shelf card and the Overview, Context and
 * Source tabs, in every state it has. Use the viewport menu for 1440, 1024 and 390 and the theme
 * menu for dark.
 */
const meta = {
  title: 'Catalogue/Metric page',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Orders: an active issue about it, so the note line says what agents do. */
export const ActiveIssue: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders" />,
}

export const ContextTab: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders?tab=context" />,
}

/**
 * Under the context, the items that only mention Orders: a quiet list, closed until asked
 * for, that says a mention is not what an item is about (FR-131).
 */
export const ContextTabAlsoMentioned: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders?tab=context" />,
  play: async () => {
    const trigger = await screen.findByRole('button', { name: /^Also mentioned/ })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await expect(
      await screen.findByRole('list', { name: 'Facts that mention Orders' }),
    ).toBeVisible()
  },
}

export const SourceTab: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders?tab=source" />,
}

/** Cube changed the definition after Heed first read it. */
export const ChangedInCube: Story = {
  render: () => <StoryApp path="/catalogue/metric/retention_rate?tab=source" />,
}

/** The newest read of Cube no longer lists Gross margin: the page keeps the last copy. */
export const GoneFromCube: Story = {
  render: () => <StoryApp path="/catalogue/metric/gross_margin" scenario="definition-gone" />,
}

/** No domain and no description in Cube. */
export const NoDescription: Story = {
  render: () => <StoryApp path="/catalogue/metric/verification_pass_rate" />,
}

/** The newest read of Cube failed: the read chip turns amber and the Source row says so. */
export const SourceDown: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders?tab=source" scenario="source-down" />,
}

export const NotFound: Story = {
  render: () => <StoryApp path="/catalogue/metric/no_such_metric" />,
}

export const LoadFailed: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders" scenario="error" />,
}

export const Loading: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders" scenario="slow" />,
}

export const Phone: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

export const PhoneContextTab: Story = {
  render: () => <StoryApp path="/catalogue/metric/orders?tab=context" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}
