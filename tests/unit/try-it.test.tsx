import { readFileSync } from 'node:fs'
import type * as Router from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, type TryIt } from '@/api'
import { MOCK_PERSON_KEY, MOCK_SCENARIO_KEY } from '@/api/mock-scenario'
import { ConnectSection } from '@/components/settings/connect-section'
import type { FactPanelState } from '@/components/try-it/fact-panel'
import { TryItView } from '@/components/try-it/try-it-view'
import { namedKeys } from '@/lib/agent-reply'
import { formValues, withScope } from '@/lib/context-form'
import { withProductName } from '@domain/brand'
import { productName } from '@/lib/brand'
import {
  appNameFor,
  askHeedFirst,
  snippetFor,
  TOKEN_PLACEHOLDER,
  toolsInWords,
} from '@/lib/connect'
import { toolInfo } from '@/lib/gateway'
import { validateContextSearch, validateTryItSearch } from '@/lib/search-params'
import {
  countWords,
  defaultWindow,
  draftSearch,
  formatKb,
  panelSearchOf,
  panelTabOf,
  readTryIt,
  sameScope,
  scopeFromSearch,
  scopeWords,
  searchOf,
  tryItInput,
  type TryItScope,
} from '@/lib/try-it'

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { location: { state: {} }, back: vi.fn() } }),
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: ComponentProps<'a'> & {
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (href, [key, value]) => href.replace(`$${key}`, value),
      to,
    )
    const query = new URLSearchParams(
      Object.entries(search ?? {}).filter(([, value]) => value !== undefined),
    ).toString()
    return (
      <a href={query ? `${path}?${query}` : path} {...props}>
        {children}
      </a>
    )
  },
}))

// The library's panel is tested with the library; here it is what the page opens a fact in.
vi.mock('@/components/library/item-panel', () => ({
  ItemPanel: ({
    itemId,
    tab,
    position,
  }: {
    itemId: string
    tab: string
    position: { index: number; total: number } | null
  }) => (
    <section
      aria-label="Fact panel"
      data-item={itemId}
      data-tab={tab}
      data-place={position ? `${position.index + 1} of ${position.total}` : undefined}
    />
  ),
}))

afterEach(() => {
  window.localStorage.removeItem(MOCK_SCENARIO_KEY)
  window.localStorage.removeItem(MOCK_PERSON_KEY)
})

const unitedKingdom: TryItScope = {
  scope: {
    metrics: ['metric:average_order_value'],
    dimensions: [],
    dimensionValues: [
      { dimension: 'dim:market', value: 'val:market/united_kingdom' },
      { dimension: 'dim:product', value: 'val:product/climbing' },
      { dimension: 'dim:market', value: 'val:market/netherlands' },
    ],
  },
  from: '2026-09-08',
  to: '2026-10-07',
}

