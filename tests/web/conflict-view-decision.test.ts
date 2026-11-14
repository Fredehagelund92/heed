// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// A decision on a conflict is made on what its confirm box showed. A read that brings a newer
// version of either item while the box is open closes it and says one of the two changed; the
// decision then sends the versions the box was opened on, never the ones the cache read last. A
// send cannot be cancelled halfway, and when it fails the box says so. The real view, on a fake
// binding: the service holding a stale decision is tests/integration/conflicts.test.ts.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const world = vi.hoisted(() => ({
  me: { name: 'Jon Abara', role: 'Admin', owns: ['area_sales'], admin: true },
  toasts: [] as unknown[],
}))
vi.mock('@/lib/workspace', () => ({
  useMe: () => world.me,
  useDomains: () => ({}),
}))
vi.mock('sonner', () => {
  const push = (title: unknown) => {
    world.toasts.push(title)
    return 1
  }
  return { toast: Object.assign(push, { error: push, success: push }), Toaster: () => null }
})

const { bindApi } = await import('@/api')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { ConflictView } = await import('@/components/heed/conflict-view')

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.getAnimations = () => []
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  world.toasts.length = 0
  document.body.innerHTML = ''
})

const side = (id: string, title: string, owners: string[]) => ({
  id,
  readable: true,
  title,
  summary: `${title}.`,
  kind: 'note' as const,
  domain: 'area_sales',
  domainName: 'Sales',
  owners,
  version: 1,
  checkedOn: null,
  checkedBy: null,
  source: null,
})
const pair = {
  key: 'itm_a.itm_b',
  holder: side('itm_a', 'Returns window is 30 days', ['Jon Abara']),
  other: side('itm_b', 'Returns window is 14 days', ['Nina Holt']),
  topic: 'Returns',
  where: ['Returns'],
  asked: 4,
  since: '2 Nov',
  said: null,
  rights: {
    keepHolder: true,
    keepOther: true,
    editHolder: true,
    editOther: true,
    keepBoth: true,
    notConflict: true,
  },
  keptBoth: null,
}
const row = {
  key: pair.key,
  holder: { id: 'itm_a', title: 'a', domain: 'area_sales' },
  other: { id: 'itm_b', title: 'b', domain: 'area_sales' },
  topic: 'Returns',
  asked: 4,
  since: null,
  canSettle: true,
  mine: true,
}
const decision = {
  outcome: 'kept_one',
  keptId: 'itm_a',
  reason: 'Policy',
  quote: null,
  by: 'Jon Abara',
  at: '10:40',
}

/** One step, and what React does after it (effects, settled promises), before the next. */
const step = (f: () => unknown) =>
  act(async () => {
    await f()
    await new Promise((r) => setTimeout(r, 20))
  })

async function mount(api: Record<string, unknown>) {
  bindApi(api as never, null)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await step(() =>
    root!.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(ConflictView, { pairKey: pair.key, place: 'page' }),
        ),
      ),
    ),
  )
  // The view's code and the pair are read first.
  for (let i = 0; i < 50 && !button(document, 'Keep this one'); i++) await step(() => undefined)
  return client
}

const button = (within: ParentNode, name: string | RegExp) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? ''),
  )
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')
const click = (el: Element | undefined) =>
  step(() => {
    if (!el) throw new Error('nothing to click')
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
const giveReason = (text: string) =>
  step(() => {
    const box = dialog()!.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
const changedLine = () =>
  [...document.querySelectorAll('[role=alert]')].some((el) =>
    /changed while you read/.test(el.textContent ?? ''),
  )

describe('a conflict decision is made on what its box showed', () => {
  it('a newer version read while the box is open closes it; the decision sends what was shown', async () => {
    let current = pair
    const sent: { versions?: unknown }[] = []
    const client = await mount({
      conflict: () => Promise.resolve(current),
      conflicts: () => Promise.resolve([row]),
      settleConflict: (input: { versions?: unknown }) => {
        sent.push(input)
        return Promise.resolve({ decision, undo: 'tok_1' })
      },
    })
    // Jon read version 1 of both, and opens Keep this one on the first.
    await click(button(document, 'Keep this one'))
    expect(dialog()).not.toBeNull()
    await giveReason('Policy')

    // Nina rewrites the second item; the tab reads the pair again (focus, or any write to items).
    current = {
      ...pair,
      other: { ...pair.other, version: 2, summary: 'No returns after 14 days.' },
    }
    await step(() => client.refetchQueries())

    // The box his decision was in is gone, and the page says why before anything is sent.
    expect(dialog()).toBeNull()
    expect(changedLine()).toBe(true)
    expect(sent).toHaveLength(0)

    // He looks, opens the box again on what he now sees, and decides on that.
    await click(button(document, 'Show what changed'))
    expect(changedLine()).toBe(false)
    await click(button(document, 'Keep this one'))
    expect(dialog()?.querySelector('textarea')?.value).toBe('Policy')
    await click(button(dialog()!, 'Keep this one'))
    expect(sent.map((s) => s.versions)).toEqual([{ holder: 1, other: 2 }])
  })

  it('a read that changes nothing leaves the box open, and it sends the versions it was opened on', async () => {
    const sent: { versions?: unknown }[] = []
    const client = await mount({
      conflict: () => Promise.resolve(pair),
      conflicts: () => Promise.resolve([row]),
      settleConflict: (input: { versions?: unknown }) => {
        sent.push(input)
        return Promise.resolve({ decision, undo: 'tok_2' })
      },
    })
    await click(button(document, 'Keep this one'))
    await giveReason('Policy')
    await step(() => client.refetchQueries())
    expect(dialog()).not.toBeNull()
    await click(button(dialog()!, 'Keep this one'))
    expect(sent.map((s) => s.versions)).toEqual([{ holder: 1, other: 1 }])
    expect(document.body.textContent).toContain('Kept “Returns window is 30 days”.')
  })

  it('while it is being sent the box stays; when it fails, the box says so and keeps the reason', async () => {
    let calls = 0
    let answer!: (error: Error) => void
    await mount({
      conflict: () => Promise.resolve(pair),
      conflicts: () => Promise.resolve([row]),
      settleConflict: () => {
        calls++
        return new Promise((_, reject) => (answer = reject))
      },
    })
    await click(button(document, 'Keep both'))
    await giveReason('Both hold')
    await click(button(dialog()!, 'Keep both'))

    expect(button(dialog()!, /Saving/)?.disabled).toBe(true)
    const cancel = button(dialog()!, 'Cancel')!
    expect(cancel.disabled).toBe(true)
    await click(cancel)
    await step(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(dialog()).not.toBeNull()

    await step(() => answer(new Error('The service did not answer.')))
    expect(calls).toBe(1)
    expect(dialog()).not.toBeNull()
    expect(dialog()!.querySelector('[role=alert]')?.textContent).toContain(
      "Couldn't keep both. Nothing changed. Try again.",
    )
    expect(dialog()!.querySelector('textarea')?.value).toBe('Both hold')
    expect(world.toasts).toHaveLength(0)
  })
})
