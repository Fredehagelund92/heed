import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantLauncher, launcherLift } from '@/components/app-shell/assistant-launcher'
import { TooltipProvider } from '@/components/ui/tooltip'

/** A 40 pixel launcher 16 from the corner of a 1440 by 900 window. */
const launcher = { top: 844, right: 1424, bottom: 884, left: 1384 }
const box = (top: number, bottom: number, left = 256, right = 1440) => ({
  top,
  right,
  bottom,
  left,
})

describe('the launcher lift', () => {
  it('stays in the corner with no bar under it', () => {
    expect(launcherLift(launcher, 16, [])).toBe(0)
    // A bar higher up the page, or one beside the launcher, is not in its way.
    expect(launcherLift(launcher, 16, [box(400, 460)])).toBe(0)
    expect(launcherLift(launcher, 16, [box(860, 900, 256, 1000)])).toBe(0)
  })

  it('rises one gap above a bar stuck to the bottom, such as the decision bar', () => {
    // A 57 high decision bar: the launcher's bottom moves to 16 above its top.
    expect(launcherLift(launcher, 16, [box(843, 900)])).toBe(884 - 843 + 16)
    // A list's 40 high totals.
    expect(launcherLift(launcher, 16, [box(860, 900)])).toBe(40)
  })

  it('clears the tallest bar, and ignores a hidden one', () => {
    expect(launcherLift(launcher, 16, [box(860, 900), box(780, 900), box(0, 0)])).toBe(120)
    expect(launcherLift(launcher, 16, [box(900, 900)])).toBe(0)
  })

  it('rounds up, so a fraction of a pixel never overlaps', () => {
    expect(launcherLift(launcher, 16, [box(859.5, 900)])).toBe(41)
  })
})

describe('the launcher', () => {
  it('is a button named Assistant that says whether the panel is open', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <TooltipProvider>
        <AssistantLauncher open={false} onToggle={onToggle} />
      </TooltipProvider>,
    )
    const button = screen.getByRole('button', { name: 'Assistant' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('tabindex', '-1')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
    rerender(
      <TooltipProvider>
        <AssistantLauncher open onToggle={onToggle} />
      </TooltipProvider>,
    )
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps no lift on the document once it is gone', () => {
    const { unmount } = render(
      <TooltipProvider>
        <AssistantLauncher open={false} onToggle={vi.fn()} />
      </TooltipProvider>,
    )
    document.documentElement.style.setProperty('--launcher-lift', '40px')
    unmount()
    expect(document.documentElement.style.getPropertyValue('--launcher-lift')).toBe('')
  })
})
