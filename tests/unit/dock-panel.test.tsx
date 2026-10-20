import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DockScopeContext,
  PanelCoveredContext,
  PanelOpenedContext,
} from '@/components/app-shell/dock-scope'
import { DockPanel } from '@/components/page/dock-panel'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'

/** Sets the window width the media queries answer for (jsdom has no layout). */
function widthIs(width: number) {
  const matches = (query: string) => {
    const min = /min-width: ([\d.]+)rem/.exec(query)
    const max = /max-width: ([\d.]+)rem/.exec(query)
    if (min) return width >= Number(min[1]) * 16
    if (max) return width <= Number(max[1]) * 16
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
}

afterEach(() => vi.restoreAllMocks())

const tabs = [
  { value: 'read', label: 'Read' },
  { value: 'source', label: 'Source' },
] as const

function renderPanel(props: Partial<Parameters<typeof DockPanel>[0]> = {}) {
  const setDocked = vi.fn()
  const handlers = { onClose: vi.fn(), onNext: vi.fn(), onTabChange: vi.fn() }
  render(
    <DockScopeContext value={setDocked}>
      <TooltipProvider>
        <DockPanel
          title="New tax rate applied in Poland"
          meta="Event · 2 of 1,404"
          tabs={tabs}
          tab="read"
          tabsLabel="Fact sections"
          expand={<a href="/library/itm_zgk6ael1" />}
          footer={<button type="button">Suggest a change</button>}
          {...handlers}
          {...props}
        >
          <TabsContent value="read">
            <p>What happened</p>
          </TabsContent>
          <TabsContent value="source">
            <p>How we know</p>
          </TabsContent>
        </DockPanel>
      </TooltipProvider>
    </DockScopeContext>,
  )
  return { setDocked, ...handlers }
}

describe('the docked panel', () => {
  it('is a region named by its title, with the bar, the tabs and the footer', () => {
    widthIs(1440)
    renderPanel()
    const region = screen.getByRole('region', { name: 'New tax rate applied in Poland' })
    expect(region).toHaveAttribute('data-mode', 'docked')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New tax rate applied')
    expect(screen.getByText('Event · 2 of 1,404')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Fact sections' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Read' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('What happened')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open page' })).toHaveAttribute(
      'href',
      '/library/itm_zgk6ael1',
    )
    expect(screen.getByRole('button', { name: 'Suggest a change' })).toBeInTheDocument()
  })

  it('puts the title first, then the badges and the note line', () => {
    widthIs(1440)
    renderPanel({ badges: <span>Commercial</span>, note: <p>Next check 20 Jan 2027</p> })
    const heading = screen.getByRole('heading', { level: 2 })
    const badges = screen.getByText('Commercial')
    const note = screen.getByText('Next check 20 Jan 2027')
    expect(heading.compareDocumentPosition(badges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(badges.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws the footer quiet: outline actions as ghost beside the one primary', () => {
    widthIs(1440)
    renderPanel({
      footer: (
        <>
          <Button variant="outline">Discard draft</Button>
          <Button>Continue editing</Button>
        </>
      ),
    })
    const secondary = screen.getByRole('button', { name: 'Discard draft' })
    expect(secondary).toHaveClass('hover:bg-muted')
    expect(secondary).not.toHaveClass('border-border')
    expect(screen.getByRole('button', { name: 'Continue editing' })).toHaveClass('bg-primary')
  })

  it('tells the shell it is docked from 1,224 wide', () => {
    widthIs(1224)
    const { setDocked } = renderPanel()
    expect(screen.getByRole('region')).toHaveAttribute('data-mode', 'docked')
    expect(setDocked).toHaveBeenCalledWith(true)
  })

  it('overlays below 1,224 without asking the shell for room', () => {
    widthIs(1223)
    const { setDocked } = renderPanel()
    expect(screen.getByRole('region')).toHaveAttribute('data-mode', 'overlay')
    expect(setDocked).not.toHaveBeenCalled()
  })

  it('fills a phone screen as a modal sheet with a back arrow and contained focus', async () => {
    widthIs(390)
    const { onClose } = renderPanel()
    const region = screen.getByRole('dialog')
    expect(region).toHaveAttribute('data-mode', 'full')
    expect(region).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(region.contains(document.activeElement)).toBe(true))
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('offers previous and next only where there is one', () => {
    widthIs(1440)
    const { onNext } = renderPanel()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('closes on Escape, and keeps it from the page so the list does not act twice', () => {
    widthIs(1440)
    const { onClose } = renderPanel()
    const page = vi.fn()
    document.addEventListener('keydown', page)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Source' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(page).not.toHaveBeenCalled()
    document.removeEventListener('keydown', page)
  })

  it('keeps the arrows inside, to scroll it, and lets j and k through to the list', () => {
    widthIs(1440)
    renderPanel()
    const page = vi.fn()
    document.addEventListener('keydown', page)
    const tab = screen.getByRole('tab', { name: 'Source' })
    fireEvent.keyDown(tab, { key: 'ArrowDown' })
    expect(page).not.toHaveBeenCalled()
    fireEvent.keyDown(tab, { key: 'j' })
    expect(page).toHaveBeenCalledOnce()
    document.removeEventListener('keydown', page)
  })

  it('leaves Escape to a menu opened from it', () => {
    widthIs(1440)
    const { onClose } = renderPanel({
      footer: (
        <div role="menu">
          <button type="button">Retire</button>
        </div>
      ),
    })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Retire' }), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a placeholder for the title while the record loads', () => {
    widthIs(1440)
    renderPanel({ title: null })
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
  })

  it('takes focus when it opens, if asked, as the assistant does', () => {
    widthIs(1440)
    renderPanel({ focusOnOpen: true })
    expect(screen.getByRole('region', { name: 'New tax rate applied in Poland' })).toHaveFocus()
  })

  it('leaves inert: it gives up the focus and its width at once, and plays its exit', () => {
    widthIs(1440)
    const setDocked = vi.fn()
    const panel = (leaving: boolean) => (
      <DockScopeContext value={setDocked}>
        <TooltipProvider>
          <DockPanel title="Assistant" focusOnOpen leaving={leaving} onClose={vi.fn()}>
            <button type="button">Send</button>
          </DockPanel>
        </TooltipProvider>
      </DockScopeContext>
    )
    const { container, rerender } = render(panel(false))
    const region = container.querySelector('[data-slot="dock-panel"]')
    expect(region).toHaveClass('dock-motion')
    expect(region).not.toHaveAttribute('inert')
    expect(region).not.toHaveAttribute('data-leaving')
    screen.getByRole('button', { name: 'Send' }).focus()
    rerender(panel(true))
    expect(region).toHaveAttribute('inert')
    expect(region).toHaveAttribute('data-leaving')
    expect(document.body).toHaveFocus()
    expect(setDocked).toHaveBeenLastCalledWith(false)
    // Opened again before its exit ends, it is the panel again, with the focus.
    rerender(panel(false))
    expect(region).not.toHaveAttribute('inert')
    expect(region).toHaveFocus()
    expect(setDocked).toHaveBeenLastCalledWith(true)
  })

  it('leaves the focus alone when it is not in the panel', () => {
    widthIs(1440)
    const outside = document.createElement('button')
    document.body.append(outside)
    const panel = (leaving: boolean) => (
      <TooltipProvider>
        <DockPanel title="Assistant" leaving={leaving} onClose={vi.fn()} />
      </TooltipProvider>
    )
    const { rerender } = render(panel(false))
    outside.focus()
    rerender(panel(true))
    expect(outside).toHaveFocus()
    outside.remove()
  })
})

describe('one panel at a time', () => {
  function Record({ covered, record = 'itm_zgk6ael1' }: { covered: boolean; record?: string }) {
    return (
      <PanelCoveredContext value={covered}>
        <TooltipProvider>
          <DockPanel title="New tax rate applied in Poland" contentKey={record} onClose={vi.fn()}>
            <button type="button">Suggest a change</button>
          </DockPanel>
        </TooltipProvider>
      </PanelCoveredContext>
    )
  }

  it('hides a record while the assistant covers it, and stays docked', () => {
    widthIs(1440)
    const setDocked = vi.fn()
    const { container, rerender } = render(
      <DockScopeContext value={setDocked}>
        <Record covered={false} />
      </DockScopeContext>,
    )
    const region = container.querySelector('[data-slot="dock-panel"]')
    expect(region).not.toHaveAttribute('hidden')
    rerender(
      <DockScopeContext value={setDocked}>
        <Record covered />
      </DockScopeContext>,
    )
    expect(region).toHaveAttribute('hidden')
    expect(setDocked).toHaveBeenCalledWith(true)
    expect(setDocked).not.toHaveBeenCalledWith(false)
  })

  it('is already there when the assistant leaves over it, so it does not open again', () => {
    widthIs(1440)
    const { container, rerender } = render(<Record covered={false} />)
    const region = container.querySelector('[data-slot="dock-panel"]')
    expect(region).not.toHaveAttribute('data-revealed')
    rerender(<Record covered />)
    rerender(<Record covered={false} />)
    expect(region).toHaveAttribute('data-revealed')
  })

  it('takes focus back where it was when shown again and focus was lost', () => {
    widthIs(1440)
    const { rerender } = render(<Record covered={false} />)
    const button = screen.getByRole('button', { name: 'Suggest a change' })
    button.focus()
    rerender(<Record covered />)
    // The assistant had focus; it closed, and focus fell to the page.
    button.blur()
    rerender(<Record covered={false} />)
    expect(button).toHaveFocus()
  })

  it('leaves focus where the person put it in the meantime', () => {
    widthIs(1440)
    const outside = document.createElement('button')
    document.body.append(outside)
    const { rerender } = render(<Record covered={false} />)
    screen.getByRole('button', { name: 'Suggest a change' }).focus()
    rerender(<Record covered />)
    outside.focus()
    rerender(<Record covered={false} />)
    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('tells the shell when a record opens, and when the next one replaces it', () => {
    widthIs(1440)
    const opened = vi.fn()
    const { rerender } = render(
      <PanelOpenedContext value={opened}>
        <Record covered={false} />
      </PanelOpenedContext>,
    )
    expect(opened).toHaveBeenCalledTimes(1)
    rerender(
      <PanelOpenedContext value={opened}>
        <Record covered={false} record="itm_jyfuvl07" />
      </PanelOpenedContext>,
    )
    expect(opened).toHaveBeenCalledTimes(2)
  })
})
