// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { FoldTrigger } from '@/components/heed/fold'

// The one trigger of the section folds, Details, panel groups and inline toggles: it opens the collapsible around it, names what the fold holds
// and describes it with its summary, keeps a header fold's name for a screen reader, and serves a
// reveal that is not a collapsible with the state it is given.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

function render(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host.querySelector('button')!
}

const fold = (trigger: React.ReactNode) =>
  React.createElement(
    Collapsible,
    null,
    trigger,
    React.createElement(CollapsibleContent, { keepMounted: true }, 'Inside'),
  )

describe('FoldTrigger', () => {
  it('opens its fold, and describes it with the summary while the name stays what it holds', () => {
    const button = render(
      fold(React.createElement(FoldTrigger, { label: 'Details', summary: 'Kind, Status' })),
    )
    expect(button.getAttribute('aria-expanded')).toBe('false')
    const summary = document.getElementById(button.getAttribute('aria-describedby')!)
    expect(summary?.textContent).toBe('Kind, Status')
    expect(button.textContent).toBe('DetailsKind, Status')
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    act(() => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.hasAttribute('aria-describedby')).toBe(false)
    act(() => button.click())
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Kind, Status',
    )
  })

  it("keeps a description its caller names, as the context item's row does", () => {
    const button = render(
      fold(
        React.createElement(FoldTrigger, {
          label: 'Title',
          summary: 'Muted',
          'aria-describedby': 'meta',
        }),
      ),
    )
    expect(button.getAttribute('aria-describedby')).toBe('meta')
    act(() => button.click())
    expect(button.getAttribute('aria-describedby')).toBe('meta')
  })

  it("names a header fold to a screen reader only, its chevron the header's target", () => {
    const button = render(
      fold(React.createElement(FoldTrigger, { variant: 'header', label: 'Show or hide Agents' })),
    )
    expect(button.querySelector('.sr-only')?.textContent).toBe('Show or hide Agents')
    expect(button.className).toContain('after:inset-0')
  })

  it('serves a reveal that is not a collapsible with the state it is given', () => {
    const onClick = vi.fn()
    const button = render(
      React.createElement(FoldTrigger, {
        variant: 'inline',
        label: 'Show 4 unchanged lines',
        expanded: false,
        onClick,
      }),
    )
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    act(() => button.click())
    expect(onClick).toHaveBeenCalledOnce()
  })
})
