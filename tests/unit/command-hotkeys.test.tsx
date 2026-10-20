import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandHotkeys } from '@/components/app-shell/command-hotkeys'
import type { CommandContext } from '@/lib/commands'

function Harness({ context }: { context: CommandContext }) {
  return (
    <>
      <CommandHotkeys context={context} />
      <input aria-label="field" />
    </>
  )
}

function setup() {
  const context: CommandContext = {
    navigate: vi.fn(),
    setAppearance: vi.fn(),
    toggleSidebar: vi.fn(),
  }
  const view = render(<Harness context={context} />)
  return { context, user: userEvent.setup(), ...view }
}

describe('command hotkeys', () => {
  it('runs a sequence from the registry', async () => {
    const { context, user } = setup()
    await user.keyboard('g')
    await user.keyboard('l')
    expect(context.navigate).toHaveBeenCalledWith('/library')
  })

  it('runs sequences that share a first key', async () => {
    const { context, user } = setup()
    await user.keyboard('gl')
    await user.keyboard('gh')
    await user.keyboard('gs')
    expect(context.navigate).toHaveBeenNthCalledWith(1, '/library')
    expect(context.navigate).toHaveBeenNthCalledWith(2, '/')
    expect(context.navigate).toHaveBeenNthCalledWith(3, '/settings')
  })

  it('runs a modifier combination from the registry', async () => {
    const { context, user } = setup()
    await user.keyboard('{Control>}b{/Control}')
    expect(context.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('uses the latest context after a re-render', async () => {
    const first = setup()
    const next: CommandContext = {
      navigate: vi.fn(),
      setAppearance: vi.fn(),
      toggleSidebar: vi.fn(),
    }
    first.rerender(<Harness context={next} />)
    await first.user.keyboard('{Control>}b{/Control}')
    expect(next.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(first.context.toggleSidebar).not.toHaveBeenCalled()
  })

  it('does not fire while typing in a field', async () => {
    const { context, user, getByLabelText } = setup()
    await user.click(getByLabelText('field'))
    await user.keyboard('gl')
    expect(context.navigate).not.toHaveBeenCalled()
  })
})

describe('scoped hotkeys', () => {
  function scoped(extra: Partial<CommandContext>) {
    const context: CommandContext = {
      navigate: vi.fn(),
      setAppearance: vi.fn(),
      toggleSidebar: vi.fn(),
      ...extra,
    }
    render(<Harness context={context} />)
    return { context, user: userEvent.setup() }
  }

  it('moves the list cursor with j, k and the arrows, and selects with x', async () => {
    const list = {
      move: vi.fn(),
      moveTo: vi.fn(),
      toggleSelected: vi.fn(),
      clear: vi.fn(() => true),
      focusSearch: vi.fn(),
      cursorItemId: () => null,
    }
    const { user } = scoped({ list })
    await user.keyboard('jk{ArrowDown}x{Shift>}J{/Shift}')
    expect(list.move.mock.calls).toEqual([[1], [-1], [1], [1, true]])
    expect(list.toggleSelected).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(list.clear).toHaveBeenCalledTimes(1)
  })

  it('asks a key checked on press when it is pressed: discard follows the focused row', async () => {
    // The list does not render again as focus moves, so the binding cannot know beforehand.
    let count = 0
    const run = vi.fn()
    const list = {
      move: vi.fn(),
      moveTo: vi.fn(),
      toggleSelected: vi.fn(),
      clear: vi.fn(() => true),
      focusSearch: vi.fn(),
      cursorItemId: () => null,
      discard: { count: () => count, run },
    }
    const { user } = scoped({ list })
    await user.keyboard('{Control>}{Backspace}{/Control}')
    expect(run).not.toHaveBeenCalled()
    count = 1
    await user.keyboard('{Control>}{Backspace}{/Control}')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('goes to the next and previous item with j and k on an item page, and up with Escape', async () => {
    const document = { itemId: 'itm_a', next: vi.fn(), previous: vi.fn() }
    const up = vi.fn()
    const { user } = scoped({ document, up })
    await user.keyboard('jjk{Escape}')
    expect(document.next).toHaveBeenCalledTimes(2)
    expect(document.previous).toHaveBeenCalledTimes(1)
    expect(up).toHaveBeenCalledTimes(1)
  })

  it('runs the page main action with Control or Command Enter, also while typing', async () => {
    const run = vi.fn()
    const { user } = scoped({ mainAction: { title: 'Send for review', run } })
    await user.click(screen.getByLabelText('field'))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does nothing with Control Enter on a page without a main action', async () => {
    const { context, user } = scoped({})
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(context.navigate).not.toHaveBeenCalled()
  })

  it('opens the owner check with y, and only while an item asks for one', async () => {
    const check = { title: 'Mark as checked', open: vi.fn() }
    const { user } = scoped({ check })
    await user.keyboard('y')
    expect(check.open).toHaveBeenCalledTimes(1)
    const none = scoped({})
    await none.user.keyboard('y')
    expect(none.context.navigate).not.toHaveBeenCalled()
  })

  it('lets the second key of a sequence end it, not run alone (g then a is not Accept)', async () => {
    const review = { canOpen: () => true, open: vi.fn(), next: null, previous: null }
    const check = { title: 'Mark as checked', open: vi.fn() }
    const { context, user } = scoped({ review, check })
    await user.keyboard('ga')
    expect(context.navigate).toHaveBeenCalledWith('/assistant')
    expect(review.open).not.toHaveBeenCalled()
    await user.keyboard('gy')
    expect(context.navigate).toHaveBeenLastCalledWith('/settings', { section: 'connect' })
    expect(check.open).not.toHaveBeenCalled()
    // Alone, the keys still open their dialogs.
    await user.keyboard('ay')
    expect(review.open).toHaveBeenCalledWith('accept')
    expect(check.open).toHaveBeenCalledTimes(1)
  })

  it('does nothing with j when no list or item is shown', async () => {
    const { context, user } = scoped({})
    await user.keyboard('jk')
    expect(context.navigate).not.toHaveBeenCalled()
  })

  it('leaves Escape and the arrows to an open menu or dialog', async () => {
    const document = { itemId: 'itm_a', next: vi.fn(), previous: vi.fn() }
    const up = vi.fn()
    const { user } = scoped({ document, up })
    const dialog = window.document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    window.document.body.append(dialog)
    await user.keyboard('{Escape}j')
    expect(up).not.toHaveBeenCalled()
    expect(document.next).not.toHaveBeenCalled()
    dialog.remove()
  })

  it('keeps working beside a closed combobox, whose listbox waits hidden in the page', async () => {
    const { context, user } = setup()
    const listbox = window.document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    listbox.hidden = true
    window.document.body.append(listbox)
    await user.keyboard('gl')
    expect(context.navigate).toHaveBeenCalledWith('/library')
    listbox.hidden = false
    await user.keyboard('gh')
    expect(context.navigate).toHaveBeenCalledTimes(1)
    listbox.remove()
  })
})
