import * as React from 'react'
import { cn } from 'cn'
import { clamp, readWidth, saveWidth } from '@/lib/pane-width'

/**
 * A side pane whose edge can be dragged to resize it, between a minimum and a maximum, with its
 * width kept for the session. The handle tracks the pointer 1:1 from where it was grabbed and also
 * answers the arrow keys. It shows only a hairline on hover or while dragging.
 *
 * With `onCollapsedChange` the pane can also fold away, like the left nav: a click on the handle or
 * Enter folds and unfolds it, and dragging it well past the minimum folds it on release. The
 * content keeps its width while the pane folds, so it slides out of view instead of reflowing.
 * A folded pane never just disappears: pass `rail` and it folds down to that slim strip, whose
 * toggle sits where the pane's own hide button was, so the same spot opens it again.
 */
export function ResizableAside({
  side,
  storageKey,
  defaultWidth,
  min,
  max,
  label,
  collapsed = false,
  onCollapsedChange,
  rail,
  railWidth = 48,
  className,
  children,
}: {
  side: 'left' | 'right'
  storageKey: string
  defaultWidth: number
  min: number
  max: number
  label: string
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  rail?: React.ReactNode
  railWidth?: number
  className?: string
  children: React.ReactNode
}) {
  const [width, setWidth] = React.useState(() =>
    clamp(readWidth(storageKey, defaultWidth), min, max),
  )
  const [drag, setDrag] = React.useState<number | null>(null)
  const start = React.useRef({ x: 0, width, moved: false, active: false })
  const sign = side === 'left' ? 1 : -1
  const collapsible = !!onCollapsedChange
  // Past this the pane folds when let go, rather than snapping back to its minimum.
  const foldAt = min / 2
  const closed = rail ? railWidth : 0
  const folded = collapsed && drag === null

  const commit = (w: number) => {
    const next = clamp(w, min, max)
    setWidth(next)
    saveWidth(storageKey, next)
  }

  const raw = (e: React.PointerEvent) => start.current.width + sign * (e.clientX - start.current.x)
  const shown =
    drag !== null ? clamp(drag, collapsible ? closed : min, max) : collapsed ? closed : width

  return (
    <aside
      aria-label={label}
      data-collapsed={folded || undefined}
      style={{ width: shown }}
      className={cn(
        'relative shrink-0 transition-[width] duration-(--dur-3) ease-out',
        drag !== null && 'transition-none',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-full overflow-hidden transition-opacity duration-(--dur-3) ease-out',
          side === 'left' ? 'justify-end' : 'justify-start',
          folded && rail && 'opacity-0',
        )}
        inert={folded}
      >
        <div className="h-full shrink-0" style={{ width: Math.max(shown, min) }}>
          {children}
        </div>
      </div>
      {rail && (
        <div
          className={cn(
            'absolute inset-y-0 transition-opacity duration-(--dur-3) ease-out',
            side === 'left' ? 'left-0' : 'right-0',
            !folded && 'pointer-events-none opacity-0',
          )}
          style={{ width: railWidth }}
          inert={!folded}
        >
          {rail}
        </div>
      )}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label.toLowerCase()}`}
        aria-valuemin={collapsible ? closed : min}
        aria-valuemax={max}
        aria-valuenow={Math.round(shown)}
        tabIndex={0}
        title={collapsible ? `Drag to resize, click to ${collapsed ? 'show' : 'hide'}` : undefined}
        data-dragging={drag !== null || undefined}
        className={cn(
          'group/handle absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none',
          side === 'left' ? '-right-1' : '-left-1',
        )}
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = {
            x: e.clientX,
            width: collapsed ? closed : width,
            moved: false,
            active: true,
          }
          setDrag(start.current.width)
        }}
        onPointerMove={(e) => {
          if (!start.current.active) return
          if (Math.abs(e.clientX - start.current.x) > 3) start.current.moved = true
          if (start.current.moved) setDrag(raw(e))
        }}
        onPointerUp={(e) => {
          if (!start.current.active) return
          start.current.active = false
          setDrag(null)
          if (!start.current.moved) {
            if (collapsible) onCollapsedChange(!collapsed)
            return
          }
          const w = raw(e)
          if (collapsible && w < foldAt) {
            onCollapsedChange(true)
            return
          }
          commit(w)
          if (collapsed) onCollapsedChange?.(false)
        }}
        onPointerCancel={() => {
          start.current.active = false
          setDrag(null)
        }}
        onDoubleClick={() => !collapsible && commit(defaultWidth)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && collapsible) onCollapsedChange(!collapsed)
          if (collapsed) return
          if (e.key === 'ArrowLeft') commit(width - sign * 16)
          if (e.key === 'ArrowRight') commit(width + sign * 16)
        }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/handle:bg-ring/60 group-focus-visible/handle:bg-ring group-data-dragging/handle:bg-ring"
        />
      </div>
    </aside>
  )
}
