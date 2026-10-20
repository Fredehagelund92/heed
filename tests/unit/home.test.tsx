import type * as Router from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { HomeSearch } from '@/components/home/home-search'
import { HomeTable } from '@/components/home/home-table'
import { QuickActions } from '@/components/home/quick-actions'
import {
  factQuery,
  factSuggestions,
  homeTopics,
  knownIssues,
  RECENT_LIMIT,
  recentFacts,
  SUGGESTION_LIMIT,
} from '@/lib/home'
import { buildRows, daysFrom, type LibraryRow, type LibraryViewer } from '@/lib/library'
import { visibleRows } from '@/lib/library-search'
import { validateHomeSearch } from '@/lib/search-params'
import { areas, people, vocabulary } from '@/mocks/reference-data'

const reader: LibraryViewer = { personId: undefined, areaIds: [], maintains: false }

const navigate = vi.fn()

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useNavigate: () => navigate,
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
  }) => (
    <a
      href={
        Object.entries(params ?? {}).reduce(
          (href, [key, value]) => href.replace(`$${key}`, value),
          to,
        ) + (search ? `?${new URLSearchParams(search).toString()}` : '')
      }
      {...props}
    >
      {children}
    </a>
  ),
}))

afterEach(() => vi.clearAllMocks())

let rows: LibraryRow[]
let today: string

beforeAll(async () => {
  const library = await api.listLibrary()
  today = library.today
  rows = buildRows(library, { areas, people, vocabulary })
})

describe("Home's row model", () => {
  it('lists the facts changed in the last 30 days, newest first, at most eight', () => {
    const recent = recentFacts(rows, today)
    expect(recent.length).toBeGreaterThan(0)
    expect(recent.length).toBeLessThanOrEqual(RECENT_LIMIT)
    const dates = recent.map((row) => row.updatedAt)
    expect(dates).toEqual([...dates].sort().reverse())
    for (const row of recent) {
      expect(daysFrom(today, row.updatedAt)).toBeGreaterThanOrEqual(-30)
      expect(row.displayStatus).not.toBe('retired')
    }
  })

  it('leaves out retired facts and ended issues, and is empty when nothing changed lately', () => {
    const old = rows.map((row) => ({ ...row, updatedAt: '2020-01-01T00:00:00Z' }))
    expect(recentFacts(old, today)).toEqual([])
    const retired = rows.map((row) => ({ ...row, displayStatus: 'retired' as const }))
    expect(recentFacts(retired, today)).toEqual([])
  })

  it('lists the issues that apply today, the one ending soonest first', () => {
    const issues = knownIssues(rows)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((row) => row.displayStatus === 'active_issue')).toBe(true)
    const ends = issues.map((row) => row.until ?? '9999')
    expect(ends).toEqual([...ends].sort())
    expect(knownIssues(rows.filter((row) => row.kind !== 'issue'))).toEqual([])
  })

  it('makes topics of the metric groups, with their facts and known issues', async () => {
    const catalogue = await api.listCatalogue()
    const topics = homeTopics(catalogue.terms, rows, today)
    const groups = new Set(
      catalogue.terms.flatMap((term) =>
        term.kind === 'metric' && term.group ? [term.group.key] : [],
      ),
    )
    expect(topics.map((topic) => topic.key).sort()).toEqual([...groups].sort())
    const facts = topics.map((topic) => topic.facts)
    expect(facts).toEqual([...facts].sort((a, b) => b - a))
    const payments = topics.find((topic) => topic.name === 'Payments')
    expect(payments?.metrics.map((metric) => metric.name)).toEqual(['Orders', 'Returns'])
    expect(payments?.facts).toBeGreaterThan(0)
  })

  it('suggests the best three facts and counts every match the library shows', () => {
    const suggestions = factSuggestions(rows, 'orders poland', reader)
    const library = visibleRows(rows, { q: 'orders poland' }, reader)
    expect(suggestions.total).toBe(library.length)
    expect(suggestions.rows).toEqual(library.slice(0, SUGGESTION_LIMIT))
    expect(factSuggestions(rows, '   ', reader)).toEqual({ rows: [], total: 0 })
  })

  it('keeps the tab in the address, and drops one it does not know', () => {
    expect(validateHomeSearch({ tab: 'issues' })).toEqual({ tab: 'issues' })
    expect(validateHomeSearch({ tab: 'quality' })).toEqual({ tab: undefined })
  })
})

