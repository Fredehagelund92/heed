import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandScopeContext } from '@/components/app-shell/command-scope'
import { dockFitWidth, useDockList } from '@/components/page/use-dock-list'
import { termOfKey } from '@/components/catalogue/term-panel'
import { termLibraryList } from '@/components/catalogue/term-parts'
import { DecisionFooter } from '@/components/review/decision-bar'
import type { ListScope } from '@/lib/commands'
import type { DecisionBar } from '@/lib/review'
import type * as Router from '@tanstack/react-router'

const back = vi.fn()
/** The history entry on screen: its index and what it says (lib/history.ts). */
let entry: { __TSR_index: number; panelOpened?: true } = { __TSR_index: 0 }
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useRouter: () => ({ history: { back, location: { state: entry } } }),
}))

afterEach(() => {
  vi.clearAllMocks()
  entry = { __TSR_index: 0 }
})

describe('dockFitWidth', () => {
  it('fits a docked list to the width it has once the sidebar has folded', () => {
    const root = document.documentElement
    root.style.setProperty('--sidebar-width-rail', '3rem')
    root.style.setProperty('--dock-width', '30rem')
    root.style.fontSize = '16px'
    Object.defineProperty(root, 'clientWidth', { value: 1440, configurable: true })
    // Mid fold the list measures 704 (1,440 less the 256 sidebar and the 480 panel): it fits 912.
    expect(dockFitWidth(704, true)).toBe(912)
    expect(dockFitWidth(1000, true)).toBe(1000)
    expect(dockFitWidth(704, false)).toBe(704)
    // Not measured yet: the list keeps its own default.
    expect(dockFitWidth(0, true)).toBe(0)
  })
})

/** Three rows with a link each, a search field, and the hook around them. */
function List({
  panelId,
  open,
  close,
}: {
  panelId: string | null
  open: (id: string) => void
  close: () => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const ids = ['a', 'b', 'c']
  const dock = useDockList({
    region,
    ids,
    panelId,
    open,
    close,
    searchRef,
  })
  return (
    <div ref={setRegion}>
      <input ref={searchRef} aria-label="Search" />
      {ids.map((id) => (
        <div key={id} data-row-id={id}>
          <a href={`#${id}`} data-row-link>
            Row {id}
          </a>
        </div>
      ))}
      <output>{dock.position ? `${dock.position.index + 1} of ${dock.position.total}` : ''}</output>
      <output>{`previous ${dock.previousId ?? '-'} next ${dock.nextId ?? '-'}`}</output>
      <button type="button" onClick={dock.closePanel}>
        Close
      </button>
    </div>
  )
}

function renderList(panelId: string | null) {
  let scope: ListScope | null = null
  const setters = {
    setList: (next: ListScope | null) => {
      scope = next
    },
    setDocument: () => undefined,
    setReview: () => undefined,
    setCheck: () => undefined,
    setMainAction: () => undefined,
  }
  const open = vi.fn()
  const close = vi.fn()
  const view = render(
    <CommandScopeContext value={setters}>
      <List panelId={panelId} open={open} close={close} />
    </CommandScopeContext>,
  )
  const rerender = (next: string | null) =>
    view.rerender(
      <CommandScopeContext value={setters}>
        <List panelId={next} open={open} close={close} />
      </CommandScopeContext>,
    )
  return { scope: () => scope!, open, close, rerender }
}

/** Runs a scope call inside `act` and returns what it answered. */
function answer<T>(call: () => T): T {
  let result: T | undefined
  act(() => {
    result = call()
  })
  return result as T
}

describe('useDockList', () => {
  it('says where the open row is, and which rows are before and after it', () => {
    renderList('b')
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByText('previous a next c')).toBeInTheDocument()
  })

  it('j and k move between the rows, and open the row they land on while a panel is open', () => {
    const list = renderList(null)
    act(() => list.scope().move(1))
    expect(screen.getByRole('link', { name: 'Row a' })).toHaveFocus()
    expect(list.open).not.toHaveBeenCalled()

    list.rerender('a')
    act(() => list.scope().move(1))
    expect(screen.getByRole('link', { name: 'Row b' })).toHaveFocus()
    expect(list.open).toHaveBeenCalledWith('b')
    act(() => list.scope().moveTo('first'))
    expect(screen.getByRole('link', { name: 'Row a' })).toHaveFocus()
  })

  it('Escape closes the panel first, then leaves the rows', () => {
    const list = renderList('b')
    expect(answer(() => list.scope().clear())).toBe(true)
    expect(list.close).toHaveBeenCalledTimes(1)
    list.rerender(null)
    screen.getByRole('link', { name: 'Row c' }).focus()
    expect(answer(() => list.scope().clear())).toBe(true)
    expect(document.activeElement).toBe(document.body)
    expect(answer(() => list.scope().clear())).toBe(false)
  })

  it('closing goes Back when the entry opened the panel over the list behind it', () => {
    entry = { __TSR_index: 3, panelOpened: true }
    const list = renderList('a')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(back).toHaveBeenCalledTimes(1)
    expect(list.close).not.toHaveBeenCalled()
  })

  it('a linked panel closes by taking itself out of the address', () => {
    const list = renderList('c')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(list.close).toHaveBeenCalledTimes(1)
    expect(back).not.toHaveBeenCalled()
  })

  it('a panel opened by the first entry of the tab closes without leaving the app', () => {
    // A reload or a new tab keeps the mark, but nothing of Heed is behind the first entry.
    entry = { __TSR_index: 0, panelOpened: true }
    const list = renderList('c')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(list.close).toHaveBeenCalledTimes(1)
    expect(back).not.toHaveBeenCalled()
  })

  it('focus returns to the row when the panel closes', async () => {
    const list = renderList('c')
    list.rerender(null)
    await act(() => new Promise((done) => requestAnimationFrame(() => done(undefined))))
    expect(screen.getByRole('link', { name: 'Row c' })).toHaveFocus()
  })

  it('/ searches', () => {
    const list = renderList(null)
    act(() => list.scope().focusSearch())
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus()
  })
})