describe('a scope to try', () => {
  it('asks get_facts with the metrics, the values by dimension and both days', () => {
    expect(tryItInput(unitedKingdom)).toEqual({
      metrics: ['metric:average_order_value'],
      dimension_filters: [
        {
          dimension: 'dim:market',
          values: ['val:market/united_kingdom', 'val:market/netherlands'],
        },
        { dimension: 'dim:product', values: ['val:product/climbing'] },
      ],
      window: { from: '2026-09-08', to: '2026-10-07' },
    })
    // One day, a last day before the first, and no days at all.
    expect(tryItInput({ ...unitedKingdom, to: null }).window).toEqual({
      from: '2026-09-08',
      to: '2026-09-08',
    })
    expect(tryItInput({ ...unitedKingdom, to: '2026-01-01' }).window?.to).toBe('2026-09-08')
    expect(tryItInput({ ...unitedKingdom, from: null, to: null })).not.toHaveProperty('window')
  })

  it('names a dimension with any value without a value, as get_facts reads it', () => {
    const anyMarket: TryItScope = {
      ...unitedKingdom,
      scope: { metrics: ['metric:orders'], dimensions: ['dim:market'], dimensionValues: [] },
    }
    expect(tryItInput(anyMarket).dimension_filters).toEqual([
      { dimension: 'dim:market', values: [] },
    ])
    expect(scopeFromSearch(validateTryItSearch(searchOf(anyMarket)))?.scope.dimensions).toEqual([
      'dim:market',
    ])
  })

  it('round-trips through the address, and a link of nothing asks nothing', () => {
    const search = searchOf(unitedKingdom)
    expect(search).toEqual({
      about:
        'metric:average_order_value,val:market/united_kingdom,val:product/climbing,val:market/netherlands',
      from: '2026-09-08',
      to: '2026-10-07',
    })
    const back = scopeFromSearch(validateTryItSearch({ ...search }))!
    expect(sameScope(back, unitedKingdom)).toBe(true)
    expect(scopeFromSearch({})).toBeNull()
    // An invalid key or day is dropped, not trusted.
    expect(
      validateTryItSearch({ about: 'drop table', from: '2026-02-30', tab: 'connect' }),
    ).toEqual({ about: undefined, from: undefined, tab: 'connect' })
  })

  it('names a scope in words for a report, with its days', () => {
    const names: Record<string, string> = {
      'metric:average_order_value': 'Average order value',
      'val:market/united_kingdom': 'United Kingdom',
    }
    expect(
      scopeWords(
        unitedKingdom,
        (key) => names[key],
        (day) => day,
      ),
    ).toBe('Average order value, United Kingdom, climbing, netherlands, 2026-09-08 to 2026-10-07')
    expect(
      scopeWords(
        { ...unitedKingdom, from: '2026-09-08', to: '2026-09-08' },
        () => undefined,
        (day) => day,
      ),
    ).toBe('average_order_value, united_kingdom, climbing, netherlands, 2026-09-08')
    expect(
      scopeWords(
        { ...unitedKingdom, from: null, to: null },
        () => undefined,
        (day) => day,
      ),
    ).toBe('average_order_value, united_kingdom, climbing, netherlands')
  })

  it('starts with the last 30 days, today included', () => {
    expect(defaultWindow('2026-10-07')).toEqual({ from: '2026-09-08', to: '2026-10-07' })
  })

  it('starts a draft with the scope and the first day, and never overwrites a chosen start', () => {
    const search = draftSearch(unitedKingdom)
    expect(validateContextSearch(search)).toMatchObject(search)
    const fresh = withScope(formValues(), search.about?.split(','), search.from)
    expect(fresh.scope.metrics).toEqual(['metric:average_order_value'])
    expect(fresh.scope.dimensionValues).toHaveLength(3)
    expect(fresh.validity.start).toBe('2026-09-08')
    const chosen = { ...formValues(), validity: { start: '2026-01-01', end: null } }
    expect(withScope(chosen, [], '2026-09-08').validity.start).toBe('2026-01-01')
    expect(withScope(chosen, undefined, undefined)).toBe(chosen)
  })
})

describe('a fact open in the panel', () => {
  it('is in the address with its tab, and the scope asked stays in it', () => {
    expect(panelSearchOf(unitedKingdom, 'itm_abc12345', 'read')).toEqual({
      ...searchOf(unitedKingdom),
      panel: 'itm_abc12345',
      tab: undefined,
    })
    expect(panelSearchOf(unitedKingdom, 'itm_abc12345', 'history')).toMatchObject({
      panel: 'itm_abc12345',
      tab: 'history',
    })
    // Closed, neither the fact nor its tab is left in the address.
    expect(panelSearchOf(unitedKingdom, null, 'history')).toEqual({
      ...searchOf(unitedKingdom),
      panel: undefined,
      tab: undefined,
    })
    expect(panelSearchOf(null, 'itm_abc12345', 'read')).toEqual({
      panel: 'itm_abc12345',
      tab: undefined,
    })
  })

  it('reads the fact and its tab from the address, and drops what it cannot trust', () => {
    const search = validateTryItSearch({
      ...searchOf(unitedKingdom),
      panel: 'itm_abc12345',
      tab: 'links',
    })
    expect(search).toMatchObject({ panel: 'itm_abc12345', tab: 'links' })
    expect(panelTabOf(search)).toBe('links')
    expect(panelTabOf({})).toBe('read')
    // Connect is still a setting of the person's own, never a tab of a fact.
    expect(panelTabOf({ tab: 'connect' })).toBe('read')
    expect(panelTabOf({ tab: 'agent' })).toBe('read')
    expect(validateTryItSearch({ panel: '../etc/passwd', tab: 'nonsense' })).toEqual({
      panel: undefined,
      tab: undefined,
    })
  })
})

