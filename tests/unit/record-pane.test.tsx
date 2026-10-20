import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockScopeContext, SidebarFoldContext } from '@/components/app-shell/dock-scope'
import { DockPanel } from '@/components/page/dock-panel'
import { RecordPane } from '@/components/page/record-pane'
import { TabsContent } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'

/*
  The record pane (Workbench plan, slice W4): one record in the page's own flow. It shares the
  docked panel's bar, heading and tabs, folds the sidebar without asking the shell for room on
  the right, and on a phone closes with a back arrow.
*/

/** Sets the window width the media queries answer for (jsdom has no layout). */
function widthIs(width: number) {
  const matches = (query: string) => {
    const min = /min-width: ([\d.]+)(rem|px)/.exec(query)
    const max = /max-width: ([\d.]+)(rem|px)/.exec(query)
    const px = (match: RegExpExecArray) => Number(match[1]) * (match[2] === 'rem' ? 16 : 1)
    if (min) return width >= px(min)
    if (max) return width <= px(max)
    return false
  }
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: matches(query),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  )
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

afterEach(() => vi.restoreAllMocks())

const tabs = [
  { value: 'evidence', label: 'Evidence' },
  { value: 'history', label: 'History' },
] as const

function renderPane(props: Partial<Parameters<typeof RecordPane>[0]> = {}) {
  const setFolded = vi.fn()
  const setDocked = vi.fn()
  const handlers = { onClose: vi.fn(), onNext: vi.fn(), onTabChange: vi.fn() }
  render(
    <DockScopeContext value={setDocked}>
      <SidebarFoldContext value={setFolded}>
        <TooltipProvider>
          <RecordPane
            title="Net revenue this month so far"
            meta="Test question · 1 of 9"
            tabs={tabs}
            tab="evidence"
            tabsLabel="Test question sections"
            actions={<p>Start a draft</p>}
            {...handlers}
            {...props}
          >
            <TabsContent value="evidence">
              <p>The checks</p>
            </TabsContent>
            <TabsContent value="history">
              <p>The runs</p>
            </TabsContent>
          </RecordPane>
        </TooltipProvider>
      </SidebarFoldContext>
    </DockScopeContext>,
  )
  return { setFolded, setDocked, ...handlers }
}

const pane = () => screen.getByRole('region', { name: 'Net revenue this month so far' })

describe('the record pane', () => {
  it('is a region named by its title, with the bar, the tabs and the actions beside it', () => {
    widthIs(1440)
    renderPane()
    expect(pane()).toHaveAttribute('data-slot', 'record-pane')
    expect(screen.getByText('Test question · 1 of 9')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Test question sections' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Actions' })).toHaveTextContent(
      'Start a draft',
    )
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('folds the sidebar while it is open, without asking the shell for room on the right', () => {
    widthIs(1440)
    const { setFolded, setDocked } = renderPane()
    expect(setFolded).toHaveBeenCalledWith(true)
    expect(setDocked).not.toHaveBeenCalled()
  })

  it('draws the same bar and heading as the docked panel', () => {
    widthIs(1440)
    renderPane()
    const inFlowPane = pane()
    const { container } = render(
      <TooltipProvider>
        <DockPanel
          title="Net revenue this month so far"
          meta="Test question · 1 of 9"
          tabs={tabs}
          tab="evidence"
          onClose={() => undefined}
        />
      </TooltipProvider>,
    )
    const docked = container.querySelector('[data-slot="dock-meta"]')!.parentElement!
    const inFlow = inFlowPane.querySelector('[data-slot="dock-meta"]')!.parentElement!
    for (const name of ['Previous', 'Next', 'Close'])
      expect(inFlow.querySelector(`[aria-label="${name}"]`)?.className).toBe(
        docked.querySelector(`[aria-label="${name}"]`)?.className,
      )
    const heading = (root: ParentNode) => root.querySelector('h2')!.className
    expect(heading(inFlowPane)).toBe(heading(container))
  })

  it('switches tabs and closes on Escape, keeping it from the page', () => {
    widthIs(1440)
    const { onClose, onTabChange } = renderPane()
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(onTabChange).toHaveBeenCalledWith('history')
    const page = vi.fn()
    document.addEventListener('keydown', page)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Evidence' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(page).not.toHaveBeenCalled()
    document.removeEventListener('keydown', page)
  })

  it('offers previous and next only where there is one', () => {
    widthIs(1440)
    const { onNext } = renderPane()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('on a phone closes with a back arrow, takes focus and leaves the sidebar alone', async () => {
    widthIs(390)
    const { onClose, setFolded } = renderPane()
    expect(setFolded).not.toHaveBeenCalled()
    await waitFor(() => expect(pane()).toHaveFocus())
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('names itself while the title loads, and leaves the actions out when there are none', () => {
    widthIs(1440)
    renderPane({ title: null, label: 'Loading the test question', actions: undefined })
    expect(screen.getByRole('region', { name: 'Loading the test question' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})