const ready: DecisionBar = {
  state: 'ready',
  heading: 'Your decision, as owner of Commercial',
  detail: 'All required checks passed.',
  capacity: 'owner',
  outcomes: {
    accept: { allowed: true, label: 'Accept' },
    request_changes: { allowed: true, label: 'Ask for changes' },
    reject: { allowed: true, label: 'Reject' },
  },
}

describe('DecisionFooter', () => {
  it('offers the decisions in a row, Accept last, under who decides', () => {
    const onOpen = vi.fn()
    render(<DecisionFooter bar={ready} onOpen={onOpen} touch={false} />)
    const region = screen.getByRole('region', { name: 'Your decision' })
    expect(region).toHaveTextContent('Your decision, as owner of Commercial.')
    expect(
      within(region)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Reject', 'Ask for changes', 'Accept'])
    fireEvent.click(within(region).getByRole('button', { name: 'Accept' }))
    expect(onOpen).toHaveBeenCalledWith('accept')
  })

  it('keeps a blocked decision visible with its reason, and opens nothing', () => {
    const onOpen = vi.fn()
    const claimed: DecisionBar = {
      ...ready,
      state: 'claimed',
      heading: 'Sofia Brandt is reviewing this',
      outcomes: {
        ...ready.outcomes,
        accept: {
          allowed: false,
          label: 'Accept',
          title: 'Sofia is reviewing this',
          reason: 'Ask Sofia to hand it over, or wait.',
        },
      },
    }
    render(<DecisionFooter bar={claimed} onOpen={onOpen} touch={false} />)
    const accept = screen.getByRole('button', { name: 'Accept' })
    expect(accept).toHaveAttribute('aria-disabled', 'true')
    expect(accept).toHaveAccessibleDescription('Ask Sofia to hand it over, or wait.')
    fireEvent.click(accept)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('on a phone the first decision is the one button, the others in its menu', () => {
    render(<DecisionFooter bar={ready} onOpen={vi.fn()} touch />)
    const region = screen.getByRole('region', { name: 'Your decision' })
    expect(
      within(region)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Accept', ''])
    expect(within(region).getByRole('button', { name: 'More decisions' })).toBeInTheDocument()
  })
})

describe('the term panel', () => {
  it('reads a vocabulary key as the catalogue term it names', () => {
    expect(termOfKey('metric:orders')).toEqual({ kind: 'metric', id: 'orders' })
    expect(termOfKey('dim:market')).toEqual({ kind: 'dimension', id: 'market' })
  })

  it('links every item about a metric; a dimension has no one list', () => {
    expect(termLibraryList({ kind: 'metric', id: 'orders' })).toEqual({
      about: 'orders',
      ended: 'show',
    })
    expect(termLibraryList({ kind: 'dimension', id: 'market' })).toBeNull()
  })
})