describe("get_facts's reply, in words", () => {
  const reply = (extra: Partial<TryIt['result']> = {}): TryIt => ({
    bytes: 3140,
    limit: 100_000,
    result: {
      status: 'matched',
      edition: '2026-10-07.2',
      tool_schema_digest: '9f2c4e1a00000000000000000000000000000000000000000000000000000000',
      items: [
        {
          id: 'itm_a0000001',
          version: 1,
          edition: '2026-10-07.2',
          kind: 'event',
          title: 'Launch',
          summary: 'A launch.',
          validity: { start: '2025-02-21', end: null },
          claim_level: 'fact_only',
          risk: 'normal',
          freshness: 'verified',
          evidence: [],
          not_to_conclude: 'Launch traffic does not mean lasting growth.',
          owner: { team: null, role: 'the owner of Sales' },
          reviewed: {
            accepted_on: '2025-02-20',
            accepted_by: 'the owner of Sales',
            in_edition: '2025-02-20.1',
          },
          links: [],
          match: 'partial',
          applies_note: 'Applies to dim:product: val:product/climbing only.',
          conflicts_with: ['itm_a0000002'],
        },
      ],
      options: [],
      check_report: {
        status: 'matched',
        matched: 1,
        withheld: 2,
        links_withheld: 0,
        cut: false,
        cut_ids: [],
        checked: [],
        statements: ['No match does not prove that no caveat exists.'],
      },
      instructions: 'State the documented fact.',
      ...extra,
    },
  })

  it('counts, ranks and names what the agent gets, with the size and the tools version', () => {
    const read = readTryIt(reply(), (key) =>
      key === 'val:product/climbing' ? 'Climbing' : undefined,
    )
    expect(read.delivered[0]).toMatchObject({
      rank: 1,
      match: 'partial',
      appliesNote: 'Applies to Product: Climbing only.',
      conflictsWith: ['itm_a0000002'],
      version: 1,
      // How it was reviewed, as the agent reads it: the role, never a person (FR-326).
      reviewed: {
        acceptedOn: '2025-02-20',
        by: 'the owner of Sales',
        edition: '2025-02-20.1',
      },
    })
    expect(countWords(read)).toBe('1 fact, 2 held back')
    expect(`${formatKb(read.bytes)} of ${formatKb(read.limit)}`).toBe('3.1 KB of 100 KB')
    expect(read.digest).toBe('9f2c4e1a')
    expect(read.instructions).toBe('State the documented fact.')
  })

  it('says what the scope needs in words, never in keys', () => {
    const read = readTryIt(
      reply({
        status: 'need_more_detail',
        items: [],
        options: [
          { field: 'dates', input: '', options: [] },
          { field: 'scope', input: '', options: [] },
          { field: 'metrics', input: 'metric:margin_rate', options: [] },
        ],
      }),
    )
    expect(read.needs.map((need) => need.words)).toEqual([
      'Add the first and last day the question is about.',
      'Add a metric, a market or a product.',
      "Margin rate isn't a name we know yet.",
    ])
    expect(namedKeys('val:market/north_land and metric:x', () => undefined)).toBe(
      'North land and X',
    )
  })
})

