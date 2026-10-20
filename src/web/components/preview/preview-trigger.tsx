import { useId, useRef, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { PreviewCard } from '@base-ui/react/preview-card'
import type { PreviewTarget } from '@/lib/preview'

/*
  The trigger half of the chip previews (the editor design, section 6): every chip that can be
  previewed renders through `PreviewTrigger`, which hands its target to the one card the shell
  mounts (`PreviewHost`, loaded when the browser is idle). One card for the whole app: a page of
  chips adds no popups and no requests until one opens.

  On a mouse the card opens after 300 ms of hover and closes when the pointer leaves it and the
  chip; a keyboard focus opens it too, and Escape closes it. On touch there is no hover, so a tap
  opens the same content as a bottom sheet instead of following the chip's link; the sheet's Open
  follows it. The chip stays the link and works without the card.
*/

/** How long the pointer rests on a chip before its card opens (contract 5, the term hover card). */
export const PREVIEW_OPEN_DELAY = 300

/** How long the card stays once the pointer leaves, so it can be reached across the gap. */
export const PREVIEW_CLOSE_DELAY = 150

/** The one card every trigger opens. */
export const previewHandle = PreviewCard.createHandle<PreviewTarget>()

type Listener = () => void
export type SheetState = { target: PreviewTarget | null; open: boolean }
let sheet: SheetState = { target: null, open: false }
const listeners = new Set<Listener>()
const publish = (next: SheetState) => {
  sheet = next
  listeners.forEach((listener) => listener())
}

/**
 * The bottom sheet on touch: a tap on a chip opens it with the chip's target; closing keeps the
 * target, so the sheet still has its contents while it slides away.
 */
export const previewSheet = {
  get: (): SheetState => sheet,
  open: (target: PreviewTarget) => publish({ target, open: true }),
  close: () => {
    if (sheet.open) publish({ ...sheet, open: false })
  },
  subscribe: (listener: Listener) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

/*
  The card's root lives in the host, a chunk the shell loads after the first load. A chip hovered
  or focused before it arrives is remembered, and the host opens its card when it mounts if the
  chip is still hovered or focused, so an early hover is never lost.
*/
let hostReady = false
let waiting: string | null = null

/**
 * Called by the host once its root is mounted. Calls `open` with the chip that was waiting for its
 * card after the usual delay, if the chip is still hovered or focused then. Returns a cancel.
 */
export function previewHostMounted(open: (id: string) => void): () => void {
  hostReady = true
  const id = waiting
  waiting = null
  if (!id) return () => undefined
  const timer = window.setTimeout(() => {
    const element = document.getElementById(id)
    if (element && (element.matches(':hover') || element.matches(':focus-visible'))) open(id)
  }, PREVIEW_OPEN_DELAY)
  return () => window.clearTimeout(timer)
}

/** Called by the host when it unmounts (a story or a test that renders it again). */
export function previewHostUnmounted() {
  hostReady = false
}

type TriggerProps = Omit<ComponentProps<'a'>, 'children'> & {
  /** What the chip points at. */
  preview: PreviewTarget
  /**
   * The element the trigger renders: a router `Link` for a chip that goes somewhere, a `span`
   * for a chip whose click does something else (a chip in an editor). A link by default.
   */
  render?: ReactElement
  /** False where a tap must keep doing what it does today, such as a chip inside an editor. */
  sheet?: boolean
  /** Left out when a `render` prop of a badge supplies the element: the badge gives its own. */
  children?: ReactNode
}

/**
 * A chip that previews `preview`: hover or focus opens the card, a tap on touch opens the sheet.
 * Any props go to the rendered element, so a `Link`'s `to` and `className` stay where they were.
 */
export function PreviewTrigger({
  preview,
  render,
  sheet = true,
  children,
  ...props
}: TriggerProps) {
  const pointer = useRef<string>('mouse')
  const id = useId()
  const wait = () => {
    if (!hostReady) waiting = id
  }
  const stopWaiting = () => {
    if (waiting === id) waiting = null
  }
  return (
    <PreviewCard.Trigger
      id={id}
      handle={previewHandle}
      payload={preview}
      delay={PREVIEW_OPEN_DELAY}
      closeDelay={PREVIEW_CLOSE_DELAY}
      render={render}
      data-slot="preview-trigger"
      data-preview={preview.type}
      {...props}
      onPointerDown={(event) => {
        pointer.current = event.pointerType
        props.onPointerDown?.(event)
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') wait()
        props.onPointerEnter?.(event)
      }}
      onPointerLeave={(event) => {
        stopWaiting()
        props.onPointerLeave?.(event)
      }}
      onFocus={(event) => {
        // Only a keyboard focus waits for the card. A tap focuses the chip too, and leaves it
        // :hover on a touch screen, so the host would open the card over the tap's sheet.
        if (event.currentTarget.matches(':focus-visible')) wait()
        props.onFocus?.(event)
      }}
      onBlur={(event) => {
        stopWaiting()
        props.onBlur?.(event)
      }}
      // In the capture phase, so a router link sees the press as handled and stays put.
      onClickCapture={(event) => {
        if (sheet && pointer.current === 'touch' && !event.defaultPrevented) {
          event.preventDefault()
          previewSheet.open(preview)
        }
        props.onClickCapture?.(event)
      }}
    >
      {children}
    </PreviewCard.Trigger>
  )
}
