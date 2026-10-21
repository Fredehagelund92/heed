import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * A person's own Settings (navigation decision, 12 October 2026) in the real shell with the mock:
 * Profile and appearance, and Connect an agent with the agents connected as them, opened from the
 * user menu. Maria Lindqvist is a contributor and Ravi Kapoor an administrator, who also gets the
 * way to MCP and gateway.
 */
const meta = {
  title: 'Settings/Settings',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Who they are and the appearance, opened from the user menu. */
export const Profile: Story = {
  render: () => <StoryApp path="/" />,
  play: async () => {
    const sidebar = await screen.findByRole('navigation', { name: 'Main navigation' })
    await userEvent.click(await within(sidebar).findByRole('button', { name: /Maria Lindqvist/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Profile and appearance/ }))
    await expect(await screen.findByRole('heading', { name: 'You' })).toBeVisible()
  },
}

/** Connect an agent: the address, a setup per client, the tools and the connected agents. */
export const ConnectYourAI: Story = {
  render: () => <StoryApp path="/settings?section=connect" />,
  play: async () => {
    await expect(await screen.findByText('Sign in from your agent')).toBeVisible()
    await expect(screen.getByLabelText('the setup for Claude Code')).toBeVisible()
    // Every tool is listed, the ones switched off marked Off.
    const tools = screen.getByRole('list', { name: 'The tools an agent gets' })
    await expect(within(tools).getByText('Save a draft')).toBeVisible()
    await expect(within(tools).getAllByText('Off')).toHaveLength(2)
    // The lines that make a client more likely to ask Heed first, each to copy.
    await expect(screen.getByRole('heading', { name: 'Ask first' })).toBeVisible()
    await expect(screen.getByLabelText('the line for CLAUDE.md or AGENTS.md')).toBeVisible()
    await expect(
      screen.getByRole('button', { name: "Copy the line for a data tool's instructions" }),
    ).toBeVisible()
  },
}

/** An administrator also gets the way to MCP and gateway, and to its Tools for a tool off. */
export const ConnectAsAnAdministrator: Story = {
  render: () => <StoryApp path="/settings?section=connect" person="per_ravi" />,
  play: async () => {
    await expect(await screen.findByRole('link', { name: 'MCP and gateway' })).toBeVisible()
    await expect(
      screen.getAllByRole('link', { name: 'MCP and gateway, under Tools' }),
    ).toHaveLength(2)
  },
}

export const ConnectFailed: Story = {
  render: () => <StoryApp path="/settings?section=connect" scenario="error" />,
  play: async () => {
    await expect(
      await screen.findByText("We couldn't load how to connect", {}, { timeout: 5000 }),
    ).toBeVisible()
  },
}

/** On a phone the sections are one menu. */
export const ConnectPhone: Story = {
  render: () => <StoryApp path="/settings?section=connect" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async () => {
    await expect(await screen.findByLabelText('the setup for Claude Code')).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Section: Connect an agent' })).toBeVisible()
  },
}