describe('Connect an agent, in words', () => {
  it('gives each client a snippet with the address and a place for the token', () => {
    const address = 'https://heed.example.test/mcp'
    const claude = snippetFor('claude-code', address)
    expect(claude.language).toBe('shell')
    expect(claude.code).toContain(`claude mcp add --transport http heed ${address}`)
    expect(claude.code).toContain(`Bearer ${TOKEN_PLACEHOLDER}`)
    for (const label of ['cursor', 'vscode', 'some-other-client']) {
      const snippet = snippetFor(label, address)
      expect(snippet.language).toBe('json')
      expect(JSON.stringify(JSON.parse(snippet.code))).toContain(address)
    }
    expect(JSON.parse(snippetFor('vscode', address).code)).toEqual({
      servers: {
        heed: {
          type: 'http',
          url: address,
          headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` },
        },
      },
    })
  })

  it('gives a client that signs in the address alone, with no token', () => {
    const address = 'https://heed.example.test/mcp'
    expect(snippetFor('claude-code', address, 'sign-in').code).toBe(
      `claude mcp add --transport http heed ${address}`,
    )
    expect(JSON.parse(snippetFor('vscode', address, 'sign-in').code)).toEqual({
      servers: { heed: { type: 'http', url: address } },
    })
    for (const label of ['cursor', 'some-other-client'])
      expect(JSON.parse(snippetFor(label, address, 'sign-in').code)).toEqual({
        mcpServers: { heed: { url: address } },
      })
  })

  it('names an app with a setup of its own by the app, whatever its row says about the token', () => {
    expect(appNameFor({ label: 'claude-code', name: 'Claude Code with a token' })).toBe(
      'Claude Code',
    )
    expect(appNameFor({ label: 'vscode', name: 'VS Code for the team' })).toBe('VS Code')
    expect(appNameFor({ label: 'support-bot', name: 'Support bot' })).toBe('Support bot')
  })

  it('gives the ask Heed first lines word for word as the help guide does, promising no call', () => {
    const guide = withProductName(
      readFileSync('docs/old-help/connect-an-agent.md', 'utf8'),
      productName,
    )
    for (const line of askHeedFirst) {
      expect(guide).toContain(`\n${line.text}\n`)
      expect(line.text).toMatch(/get_context/)
      // A line raises the chance of a call; no words here may say it is sure.
      expect(`${line.where} ${line.text}`).not.toMatch(
        /\b(always|guarantee|every time|ensures?)\b/i,
      )
    }
  })

  it("lists the tools in the gateway's order, with their names and what they do", () => {
    const tools = toolsInWords(
      ['report', 'new_tool', 'get_context'].map((tool) => ({
        tool,
        enabled: tool !== 'report',
        personOnly: false,
      })),
    )
    expect(tools.map((tool) => tool.name)).toEqual([
      'Get context for a question',
      'Tell the owner',
      'new_tool',
    ])
    expect(tools[1]!.enabled).toBe(false)
    expect(tools[2]!.about).toBeNull()
  })

  // The first call to the mock loads it whole, which takes more than the default five seconds
  // on a busy machine.
  it(
    'says in words what every tool does, as the gateway lists them',
    { timeout: 20_000 },
    async () => {
      // The mock lists every tool in the gateway's registry (tests/conformance/context-api-agents.ts).
      const { tools } = await api.getConnectInfo()
      for (const tool of toolsInWords(tools)) {
        expect(tool.name, tool.tool).not.toBe(tool.tool)
        expect(tool.about, tool.tool).toBeTruthy()
      }
      expect(Object.keys(toolInfo).sort()).toEqual(tools.map((tool) => tool.tool).sort())
    },
  )
})

function withQueries(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** The view as the panel holds it: the scope asked lives beside it. */
function Panel({ start = null }: { start?: TryItScope | null }) {
  const [asked, setAsked] = useState<TryItScope | null>(start)
  return <TryItView asked={asked} onAsk={setAsked} idPrefix="test" />
}

describe('What an agent would get', () => {
  it('asks for a metric or a value before it asks the service', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'tryIt')
    render(withQueries(<Panel />))
    expect(await screen.findByText('See what an agent gets')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Show what agents get' }))
    expect(await screen.findByText('Add a metric, a market or a product first.')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'What it is about' })).toHaveFocus()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('shows the facts an agent gets, ranked, with the instructions, from the keyboard', async () => {
    const user = userEvent.setup()
    render(withQueries(<Panel />))
    const chips = await screen.findByRole('combobox', { name: 'What it is about' })
    // The dates start as the last 30 days of the fixture day.
    // The fixture library (1,500 items) gives the day; building it takes a while in jsdom.
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('8 Sept 2026'), {
      timeout: 10_000,
    })
    // The picker searches the vocabulary, so its rows arrive after typing rests.
    await user.type(chips, 'Average order')
    await screen.findAllByRole('option', { name: /^Average order value/ }, { timeout: 5000 })
    await user.keyboard('{Enter}')
    await user.type(chips, 'United Kingdom')
    await screen.findAllByRole('option', { name: /^United Kingdom/ }, { timeout: 5000 })
    await user.keyboard('{Enter}')
    await user.keyboard('{Control>}{Enter}{/Control}')
    const delivered = await screen.findByRole('list', {
      name: 'What the agent gets, in order',
    })
    const facts = within(delivered).getAllByRole('listitem')
    expect(facts.length).toBeGreaterThan(0)
    expect(within(facts[0]!).getByLabelText('Ranked 1')).toBeVisible()
    expect(within(facts[0]!).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/library\/itm_/),
    )
    // Every fact says it was reviewed before it was served, and inside Heed it names who (FR-326).
    await waitFor(() =>
      expect(facts[0]!.querySelector('[data-slot="review-stamp"]')).toHaveTextContent(
        /^Accepted \d{1,2} \w+ \d{4} by [A-Z][a-z]+ [A-Z][a-z]+, owner of [^·]+ · , Checks passed$/,
      ),
    )
    // An edition label shows only on the Editions page (voice guide, principle 8).
    expect(facts[0]!.querySelector('[data-slot="review-stamp"]')).not.toHaveTextContent(
      /\d{4}-\d{2}-\d{2}\.\d+/,
    )
    // One polite announcement when the reply is ready, never the list read item by item.
    expect(screen.getByText(/^Ready\. \d+ facts?/)).toHaveAttribute('role', 'status')
    expect(screen.getByRole('region', { name: 'What agents get' })).toBeVisible()
    expect(screen.getByLabelText('what the agent is told')).toHaveTextContent(
      /^State the documented fact/,
    )
    expect(screen.getByText('Nothing is saved.')).toBeVisible()
    // The reply stays the one asked while the bar changes.
    await user.click(screen.getByRole('button', { name: 'Remove Market United Kingdom' }))
    expect(screen.getByRole('list', { name: 'What the agent gets, in order' })).toBe(delivered)
  }, 20_000)

  it('asks the service again when the same scope is asked again', async () => {
    const spy = vi.spyOn(api, 'tryIt')
    render(withQueries(<Panel start={unitedKingdom} />))
    await screen.findByRole('list', { name: 'What the agent gets, in order' })
    expect(spy).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Show what agents get' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    spy.mockRestore()
  })

  it('offers to start a draft when nothing applies', async () => {
    render(
      withQueries(<Panel start={{ ...unitedKingdom, from: '1999-01-01', to: '1999-01-31' }} />),
    )
    // The fixture library gives the day; a test that runs first builds it, which takes a while.
    expect(
      await screen.findByText('Nothing is written down for this', {}, { timeout: 10_000 }),
    ).toBeVisible()
    const draft = screen.getByRole('link', { name: 'Start a draft' })
    const href = new URL(draft.getAttribute('href')!, 'http://heed.test')
    expect(href.pathname).toBe('/library/new')
    expect(href.searchParams.get('from')).toBe('1999-01-01')
    expect(href.searchParams.get('about')?.split(',')).toContain('metric:average_order_value')
  }, 20_000)

  it('reports a gap about the scope with its type and note, once, and says so', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'reportGap')
    render(
      withQueries(<Panel start={{ ...unitedKingdom, from: '1999-01-01', to: '1999-01-31' }} />),
    )
    await screen.findByText('Nothing is written down for this', {}, { timeout: 10_000 })
    await user.click(screen.getByRole('button', { name: 'Report a gap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report a gap' })
    expect(
      within(dialog).getByText(
        /^Average order value, United Kingdom, Climbing, Netherlands, 1 January 1999/,
      ),
    ).toBeVisible()
    expect(within(dialog).getByText('Missing')).toBeVisible()
    expect(within(dialog).getByText('No fact covers it.')).toBeVisible()
    await user.click(within(dialog).getByRole('textbox'))
    await user.paste('Ask me at someone@example.test')
    expect(within(dialog).getByRole('textbox')).toHaveValue('Ask me at someone@example.test')
    await user.click(within(dialog).getByRole('button', { name: 'Report gap' }))
    expect(await within(dialog).findByText(/It looks like it holds an email address/)).toBeVisible()
    await user.clear(within(dialog).getByRole('textbox'))
    expect(within(dialog).getByRole('textbox')).toHaveValue('')
    await user.click(within(dialog).getByRole('textbox'))
    await user.paste('Nothing for January 1999.')
    expect(within(dialog).getByRole('textbox')).toHaveValue('Nothing for January 1999.')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Report gap' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(spy).toHaveBeenLastCalledWith({
      ...tryItInput({ ...unitedKingdom, from: '1999-01-01', to: '1999-01-31' }),
      type: 'missing',
      note: 'Nothing for January 1999.',
    })
    // The refused note, then the one report: a double click is the same report.
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  }, 20_000)

  it('says when there were too many reports, and keeps what was written', async () => {
    const user = userEvent.setup()
    const spy = vi
      .spyOn(api, 'reportGap')
      .mockRejectedValueOnce(new ApiError('unavailable', 'Too many reports', { status: 429 }))
    render(withQueries(<Panel start={unitedKingdom} />))
    await screen.findByRole('list', { name: 'What the agent gets, in order' })
    await user.click(screen.getByRole('button', { name: 'Report a gap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report a gap' })
    // It starts on Missing, the most common, even when facts were delivered.
    expect(within(dialog).getByText('Missing')).toBeVisible()
    await user.click(within(dialog).getByRole('textbox'))
    await user.paste('The rate is from 2025.')
    expect(within(dialog).getByRole('textbox')).toHaveValue('The rate is from 2025.')
    await user.click(within(dialog).getByRole('button', { name: 'Report gap' }))
    expect(
      await within(dialog).findByText('You reported several gaps just now. Try again in a minute.'),
    ).toBeVisible()
    expect(within(dialog).getByRole('textbox')).toHaveValue('The rate is from 2025.')
    spy.mockRestore()
  })

  it('says it read the scope at today when the dates are gone, as an agent is told', async () => {
    render(withQueries(<Panel start={{ ...unitedKingdom, from: null, to: null }} />))
    expect(
      await screen.findByText(
        "You didn't choose dates, so this is what applies today, 7 October 2026. Agents are told to say so. Add a first and last day to see another period.",
      ),
    ).toBeVisible()
    expect(screen.queryByText('Add the first and last day the question is about.')).toBeNull()
    expect(screen.getByRole('list', { name: /What the agent gets/ })).toBeVisible()
  })

  it('says plainly when no edition is live, and offers a retry when the service fails', async () => {
    const spy = vi
      .spyOn(api, 'tryIt')
      .mockRejectedValueOnce(
        new ApiError('precondition', 'No edition is live yet', { status: 412 }),
      )
    const { unmount } = render(withQueries(<Panel start={unitedKingdom} />))
    expect(await screen.findByText("Agents don't get any facts yet")).toBeVisible()
    unmount()
    spy.mockRejectedValueOnce(new ApiError('unavailable', 'The service did not answer'))
    render(withQueries(<Panel start={unitedKingdom} />))
    expect(await screen.findByText("We couldn't get what agents get")).toBeVisible()
    spy.mockRestore()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: /What the agent gets/ })).toBeVisible()
  })
})

/** The page holds the fact open in the address; here, in state. */
function Page({ start, openId = null }: { start: TryItScope; openId?: string | null }) {
  const panel: FactPanelState = {
    openId,
    tab: 'read',
    to: (id, tab) => panelSearchOf(start, id, tab),
  }
  return <TryItView asked={start} onAsk={() => undefined} idPrefix="test" panel={panel} />
}

describe('What an agent would get, on its page', () => {
  it('opens a fact beside the reply instead of leaving the page, and marks the open one', async () => {
    const { unmount } = render(withQueries(<Page start={unitedKingdom} />))
    const delivered = await screen.findByRole('list', { name: 'What the agent gets, in order' })
    const facts = within(delivered).getAllByRole('listitem')
    const links = facts.map((fact) => within(fact).getByRole('link'))
    for (const link of links) {
      const href = link.getAttribute('href') ?? ''
      // The same page, with the scope asked and the fact in the address (`?panel=`).
      expect(href).toMatch(/^\/try-it\?.*about=metric%3Aaverage_order_value.*&panel=itm_[a-z0-9]+$/)
      expect(link).toHaveAttribute('data-row-link')
    }
    const ids = facts.map((fact) => fact.getAttribute('data-row-id'))
    expect(ids.every(Boolean)).toBe(true)
    expect(facts.some((fact) => fact.hasAttribute('data-open'))).toBe(false)
    unmount()

    // The fact in the panel is the one marked in the list.
    render(withQueries(<Page start={unitedKingdom} openId={ids[1]} />))
    const again = await screen.findByRole('list', { name: 'What the agent gets, in order' })
    const marked = within(again)
      .getAllByRole('listitem')
      .filter((fact) => fact.hasAttribute('data-open'))
    expect(marked.map((fact) => fact.getAttribute('data-row-id'))).toEqual([ids[1]])
    // The panel holds that fact, and says where it is in the reply.
    const open = screen.getByRole('region', { name: 'Fact panel' })
    expect(open).toHaveAttribute('data-item', ids[1])
    expect(open).toHaveAttribute('data-tab', 'read')
    expect(open).toHaveAttribute('data-place', `2 of ${ids.length}`)
  }, 20_000)

  it("keeps the assistant's panel on the facts' own pages: it is the panel already", async () => {
    render(withQueries(<Panel start={unitedKingdom} />))
    const delivered = await screen.findByRole('list', { name: 'What the agent gets, in order' })
    const link = within(within(delivered).getAllByRole('listitem')[0]!).getByRole('link')
    expect(link).toHaveAttribute('href', expect.stringMatching(/^\/library\/itm_/))
    expect(link).not.toHaveAttribute('data-row-link')
    expect(delivered.querySelector('[data-open]')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Fact panel' })).toBeNull()
  })
})

describe('Connect an agent', () => {
  it('gives the address, a setup per client, the tools and what to do next', async () => {
    render(withQueries(<ConnectSection />))
    expect(await screen.findByLabelText('the address for agents')).toHaveTextContent(
      'http://localhost:3000/mcp',
    )
    expect(screen.getByText('Sign in from your agent')).toBeVisible()
    expect(screen.getByLabelText('the setup for Claude Code')).toHaveTextContent(
      'claude mcp add --transport http heed http://localhost:3000/mcp',
    )
    // Cursor is switched off in the mock, and the evaluation runner is no one's client.
    expect(screen.queryByText('Cursor')).toBeNull()
    expect(screen.queryByText(/Evaluation runner/)).toBeNull()
    const tools = screen.getByRole('list', { name: 'The tools an agent gets' })
    const rows = within(tools).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Get context for a question')
    // Every tool of the agent contract is on, get_related and suggest_context too (FR-121, FR-332).
    expect(rows.map((row) => row.textContent)).not.toContainEqual(expect.stringContaining('Off'))
    const suggest = rows.find((row) => row.textContent.includes('Send a suggestion'))!
    expect(suggest).toHaveTextContent('It works only in an agent you signed in from')
    expect(suggest).toHaveTextContent(
      'It sends only after you say yes, and the owner checks it before anything changes.',
    )
    // The lines that make a client more likely to ask Heed first, each with a copy button, and
    // words that do not promise it.
    expect(screen.getByRole('heading', { name: 'Ask first' })).toBeVisible()
    for (const line of askHeedFirst) {
      expect(screen.getByLabelText(line.label)).toHaveTextContent(line.text)
      expect(screen.getByRole('button', { name: `Copy ${line.label}` })).toBeVisible()
    }
    expect(screen.getByText(/so it checks more often/)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'What to do next' })).toBeVisible()
    // A contributor does not manage the gateway, so the page does not send them there.
    expect(screen.queryByRole('link', { name: 'MCP and gateway' })).toBeNull()
  })

  it('keeps a space before the product name in the sign-in step', async () => {
    render(withQueries(<ConnectSection />))
    expect(await screen.findByText(/When it asks, sign in to/)).toHaveTextContent(
      `When it asks, sign in to ${productName} and allow it.`,
    )
  })

  it('sends an administrator to MCP and gateway in Administration, and to its Tools for a tool off', async () => {
    window.localStorage.setItem(MOCK_PERSON_KEY, 'per_ravi')
    await api.setTool({ tool: 'get_related', enabled: false, reason: 'Not now' })
    try {
      render(withQueries(<ConnectSection />))
      expect(await screen.findByRole('link', { name: 'MCP and gateway' })).toHaveAttribute(
        'href',
        '/admin?section=gateway',
      )
      const switchOn = screen.getAllByRole('link', { name: 'MCP and gateway, under Tools' })
      expect(switchOn).toHaveLength(1)
      expect(switchOn[0]).toHaveAttribute('href', '/admin?section=gateway&tab=tools')
    } finally {
      await api.setTool({ tool: 'get_related', enabled: true, reason: 'Back on' })
    }
  })

  it('offers a retry when the service fails', async () => {
    window.localStorage.setItem(MOCK_SCENARIO_KEY, 'error')
    render(withQueries(<ConnectSection />))
    expect(await screen.findByText("We couldn't load how to connect")).toBeVisible()
  })
})