describe("Home's search field", () => {
  function renderSearch() {
    const onAsk = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <HomeSearch rows={rows} viewer={reader} onAsk={onAsk} />
      </QueryClientProvider>,
    )
    return {
      onAsk,
      field: screen.getByRole('combobox', { name: 'Search the library, or ask a question' }),
    }
  }

  it('is one plain field whose list stays closed until a person types', async () => {
    const { field } = renderSearch()
    expect(field).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    await userEvent.type(field, 'orders poland')
    expect(field).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox', { name: 'Suggestions' })
    const options = within(list).getAllByRole('option')
    const total = factSuggestions(rows, 'orders poland', reader).total
    // Facts first, then "Show all", then Ask and Try it.
    expect(options.map((option) => option.dataset.suggestion)).toEqual([
      'fact',
      'fact',
      'fact',
      'all',
      'ask',
      'try',
    ])
    expect(options[3]).toHaveTextContent(`Show all ${total} in the library`)
    expect(options[4]).toHaveTextContent('Ask the assistant: “orders poland”')
    expect(options[5]).toHaveTextContent('Try a question: what do AI apps get for “orders poland”?')
    expect(screen.getByRole('status')).toHaveTextContent(`Facts: ${total} matches`)
  })

  it('opens the first fact on Enter, and moves with the arrows', async () => {
    const { field } = renderSearch()
    await userEvent.type(field, 'orders poland')
    const first = factSuggestions(rows, 'orders poland', reader).rows[0]!
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(field).toHaveAttribute('aria-activedescendant', options[0]!.id)
    await userEvent.keyboard('{ArrowDown}')
    expect(field).toHaveAttribute('aria-activedescendant', options[1]!.id)
    await userEvent.keyboard('{ArrowUp}{Enter}')
    expect(navigate).toHaveBeenCalledWith({ to: '/library/$itemId', params: { itemId: first.id } })
  })

  it('wraps from the first row to Try it, and asks the assistant from its row', async () => {
    const { field, onAsk } = renderSearch()
    await userEvent.type(field, 'orders poland')
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('option').at(-1)).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Enter}')
    // Try it opens on what the words name, read as get_context reads a question.
    const reading = await api.readTryItQuestion({ question: 'orders poland' })
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/try-it',
        search: { about: reading.about.map((term) => term.key).join(',') },
      }),
    )
    expect(reading.about.map((term) => term.key)).toContain('metric:orders')
    await userEvent.type(field, ' ')
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{Enter}')
    // The words go to the assistant's new chat, and leave the field.
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(onAsk).toHaveBeenCalledWith('orders poland')
    expect(field).toHaveValue('')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows all matches in the library', async () => {
    const { field } = renderSearch()
    await userEvent.type(field, 'orders poland')
    await userEvent.click(screen.getByRole('option', { name: /Show all/ }))
    expect(navigate).toHaveBeenCalledWith({ to: '/library', search: { q: 'orders poland' } })
  })

  it('closes on Escape, then clears the field', async () => {
    const { field } = renderSearch()
    await userEvent.type(field, 'orders')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(field).toHaveValue('orders')
    await userEvent.keyboard('{Escape}')
    expect(field).toHaveValue('')
  })

  it('leaves out the words of a question, and shows what Try it will ask about', async () => {
    const { field } = renderSearch()
    await userEvent.type(field, 'why did orders drop in Poland in August')
    expect(factQuery('why did orders drop in Poland in August')).toBe('orders drop Poland August')
    const reading = await screen.findByText(/^Read as Orders/)
    expect(reading).toHaveTextContent(/Poland/)
    expect(reading).toHaveTextContent(/1 Aug \d{4} to 31 Aug \d{4}/)
    await userEvent.click(screen.getByRole('option', { name: /^Try a question/ }))
    const [target] = navigate.mock.lastCall as [{ to: string; search: Record<string, string> }]
    expect(target.to).toBe('/try-it')
    expect(target.search.about).toContain('metric:orders')
    expect(target.search.from).toMatch(/^\d{4}-08-01$/)
    expect(target.search.to).toMatch(/^\d{4}-08-31$/)
    // The question itself never reaches the address.
    expect(JSON.stringify(navigate.mock.calls)).not.toContain('why')
  })

  it('says when no fact matches, and still offers to ask', async () => {
    const { field } = renderSearch()
    await userEvent.type(field, 'zzzzqqq')
    expect(screen.getByText(/No facts match “zzzzqqq”/)).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.dataset.suggestion)).toEqual(['ask', 'try'])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })
})

