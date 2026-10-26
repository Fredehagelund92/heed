import type * as Router from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type ClientPolicy } from '@/api'
import { isoMoment } from '@/api/http-api'
import { MOCK_PERSON_KEY, MOCK_SCENARIO_KEY } from '@/api/mock-scenario'
import { ClientEditor } from '@/components/gateway/client-editor'
import { ClientsTab } from '@/components/gateway/clients-tab'
import {
  answerSizeWords,
  clientFormSchema,
  clientToolsWords,
  clientValues,
  limitsWords,
  newClientValues,
  orderTools,
  parseWhole,
  rateWords,
  toolName,
  toolsOnWords,
  toolSwitchEffect,
  toSaveClientInput,
  type ClientFormValues,
} from '@/lib/gateway'
import { validateMcpSearch } from '@/lib/search-params'

// The clients tab links to Connect an agent; outside a router a link is a plain anchor.
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  Link: ({ to, children, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const client = (extra: Partial<ClientPolicy> = {}): ClientPolicy => ({
  label: 'claude-code',
  displayName: 'Claude Code',
  toolsAllowed: null,
  ratePerMinute: 120,
  maxResponseBytes: 100_000,
  enabled: true,
  ...extra,
})

describe('the tools in words', () => {
  it('names the tools it knows and keeps the name of one it does not', () => {
    expect(toolName('get_context')).toBe('Get context for a question')
    expect(toolName('report')).toBe('Tell the owner')
    // A tool that left the list keeps its id, as the request log still names it.
    expect(toolName('search_help')).toBe('search_help')
    expect(toolName('brand_new_tool')).toBe('brand_new_tool')
  })

  it('lists the reading tools first, then feedback, then any it does not know', () => {
    const tools = ['find_context', 'zzz_new', 'report', 'aaa_new', 'get_context']
    expect(orderTools(tools.map((tool) => ({ tool }))).map(({ tool }) => tool)).toEqual([
      'get_context',
      'find_context',
      'report',
      'aaa_new',
      'zzz_new',
    ])
  })

  it('counts the tools that are on', () => {
    const at = '2026-10-07T12:00:00.000Z'
    const tool = (name: string, enabled: boolean) => ({ tool: name, enabled, updatedAt: at })
    expect(toolsOnWords([tool('get_context', true), tool('get_related', false)])).toBe(
      '1 of 2 tools are on.',
    )
    expect(toolsOnWords([tool('get_context', true)])).toBe('The tool is on.')
    expect(toolsOnWords([])).toBe('There are no tools yet.')
  })

  it('says which switched-on clients a tool switch reaches', () => {
    const clients = [
      client(),
      client({ label: 'cursor', displayName: 'Cursor', toolsAllowed: ['read_context'] }),
      client({ label: 'eval', displayName: 'Evaluation runner' }),
      client({ label: 'old', displayName: 'Old bot', enabled: false }),
    ]
    expect(toolSwitchEffect('get_context', false, clients)).toBe(
      'Claude Code and Evaluation runner stop using it from the next call. It stays off for every agent until you switch it on again.',
    )
    expect(toolSwitchEffect('read_context', true, clients)).toBe(
      'Claude Code, Cursor and Evaluation runner can use it from the next call.',
    )
    expect(toolSwitchEffect('get_context', true, [client({ enabled: false })])).toBe(
      'None of the agents that are on allow it yet. Allow it for one on the agents tab.',
    )
    expect(toolSwitchEffect('get_context', false, undefined)).toBe(
      'Every agent stops using it from its next call.',
    )
  })
})

describe('a client in words', () => {
  it('says which tools a client may call', () => {
    expect(clientToolsWords(client())).toBe('Every tool that is on')
    expect(clientToolsWords(client({ toolsAllowed: ['find_context', 'get_context'] }))).toBe(
      'Get context for a question, Find context',
    )
    expect(clientToolsWords(client({ toolsAllowed: [] }))).toBe('No tools')
  })

  it("shows the gateway's default when a client has no limit of its own", () => {
    expect(rateWords(client())).toBe('120')
    expect(rateWords(client({ ratePerMinute: 2_500 }))).toBe('2,500')
    expect(rateWords(client({ ratePerMinute: null }))).toBe('Default (120)')
    expect(answerSizeWords(client({ maxResponseBytes: 2_500 }))).toBe('2.5 KB')
    expect(answerSizeWords(client({ maxResponseBytes: null }))).toBe('Default (100 KB)')
    expect(limitsWords(client())).toBe('120 a minute, answers up to 100 KB')
    expect(limitsWords(client({ ratePerMinute: null, maxResponseBytes: null }))).toBe(
      '120 a minute (default), answers up to 100 KB (default)',
    )
  })
})

describe('the client form', () => {
  const schema = (isNew = true) => clientFormSchema({ isNew, takenLabels: ['claude-code'] })
  const problems = (values: Partial<ClientFormValues>, isNew = true) => {
    const result = schema(isNew).safeParse({ ...newClientValues, ...values })
    return Object.fromEntries(
      (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]),
    )
  }
  const filled = { displayName: 'Support bot', label: 'support-bot', reason: 'A trial' }

  it('accepts a new client with a name, a free label and a reason', () => {
    expect(problems(filled)).toEqual({})
  })

  it('asks for what is missing, in plain words', () => {
    expect(problems({})).toEqual({
      label: 'Give the agent a label.',
      displayName: 'Give the agent a name.',
      reason: 'Give a reason.',
    })
  })

  it("takes a label of the token's form that no client has", () => {
    expect(problems({ ...filled, label: 'Support Bot' })).toEqual({
      label: 'Use 1 to 40 lowercase letters, digits, dots, dashes or underscores.',
    })
    expect(problems({ ...filled, label: 'x'.repeat(41) })).toHaveProperty('label')
    expect(problems({ ...filled, label: 'claude-code' })).toEqual({
      label: 'Another agent has this label. Edit that one in the list instead.',
    })
    // An existing client keeps its label, so it is not checked again.
    expect(problems({ ...filled, label: 'claude-code' }, false)).toEqual({})
  })

  it('refuses a new client while the labels in use are not known', () => {
    const result = clientFormSchema({ isNew: true, takenLabels: null }).safeParse({
      ...newClientValues,
      ...filled,
    })
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "We couldn't load the agents, so we can't check the label is free. Try again.",
    ])
    expect(
      clientFormSchema({ isNew: false, takenLabels: null }).safeParse({
        ...newClientValues,
        ...filled,
      }).success,
    ).toBe(true)
  })

  it('checks the limits as whole numbers in range, or empty', () => {
    expect(problems({ ...filled, ratePerMinute: '1,000', maxResponseBytes: '100 000' })).toEqual({})
    expect(problems({ ...filled, ratePerMinute: '1.5', maxResponseBytes: 'lots' })).toEqual({
      ratePerMinute: 'Enter a whole number of requests, or leave it empty.',
      maxResponseBytes: 'Enter a whole number of bytes, or leave it empty.',
    })
    expect(problems({ ...filled, ratePerMinute: '0', maxResponseBytes: '999' })).toEqual({
      ratePerMinute: 'Use 1 to 10,000 requests a minute.',
      maxResponseBytes: 'Use 1,000 to 100,000 bytes.',
    })
    expect(problems({ ...filled, ratePerMinute: '10001', maxResponseBytes: '100001' })).toEqual({
      ratePerMinute: 'Use 1 to 10,000 requests a minute.',
      maxResponseBytes: 'Use 1,000 to 100,000 bytes.',
    })
  })

  it('needs at least one chosen tool when not every tool is allowed', () => {
    expect(problems({ ...filled, tools: 'chosen', chosen: [] })).toEqual({
      chosen: 'Choose at least one tool, or allow every tool that is on.',
    })
    expect(problems({ ...filled, tools: 'all', chosen: [] })).toEqual({})
    // Shown with the other problems, not only once they are fixed.
    expect(problems({ tools: 'chosen', chosen: [] })).toHaveProperty(
      'chosen',
      'Choose at least one tool, or allow every tool that is on.',
    )
  })

  it('keeps a reason to 500 characters', () => {
    expect(problems({ ...filled, reason: 'x'.repeat(501) })).toEqual({
      reason: 'Shorten it by 1 character.',
    })
  })

  it('reads whole numbers with thousands separators', () => {
    expect(parseWhole('')).toBeNull()
    expect(parseWhole(' 1,000 ')).toBe(1000)
    expect(parseWhole('-5')).toBeNaN()
  })

  it("turns a client's policy into the form and back", () => {
    const cursor = client({
      label: 'cursor',
      displayName: 'Cursor',
      toolsAllowed: ['read_context', 'get_context'],
      ratePerMinute: null,
      maxResponseBytes: 2_500,
      enabled: false,
    })
    const values = clientValues(cursor)
    expect(values).toMatchObject({ tools: 'chosen', ratePerMinute: '', maxResponseBytes: '2500' })
    expect(toSaveClientInput({ ...values, reason: '  Paused for now  ' })).toEqual({
      label: 'cursor',
      displayName: 'Cursor',
      toolsAllowed: ['get_context', 'read_context'],
      ratePerMinute: null,
      maxResponseBytes: 2_500,
      enabled: false,
      reason: 'Paused for now',
    })
    expect(toSaveClientInput({ ...clientValues(client()), reason: 'x' }).toolsAllowed).toBeNull()
  })
})

