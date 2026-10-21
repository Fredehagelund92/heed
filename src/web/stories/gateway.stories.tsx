import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { StoryApp } from './story-app'

/**
 * MCP and gateway (slice W11a of the front end plan), a section of Administration, in the real
 * shell with the mock: the clients that may connect and their editor, the tool switch with its
 * reason, the traffic by client and tool, and what anyone but an administrator sees. Ravi Kapoor
 * is the administrator; Maria Lindqvist is a contributor.
 */
const meta = {
  title: 'Administration/MCP and gateway',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const admin = 'per_ravi'
const phone = { viewport: { value: 'phone', isRotated: false } }

/**
 * The clients as the bordered grid: tools, rate, answer size and whether each may connect. A row
 * governs the tokens that carry its label, so Claude Code's row is named for its token, and the
 * tab says which row governs the apps people sign in with.
 */
export const Clients: Story = {
  render: () => <StoryApp path="/admin?section=gateway" person={admin} />,
  play: async () => {
    const grid = await screen.findByRole('table', { name: 'Agents' }, { timeout: 10_000 })
    await expect(
      within(grid).getByRole('button', { name: 'Edit Claude Code with a token' }),
    ).toBeVisible()
    await expect(
      screen.getByText(/Every agent a person connects by signing in to .+, Claude Code included/),
    ).toHaveTextContent(
      'carries the label signed-in, so that one row governs them all; each person disconnects their own agents in Connect an agent.',
    )
  },
}

/** Every tool with its switch; Get related ships switched off. */
export const Tools: Story = {
  render: () => <StoryApp path="/admin?section=gateway&tab=tools" person={admin} />,
}

/** The traffic by client and tool over the last week, from the request log. */
export const Activity: Story = {
  render: () => <StoryApp path="/admin?section=gateway&tab=activity" person={admin} />,
}

/** While the clients load: skeleton rows of the row height. */
export const Loading: Story = {
  render: () => <StoryApp path="/admin?section=gateway" person={admin} scenario="slow" />,
}

/** The clients did not load: what failed, and Try again. */
export const ClientsError: Story = {
  render: () => <StoryApp path="/admin?section=gateway" person={admin} scenario="error" />,
}

/** The tools did not load. */
export const ToolsError: Story = {
  render: () => (
    <StoryApp path="/admin?section=gateway&tab=tools" person={admin} scenario="error" />
  ),
}

/** A contributor is told whose place Administration is; nothing is read. */
export const Contributor: Story = { render: () => <StoryApp path="/admin?section=gateway" /> }

/** On a phone the clients are a list, each with its facts under the name. */
export const PhoneClients: Story = {
  globals: phone,
  render: () => <StoryApp path="/admin?section=gateway" person={admin} />,
}

export const PhoneTools: Story = {
  globals: phone,
  render: () => <StoryApp path="/admin?section=gateway&tab=tools" person={admin} />,
}

/** Editing a client: its label is fixed, its tools, limits and switch change with a reason. */
export const EditClient: Story = {
  render: () => <StoryApp path="/admin?section=gateway" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit Cursor' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Edit Cursor' })
    await expect(
      within(dialog).getByRole('radio', { name: 'Only the tools chosen below' }),
    ).toBeChecked()
    await expect(within(dialog).getByRole('checkbox', { name: 'Get facts' })).toBeChecked()
  },
}

/** Adding a client with nothing filled in: the summary lists what is missing and takes focus. */
export const AddClientErrors: Story = {
  render: () => <StoryApp path="/admin?section=gateway" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add an agent' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Add an agent' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add agent' }))
    const summary = await within(dialog).findByRole('alert')
    await expect(summary).toHaveTextContent('Fix these 3 problems first')
    await waitFor(() => expect(summary).toHaveFocus())
  },
}

/** Switching a tool off: which clients it reaches, and why, before anything changes. */
export const SwitchToolOff: Story = {
  render: () => <StoryApp path="/admin?section=gateway&tab=tools" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Get facts' }, { timeout: 10_000 }),
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Switch off Get facts?' })
    await expect(dialog).toHaveTextContent(
      'Claude Code with a token and Evaluation runner stop using it from the next call.',
    )
  },
}

/**
 * Every person's agents (security check F3): the person, the app as it names itself and where it
 * came from, what it may do, when it connected and ends, and when it was last used, newest first.
 */
export const Connections: Story = {
  render: () => <StoryApp path="/admin?section=gateway&tab=connections" person={admin} />,
  play: async () => {
    const grid = await screen.findByRole(
      'table',
      { name: 'Agents people connected' },
      { timeout: 10_000 },
    )
    await expect(within(grid).getByRole('columnheader', { name: /Last used/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    await expect(
      within(grid).getByRole('button', { name: 'Disconnect Cursor for Maria Lindqvist' }),
    ).toBeVisible()
  },
}

/**
 * Disconnecting one of a person's two apps: the dialog offers all of them, and asks why, with the
 * common reasons as chips.
 */
export const DisconnectApp: Story = {
  render: () => <StoryApp path="/admin?section=gateway&tab=connections" person={admin} />,
  play: async () => {
    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Disconnect Claude Code for Jon Abara' },
        { timeout: 10_000 },
      ),
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Disconnect Claude Code for Jon Abara?',
    })
    await expect(within(dialog).getByRole('radio', { name: /Only Claude Code/ })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await expect(dialog).toHaveTextContent('Give a reason.')
  },
}

/** Nobody has connected an agent yet. */
export const ConnectionsEmpty: Story = {
  render: () => (
    <StoryApp path="/admin?section=gateway&tab=connections" person={admin} scenario="empty" />
  ),
}

/** The connections did not load: what failed, and Try again. */
export const ConnectionsError: Story = {
  render: () => (
    <StoryApp path="/admin?section=gateway&tab=connections" person={admin} scenario="error" />
  ),
}

/** On a phone each connection is a row of a list, and a select sorts them. */
export const PhoneConnections: Story = {
  globals: phone,
  render: () => <StoryApp path="/admin?section=gateway&tab=connections" person={admin} />,
}