describe("Home's table", () => {
  const ready = <T,>(data: T) => ({ state: 'ready' as const, data })

  function renderTable(props: Partial<ComponentProps<typeof HomeTable>> = {}) {
    const onTab = vi.fn()
    render(
      <HomeTable
        tab="recent"
        onTab={onTab}
        recent={ready({ rows: recentFacts(rows, today), libraryEmpty: false })}
        issues={ready(knownIssues(rows))}
        topics={ready([])}
        today={today}
        {...props}
      />,
    )
    return { onTab }
  }

  it('has three text tabs with plain counts, and Recently changed open', async () => {
    const { onTab } = renderTable()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Recently changed',
      `Known issues${knownIssues(rows).length}`,
      'Topics0',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    const grid = screen.getByRole('table', { name: 'Recently changed' })
    expect(within(grid).getAllByRole('row')).toHaveLength(recentFacts(rows, today).length + 1)
    await userEvent.click(tabs[1]!)
    expect(onTab).toHaveBeenCalledWith('issues')
  })

  it('links every fact to its page', () => {
    renderTable()
    const first = recentFacts(rows, today)[0]!
    expect(screen.getByRole('link', { name: first.title })).toHaveAttribute(
      'href',
      `/library/${first.id}`,
    )
  })

  it('says there are no known data issues on a day with none', () => {
    renderTable({ tab: 'issues', issues: ready([]) })
    expect(screen.getByText('No known data issues')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says when nothing changed lately, and when there are no facts at all', () => {
    renderTable({ recent: ready({ rows: [], libraryEmpty: false }) })
    expect(screen.getByText('Nothing changed lately')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the library' })).toHaveAttribute(
      'href',
      '/library',
    )
  })

  it('offers to add the first fact to an empty library', () => {
    renderTable({ recent: ready({ rows: [], libraryEmpty: true }) })
    expect(screen.getByText('No facts yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a fact' })).toHaveAttribute('href', '/library/new')
  })

  it('offers a retry when the facts could not load', () => {
    const retry = vi.fn()
    renderTable({ recent: { state: 'failed', retry } })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })

  it('shows no edition labels', () => {
    renderTable()
    expect(document.body.textContent).not.toMatch(/edition|\d{4}-\d{2}-\d{2}\.\d+/i)
  })
})

describe("Home's quick actions", () => {
  it('are three, leave the assistant to its launcher, and send Connect an AI app to Settings', () => {
    render(<QuickActions />)
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('link', { name: /Try a question/ })).toHaveAttribute('href', '/try-it')
    expect(screen.getByRole('link', { name: /Add a fact/ })).toHaveAttribute('href', '/library/new')
    expect(screen.getByRole('link', { name: /Connect an AI app/ })).toHaveAttribute(
      'href',
      '/settings?section=connect',
    )
    expect(screen.queryByText(/assistant/i)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
