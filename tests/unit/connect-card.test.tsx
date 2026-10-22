import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type Connection } from '@/api'
import { MOCK_SCENARIO_KEY } from '@/api/mock-scenario'
import { ConnectCard } from '@/components/connect/connect-card'
import { productName } from '@/lib/brand'
import {
  askHeedFirst,
  promptText,
  setupPromptFor,
  skillFor,
  skillPlaces,
  snippetFor,
  statusRules,
  TOKEN_PLACEHOLDER,
} from '@/lib/connect'
import { instructionRules, serverInstructions } from '../../src/server/mcp/tools.ts'

/*
  Connect an agent in one step (D9): the setup prompt with the Ask first line built in, the Heed
  skill, and the card's live state from the person's connected apps.
*/

const address = 'http://localhost:3000/mcp'
const claude = { label: 'claude-code', name: 'Claude Code' }
const vscode = { label: 'vscode', name: 'VS Code' }
const cursor = { label: 'cursor', name: 'Cursor' }

afterEach(() => {
  window.localStorage.removeItem(MOCK_SCENARIO_KEY)
  vi.restoreAllMocks()
})

describe('the setup prompt', () => {
  it('has the app add Heed, write the Ask first line and say how to sign in', () => {
    const parts = setupPromptFor(claude, address, 'sign-in')
    const text = promptText(parts)
    expect(parts.filter((part) => part.kind === 'code').map((part) => part.text)).toEqual([
      snippetFor('claude-code', address, 'sign-in').code,
      askHeedFirst[0].text,
    ])
    expect(text).toContain('Run this in a terminal:')
    expect(text).toContain('Add this line to CLAUDE.md in this project')
    expect(text).toContain('run /mcp, choose heed and then Authenticate')
    expect(text).not.toContain(TOKEN_PLACEHOLDER)
  })

  it("names another app's settings file and the shared instructions file", () => {
    const text = promptText(setupPromptFor(cursor, address, 'sign-in'))
    expect(text).toContain('Add this to .cursor/mcp.json:')
    expect(text).toContain('Add this line to AGENTS.md in this project')
    expect(text).toContain(`sign in to ${productName} in the browser when Cursor asks`)
  })

  it('leaves the token to the person, so it never goes into the conversation', () => {
    const text = promptText(setupPromptFor(claude, address, 'token'))
    expect(text).toContain(
      `Tell me to run this in a terminal, with the access key the data team gave me in place of ${TOKEN_PLACEHOLDER}:`,
    )
    expect(text).not.toContain('Run this in a terminal:')
  })

  it('promises no call, as the Ask first lines do not', () => {
    for (const auth of ['sign-in', 'token'] as const)
      expect(promptText(setupPromptFor(claude, address, auth))).not.toMatch(
        /\b(always|guarantee|every time|ensures?)\b/i,
      )
  })
})

describe('the Heed skill', () => {
  const skill = skillFor(address, 'sign-in')

  it('is an Agent Skills file named heed, with a description that says when to use it', () => {
    const [, front] = skill.split('---\n')
    expect(front).toMatch(/^name: heed$/m)
    expect(front).toMatch(/^description: Ask .+ before you answer a question about company data/m)
  })

  it("reads the statuses word for word as the MCP server's instructions say them", () => {
    const instructions = serverInstructions([])
    for (const rule of statusRules) {
      expect(skill).toContain(`- ${rule.status}: ${rule.text}`)
      expect(instructions).toContain(`${rule.status}: ${rule.text}`)
    }
    // The absence rule is the server's own sentence.
    const absence = instructionRules.slice(instructionRules.indexOf('no_match does not prove'))
    expect(skill).toContain(absence)
    expect(skill).toContain(askHeedFirst[0].text)
  })

  it("gives each app's setup with this install's address, and where to save it", () => {
    expect(skill).toContain(`claude mcp add --transport http heed ${address}`)
    expect(skill).toContain(`codex mcp add heed --url ${address}`)
    expect(skill).toContain(snippetFor('cursor', address, 'sign-in').code)
    for (const place of skillPlaces) expect(skill).toContain(place.path)
  })

  it('with a token, says where the token goes and never has the agent sign in', () => {
    const token = skillFor(address, 'token')
    expect(token).toContain(`Bearer ${TOKEN_PLACEHOLDER}`)
    expect(token).toContain('bearer_token_env_var = "HEED_TOKEN"')
    expect(token).not.toContain('codex mcp login')
    expect(token).not.toContain('Authenticate')
  })
})

