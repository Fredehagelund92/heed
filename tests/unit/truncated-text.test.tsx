import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DomainBadge } from '@/components/item/item-marks'
import { TruncatedText } from '@/components/ui/truncated-text'

/*
  Truncated text keeps the whole text one step away (contract 7.1): a cut domain name, or a cut
  line of text, opens the whole text as a tooltip and sits over its row's link so a pointer can
  rest on it. jsdom lays nothing out, so each test says how wide the text and its box are.
*/

function measure(text: number, box: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(text)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(box)
}

afterEach(() => vi.restoreAllMocks())

/** The tooltip's words, once it opens (350 ms after the pointer rests). */
async function tooltip() {
  return waitFor(
    () => {
      const popup = document.querySelector('[data-slot="tooltip-content"]')
      expect(popup).not.toBeNull()
      return popup!
    },
    { timeout: 2000 },
  )
}

const long = 'Regulatory Reporting, Returns, Repairs and Customer Protection Operations'

describe('a cut domain name', () => {
  it('opens the whole name as a tooltip and rises over the row link', async () => {
    measure(414, 105)
    render(<DomainBadge name={long} label="gray" size="sm" />)
    const badge = screen.getByText(long).parentElement!
    expect(badge).toHaveAttribute('data-cut')
    expect(badge).toHaveClass('relative', 'z-raised')
    await userEvent.hover(badge)
    expect(await tooltip()).toHaveTextContent(long)
  })

  it('stays a plain badge while the name fits', () => {
    measure(94, 94)
    render(<DomainBadge name="Search & Markets" label="violet" size="sm" />)
    const badge = screen.getByText('Search & Markets').parentElement!
    expect(badge).not.toHaveAttribute('data-cut')
    expect(badge).not.toHaveClass('z-raised')
  })
})

describe('TruncatedText', () => {
  it('names the whole text in a tooltip while it is cut, and is plain text while it fits', async () => {
    measure(300, 120)
    const { rerender } = render(<TruncatedText text={`Run ${long}`} />)
    const line = screen.getByText(`Run ${long}`)
    expect(line).toHaveAttribute('data-cut')
    await userEvent.hover(line)
    expect(await tooltip()).toHaveTextContent(`Run ${long}`)
    measure(60, 120)
    rerender(<TruncatedText text="Run Commercial" />)
    expect(screen.getByText('Run Commercial')).not.toHaveAttribute('data-cut')
  })
})