describe('the address of the page', () => {
  it('keeps a known tab and drops anything else', () => {
    expect(validateMcpSearch({ tab: 'tools' })).toEqual({ tab: 'tools' })
    expect(validateMcpSearch({ tab: 'traffic' })).toEqual({ tab: undefined })
  })
})

describe('moments from the service', () => {
  it("reads PostgreSQL's text form as an ISO moment", () => {
    expect(isoMoment('2026-10-09 05:50:46.123456+00')).toBe('2026-10-09T05:50:46.123Z')
    expect(isoMoment('2026-10-09 07:50:46+05:30')).toBe('2026-10-09T02:20:46.000Z')
    expect(isoMoment('2026-10-07T12:00:00.000Z')).toBe('2026-10-07T12:00:00.000Z')
  })
})

// The whole form renders against the mock in jsdom: slower than a unit test on a busy machine.
describe('the client editor', { timeout: 15_000 }, () => {
  beforeEach(() => window.localStorage.setItem(MOCK_PERSON_KEY, 'per_ravi'))
  afterEach(() => window.localStorage.removeItem(MOCK_PERSON_KEY))

  function renderEditor(props: Partial<Parameters<typeof ClientEditor>[0]> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <ClientEditor
          client={null}
          takenLabels={['claude-code', 'cursor', 'eval']}
          open
          onOpenChange={onOpenChange}
          {...props}
        />
      </QueryClientProvider>,
    )
    return { onOpenChange }
  }

  it('lists every problem of an empty new client and moves focus to the list', async () => {
    const user = userEvent.setup()
    renderEditor()
    const dialog = await screen.findByRole('dialog', { name: 'Add an agent' })
    await user.click(within(dialog).getByRole('button', { name: 'Add agent' }))
    const summary = await within(dialog).findByRole('alert')
    expect(summary).toHaveTextContent('Fix these 3 problems first')
    expect(summary).toHaveFocus()
    expect(within(dialog).getByRole('textbox', { name: 'Label' })).toHaveAccessibleDescription(
      expect.stringContaining('Give the agent a label.'),
    )
  })

  it("changes a client's tools and limit, and keeps its label", async () => {
    const user = userEvent.setup()
    const cursor = (await api.listClients()).find((entry) => entry.label === 'cursor')!
    const { onOpenChange } = renderEditor({ client: cursor })
    const dialog = await screen.findByRole('dialog', { name: 'Edit Cursor' })
    expect(within(dialog).queryByRole('textbox', { name: 'Label' })).toBeNull()
    expect(dialog).toHaveTextContent('cursor')
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Tell the owner' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Allowed to connect' }))
    const rate = within(dialog).getByRole('textbox', { name: /Requests a minute/ })
    await user.clear(rate)
    await user.type(rate, '90')
    await user.click(within(dialog).getByRole('textbox', { name: 'Why' }))
    await user.paste('Trial with the team')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect((await api.listClients()).find((entry) => entry.label === 'cursor')).toEqual({
      label: 'cursor',
      displayName: 'Cursor',
      toolsAllowed: ['find_context', 'get_context', 'read_context', 'report'],
      ratePerMinute: 90,
      maxResponseBytes: null,
      enabled: true,
    })
  })

  it('lists the tools it knows, without saying which are on, when the list fails', async () => {
    const cursor = (await api.listClients()).find((entry) => entry.label === 'cursor')!
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'error')
    try {
      renderEditor({ client: cursor })
      const dialog = await screen.findByRole('dialog', { name: 'Edit Cursor' })
      await waitFor(() =>
        expect(within(dialog).queryByRole('status', { name: 'Loading the tools' })).toBeNull(),
      )
      expect(
        within(dialog).getByRole('checkbox', { name: 'Get context for a question' }),
      ).toBeChecked()
      expect(within(dialog).getByRole('checkbox', { name: 'Follow links' })).not.toBeChecked()
      expect(dialog).not.toHaveTextContent('Off for every agent now.')
    } finally {
      window.localStorage.removeItem(MOCK_SCENARIO_KEY)
    }
  })

  it('refuses to add a client while the labels in use are not known', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderEditor({ takenLabels: null })
    const dialog = await screen.findByRole('dialog', { name: 'Add an agent' })
    await user.click(within(dialog).getByRole('textbox', { name: 'Name' }))
    await user.paste('Cursor again')
    await user.click(within(dialog).getByRole('textbox', { name: 'Label' }))
    await user.paste('cursor')
    await user.click(within(dialog).getByRole('textbox', { name: 'Why' }))
    await user.paste('A trial')
    await user.click(within(dialog).getByRole('button', { name: 'Add agent' }))
    expect(await within(dialog).findByText(/we can't check the label is free/)).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((await api.listClients()).find((entry) => entry.label === 'cursor')?.displayName).toBe(
      'Cursor',
    )
  })

  it("keeps the form open with the service's answer when it refuses", async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderEditor()
    const dialog = await screen.findByRole('dialog', { name: 'Add an agent' })
    await user.click(within(dialog).getByRole('textbox', { name: 'Name' }))
    await user.paste('Support bot')
    await user.click(within(dialog).getByRole('textbox', { name: 'Label' }))
    await user.paste('support-bot')
    await user.click(within(dialog).getByRole('textbox', { name: 'Why' }))
    await user.paste('Asked by anna@example.test')
    await user.click(within(dialog).getByRole('button', { name: 'Add agent' }))
    expect(await within(dialog).findByText("The agent wasn't saved")).toBeVisible()
    expect(dialog).toHaveTextContent(
      'Remove the email address, phone number or secret from the reason.',
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Support bot')
  })
})

