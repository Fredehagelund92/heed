import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import { expect, screen, within } from 'storybook/test'
import { createQueryClient } from '@/api/query-client'
import { ConnectCard } from '@/components/connect/connect-card'
import { StoryApp } from './story-app'

/*
  Connect an AI app in one step (D9): the card at the top of Connect an AI app. The prompt to paste
  with the Ask first line built in, the live state from the person's connected apps, and the Heed
  skill to download. In the page on the mock (connected, and with no app connected), and on its
  own for an install where apps connect with a token, several apps switched on and a long name.
  Use the viewport menu for 1440, 1024 and 390 and the theme menu for light and dark.
*/

const meta = {
  title: 'Settings/Connect card',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const claude = { label: 'claude-code', name: 'Claude Code' }

function Alone(props: ComponentProps<typeof ConnectCard>) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <div className="max-w-reading p-6">
        <ConnectCard {...props} />
      </div>
    </QueryClientProvider>
  )
}

/** An app of the person's is connected: the card says which, and when it was last used. */
export const Connected: Story = {
  render: () => <StoryApp path="/settings?section=connect" />,
  play: async () => {
    const card = await screen.findByRole('region', { name: 'Connect Claude Code in one paste' })
    await expect(await within(card).findByText('Connected')).toBeVisible()
    await expect(within(card).getByText(/Cursor is connected as you/)).toBeVisible()
    await expect(within(card).getByRole('button', { name: 'Download SKILL.md' })).toBeVisible()
  },
}

/** No app is connected yet: after the paste, the person signs in from the app. */
export const NotConnected: Story = {
  render: () => <StoryApp path="/settings?section=connect" scenario="empty" />,
  play: async () => {
    const card = await screen.findByRole('region', { name: 'Connect Claude Code in one paste' })
    await expect(await within(card).findByText('Not connected yet')).toBeVisible()
    await expect(
      within(card).getByRole('button', { name: 'Copy prompt for Claude Code' }),
    ).toBeVisible()
  },
}

/** Apps connect with a token: the person runs the setup, and Heed cannot see who connected. */
export const WithAToken: Story = {
  render: () => <Alone address="https://heed.example.test/mcp" clients={[claude]} signIn={false} />,
  play: async () => {
    await expect(
      await screen.findByText(/An app that connects with a token does not show here/),
    ).toBeVisible()
  },
}

/** Several apps switched on: a choice of app, and the prompt follows it. */
export const SeveralApps: Story = {
  render: () => (
    <Alone
      address="http://localhost:3000/mcp"
      clients={[claude, { label: 'cursor', name: 'Cursor' }, { label: 'vscode', name: 'VS Code' }]}
      signIn
    />
  ),
}

/** An app with a long name, as an administrator named it. */
export const LongName: Story = {
  render: () => (
    <Alone
      address="https://heed.internal.example-company-with-a-long-domain.test/mcp"
      clients={[
        { label: 'support-bot', name: 'Customer support assistant for the Nordic markets' },
      ]}
      signIn
    />
  ),
}