function withQueries(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const connection: Connection = {
  id: '0199a6c4-2f00-7000-8000-00000000d00d',
  clientName: 'Claude Code',
  clientHost: '127.0.0.1',
  scopes: ['read', 'feedback'],
  connectedAt: '2026-10-07T09:31:00.000Z',
  lastUsedAt: '2026-10-07T09:31:00.000Z',
  expiresAt: '2026-10-14T09:31:00.000Z',
}

describe('the connect card', () => {
  it(
    'names the app connected as the person, and when it was last used',
    { timeout: 20_000 },
    async () => {
      render(withQueries(<ConnectCard address={address} clients={[cursor]} signIn />))
      // The first call to the mock loads it whole, which takes a few seconds on a busy machine.
      expect(await screen.findByText('Connected', {}, { timeout: 15_000 })).toBeVisible()
      expect(await screen.findByText(/Cursor is connected as you, last used/)).toBeVisible()
      expect(screen.getByRole('heading', { name: 'Connect Cursor in one paste' })).toBeVisible()
      expect(
        screen.getByText(/runs on this computer at http:\/\/localhost:3000\/mcp/),
      ).toBeVisible()
    },
  )

  it(
    'waits for a sign-in after a copy, and turns to Connected when the app has signed in',
    {
      timeout: 15_000,
    },
    async () => {
      const user = userEvent.setup()
      vi.spyOn(api, 'listConnections').mockResolvedValueOnce([]).mockResolvedValue([connection])
      render(withQueries(<ConnectCard address={address} clients={[claude]} signIn />))
      expect(await screen.findByText('Not connected yet')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Copy prompt for Claude Code' }))
      expect(await navigator.clipboard.readText()).toBe(
        promptText(setupPromptFor(claude, address, 'sign-in')),
      )
      expect(await screen.findByText(/Waiting for Claude Code to sign in/)).toBeVisible()
      await waitFor(() => expect(screen.getByText('Connected')).toBeVisible(), { timeout: 10_000 })
      expect(screen.getByText(/Claude Code is connected as you/)).toBeVisible()
    },
  )

  it(
    'is not connected for a second app until that app signs in, and waits for it after a copy',
    { timeout: 15_000 },
    async () => {
      const user = userEvent.setup()
      const list = vi.spyOn(api, 'listConnections').mockResolvedValue([connection])
      render(withQueries(<ConnectCard address={address} clients={[claude, cursor]} signIn />))
      expect(await screen.findByText('Connected')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Cursor' }))
      expect(await screen.findByText('Not connected yet')).toBeVisible()
      expect(screen.queryByText('Connected')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Copy prompt for Cursor' }))
      expect(await screen.findByText(/Waiting for Cursor to sign in/)).toBeVisible()
      const before = list.mock.calls.length
      await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before), {
        timeout: 6_000,
      })
      expect(screen.getByText('Not connected yet')).toBeVisible()
    },
  )

  it(
    'counts the name an app reports for itself when it signs in',
    { timeout: 15_000 },
    async () => {
      vi.spyOn(api, 'listConnections')
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ ...connection, id: 'vs', clientName: 'Visual Studio Code' }])
      render(withQueries(<ConnectCard address={address} clients={[vscode]} signIn />))
      expect(await screen.findByText('Not connected yet')).toBeVisible()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Copy prompt for VS Code' }))
      await waitFor(() => expect(screen.getByText('Connected')).toBeVisible(), { timeout: 10_000 })
      expect(screen.getByText(/Visual Studio Code is connected as you/)).toBeVisible()
    },
  )

  it(
    'does not claim the picked app for a new sign-in under another name, and stops waiting',
    { timeout: 15_000 },
    async () => {
      const list = vi
        .spyOn(api, 'listConnections')
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ ...connection, id: 'desk', clientName: 'Claude Desktop' }])
      render(withQueries(<ConnectCard address={address} clients={[claude]} signIn />))
      expect(await screen.findByText('Not connected yet')).toBeVisible()
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'Copy prompt for Claude Code' }))
      expect(
        await screen.findByText(
          /An agent just signed in: Claude Desktop\. If that wasn't Claude Code/,
          {},
          { timeout: 10_000 },
        ),
      ).toBeVisible()
      expect(screen.queryByText('Connected')).toBeNull()
      const calls = list.mock.calls.length
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      expect(list.mock.calls.length).toBe(calls)
    },
  )

  it('says that an agent with an access key does not show, and reads no connections', async () => {
    const list = vi.spyOn(api, 'listConnections')
    render(
      withQueries(
        <ConnectCard address="https://heed.example.test/mcp" clients={[claude]} signIn={false} />,
      ),
    )
    expect(
      await screen.findByText(/An agent that connects with an access key doesn't show here/),
    ).toBeVisible()
    expect(screen.queryByText('Connected')).toBeNull()
    expect(screen.queryByText(/runs on this computer/)).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })

  it('offers each app switched on, and the prompt follows the one picked', async () => {
    const user = userEvent.setup()
    render(withQueries(<ConnectCard address={address} clients={[claude, cursor]} signIn />))
    await user.click(screen.getByRole('button', { name: 'Cursor' }))
    expect(screen.getByRole('heading', { name: 'Connect Cursor in one paste' })).toBeVisible()
    expect(screen.getByRole('figure', { name: 'Paste this into Cursor' })).toHaveTextContent(
      '.cursor/mcp.json',
    )
  })

  it('downloads the skill as SKILL.md', async () => {
    const user = userEvent.setup()
    const create = vi.fn(() => 'blob:skill')
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(withQueries(<ConnectCard address={address} clients={[claude]} signIn />))
    await user.click(screen.getByRole('button', { name: 'Download SKILL.md' }))
    expect(click).toHaveBeenCalledOnce()
    const anchor = click.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('SKILL.md')
    const [blob] = create.mock.calls[0] as unknown as [Blob]
    expect(await blob.text()).toBe(skillFor(address, 'sign-in'))
  })
})