describe('adding a client from the clients tab', { timeout: 15_000 }, () => {
  beforeEach(() => {
    window.localStorage.setItem(MOCK_PERSON_KEY, 'per_ravi')
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.removeItem(MOCK_PERSON_KEY)
    window.localStorage.removeItem(MOCK_SCENARIO_KEY)
  })

  function renderTab() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ClientsTab />
      </QueryClientProvider>,
    )
  }

  it('is blocked with its reason while the clients load, then opens once they are in', async () => {
    const user = userEvent.setup()
    renderTab()
    const blocked = screen.getByRole('button', { name: 'Add an agent' })
    expect(blocked).toHaveAttribute('aria-disabled', 'true')
    expect(blocked).toHaveAccessibleDescription(/still loading/)
    await user.click(blocked)
    expect(screen.queryByRole('dialog', { name: 'Add an agent' })).toBeNull()
    await screen.findByRole('list', { name: 'Agents' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add an agent' })).not.toHaveAttribute(
        'aria-disabled',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Add an agent' }))
    expect(await screen.findByRole('dialog', { name: 'Add an agent' })).toBeVisible()
  })

  it('stays blocked, saying why, when the clients cannot be read', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'error')
    renderTab()
    expect(
      await screen.findByText("We couldn't load the agents", {}, { timeout: 5000 }),
    ).toBeVisible()
    const blocked = screen.getByRole('button', { name: 'Add an agent' })
    expect(blocked).toHaveAttribute('aria-disabled', 'true')
    expect(blocked).toHaveAccessibleDescription(/couldn't load the agents/)
    await user.click(blocked)
    expect(screen.queryByRole('dialog', { name: 'Add an agent' })).toBeNull()
  })
})
