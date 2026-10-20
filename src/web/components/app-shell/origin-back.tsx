import type { MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon, ChevronLeftIcon } from '@/components/icons'

/**
 * Back to origin (contract 8.11 and 9.11): on a page opened from a page that is not on its
 * trail, "← What changed" before the trail, with a hairline after it; on a phone the one control
 * beside the menu, "‹ What changed". Its link is the origin's address; `onClick` goes back there
 * (back, when it is the entry behind).
 */
export function OriginBack({
  label,
  href,
  onClick,
}: {
  label: string
  href: string
  onClick: (event: MouseEvent) => void
}) {
  const link = <a href={href} onClick={onClick} />
  const name = `Back to ${label}`
  return (
    <>
      <Button
        variant="ghost"
        size="toolbar"
        render={link}
        aria-label={name}
        data-slot="origin-back"
        data-edge="start"
        className="bg-muted pl-2 hover:bg-accent max-md:hidden"
      >
        <ArrowLeftIcon />
        <span className="truncate">{label}</span>
      </Button>
      <span aria-hidden className="h-4 w-px shrink-0 bg-border max-md:hidden" />
      <Button
        variant="ghost"
        size="touch"
        render={link}
        aria-label={name}
        className="min-w-0 px-2 md:hidden"
      >
        <ChevronLeftIcon />
        <span className="truncate">{label}</span>
      </Button>
    </>
  )
}
