import { useEffect, useRef, type RefObject } from 'react'
import { BotIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatHotkey } from '@/lib/commands'
import { cn } from '@/lib/utils'
import { useShellActions } from './shell-actions'

/** Bars stuck to the bottom of a page, such as the decision bar: the launcher rises over them. */
export const LAUNCHER_CLEAR = '[data-launcher-clear]'

type Box = { top: number; right: number; bottom: number; left: number }

/**
 * How far the launcher must rise, from its place in the corner (`launcher`), so that it sits one
 * gap (the space it keeps from the window's edge) above every bar it would otherwise cover.
 */
export function launcherLift(launcher: Box, gap: number, bars: readonly Box[]): number {
  let lift = 0
  for (const bar of bars) {
    if (bar.right <= bar.left || bar.bottom <= bar.top) continue
    if (bar.right <= launcher.left || bar.left >= launcher.right) continue
    if (bar.bottom <= launcher.top - gap || bar.top >= launcher.bottom + gap) continue
    lift = Math.max(lift, Math.ceil(launcher.bottom - bar.top + gap))
  }
  return lift
}

/**
 * Keeps `--launcher-lift` on the document: the launcher and the toasts above it read it. It is
 * measured again when the page scrolls, resizes or changes, at most once a frame.
 */
function useLauncherLift(button: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = document.documentElement
    let lift = 0
    let frame = 0
    const measure = () => {
      frame = 0
      const element = button.current
      if (!element) return
      const box = element.getBoundingClientRect()
      if (!box.width) return
      // Where the launcher sits without a lift, and the gap it keeps from the window's edge.
      const corner = {
        top: box.top + lift,
        right: box.right,
        bottom: box.bottom + lift,
        left: box.left,
      }
      const gap = window.innerHeight - corner.bottom
      const bars = [...document.querySelectorAll(LAUNCHER_CLEAR)].map((bar) =>
        bar.getBoundingClientRect(),
      )
      const next = launcherLift(corner, gap, bars)
      if (next === lift) return
      lift = next
      root.style.setProperty('--launcher-lift', `${next}px`)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    schedule()
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true, characterData: true })
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    sizes?.observe(document.body)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      mutations.disconnect()
      sizes?.disconnect()
      root.style.removeProperty('--launcher-lift')
    }
  }, [button])
}

/*
  The assistant launcher: one round ink button in the bottom-right corner of every page signed
  in, which docks the assistant's panel on the right and closes it, as Command or Control
  backslash does. The shell leaves it out on the assistant's own pages, where the assistant is
  already full screen (contract 9.8). Beside a docked or overlaid panel it sits left of it, like
  the toasts; under a panel that fills a phone's screen it hides, as the panel has its own back
  arrow. A panel on its way out (`data-leaving`) no longer counts, so the launcher is back in
  its place, and can take the focus, as soon as the panel closes. It rises over a bar stuck to
  the bottom of the page (a list's totals), so it never covers one, and every page keeps room for
  it at its end. A bar that holds it (`AssistantBarButton`, the review's decision bar) takes it
  out of the corner while that bar shows: risen over the bar it would float over the rail's
  controls as the page scrolls by (contract 9.8, Entry). It stays in its place there, unseen, so
  the toasts still rise over the bar with it. On a phone, a form's bar of
  actions holds it in its More menu instead (`AssistantMenuItem`, in assistant-menu-item.tsx, so
  Base UI's menu stays out of the first load), and it leaves the corner, where it would cover
  the form's last field (A7).
*/
export function AssistantLauncher({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  useLauncherLift(button)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={button}
            variant="ink"
            size="icon-lg"
            onClick={onToggle}
            aria-label="Assistant"
            aria-expanded={open}
            data-slot="assistant-launcher"
            className="fixed right-4 bottom-launcher z-selection rounded-full shadow-raised max-md:size-control-touch [&_svg:not([class*='size-'])]:size-5 max-md:[body:has([data-launcher-fold])_&]:hidden [body:has([data-slot=assistant-held])_&]:invisible [body:has([data-slot=dock-panel]:not([data-mode=full]):not([data-leaving]))_&]:right-dock [body:has([data-slot=dock-panel]:not([data-mode=full]):not([data-leaving]))_&]:-translate-x-4 [body:has([data-slot=dock-panel][data-mode=full]:not([hidden]):not([data-leaving]))_&]:hidden"
          />
        }
      >
        <BotIcon />
      </TooltipTrigger>
      <TooltipContent side="left">
        Assistant ({formatHotkey('mod+backslash').join('')})
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The launcher held at the start of a bar stuck to the bottom of a page (the review's decision
 * bar): the same round ink button and the same toggle, 32 high (44 on a phone), so it covers
 * nothing as the page scrolls; the corner's launcher steps aside while it shows (contract 9.8).
 */
export function AssistantBarButton({ className }: { className?: string }) {
  const { assistantOpen, toggleAssistant } = useShellActions()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ink"
            size="icon"
            onClick={() => toggleAssistant()}
            aria-label="Assistant"
            aria-expanded={assistantOpen}
            data-slot="assistant-held"
            className={cn('rounded-full', className)}
          />
        }
      >
        <BotIcon />
      </TooltipTrigger>
      <TooltipContent side="top">
        Assistant ({formatHotkey('mod+backslash').join('')})
      </TooltipContent>
    </Tooltip>
  )
}
