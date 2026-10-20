import { useEffect, useState, useSyncExternalStore } from 'react'
import { XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { HoverCard, HoverCardContent } from '@/components/ui/hover-card'
import { previewTypeNames, type PreviewTarget } from '@/lib/preview'
import { PreviewBody, previewLabel, usePreviewName } from './preview-card'
import {
  previewHandle,
  previewHostMounted,
  previewHostUnmounted,
  previewSheet,
} from './preview-trigger'

/*
  The one preview card and the one bottom sheet of the app (the editor design, section 6), which
  every `PreviewTrigger` opens. The shell loads this when the browser is idle, so the first load
  carries only the triggers.
*/

/** The room the card leaves free at the bottom: the assistant launcher and a bar stuck there. */
const GAP = 8

/**
 * How far from the window's bottom edge the card must stay: above the assistant launcher and above
 * a bar stuck to the bottom of the page (the review's decision bar, a form's action bar), so the
 * card never covers either. The card flips above its chip when there is no room below.
 */
export function bottomClearance(): number {
  const height = window.innerHeight
  let top = height
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-slot=assistant-launcher], [data-slot=page-sticky-bar], [data-slot=decision-bar]',
  )) {
    const rect = element.getBoundingClientRect()
    if (rect.height > 0 && rect.bottom >= height - 1 - 64 && rect.top < top) top = rect.top
  }
  return Math.max(GAP, height - top + GAP)
}

function SheetTitle({ target }: { target: PreviewTarget }) {
  const name = usePreviewName(target)
  return <DrawerTitle>{name ?? previewTypeNames[target.type]}</DrawerTitle>
}

export function PreviewHost() {
  const sheet = useSyncExternalStore(previewSheet.subscribe, previewSheet.get, previewSheet.get)
  const shown = sheet.target
  const [clearance, setClearance] = useState(GAP)
  // A chip hovered or focused before this chunk arrived gets its card now.
  useEffect(() => {
    const cancel = previewHostMounted((id) => previewHandle.open(id))
    return () => {
      cancel()
      previewHostUnmounted()
    }
  }, [])

  return (
    <>
      <HoverCard<PreviewTarget>
        handle={previewHandle}
        onOpenChange={(open) => {
          if (open) setClearance(bottomClearance())
        }}
      >
        {({ payload }) =>
          payload ? (
            <HoverCardContent
              aria-label={previewLabel(payload)}
              data-slot="preview-card"
              data-preview={payload.type}
              sideOffset={6}
              collisionPadding={{ top: GAP, right: GAP, left: GAP, bottom: clearance }}
              className="gap-3"
            >
              <PreviewBody target={payload} variant="card" />
            </HoverCardContent>
          ) : null
        }
      </HoverCard>
      <Drawer
        open={sheet.open}
        onOpenChange={(open) => {
          if (!open) previewSheet.close()
        }}
      >
        {shown ? (
          <DrawerContent data-slot="preview-sheet" data-preview={shown.type}>
            <DrawerHeader className="flex-row items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <DrawerDescription className="text-caption">
                  Quick look · {previewTypeNames[shown.type]}
                </DrawerDescription>
                <SheetTitle target={shown} />
              </div>
              <DrawerClose render={<Button variant="ghost" size="icon-touch" aria-label="Close" />}>
                <XIcon aria-hidden="true" />
              </DrawerClose>
            </DrawerHeader>
            <PreviewBody target={shown} variant="sheet" onDone={() => previewSheet.close()} />
          </DrawerContent>
        ) : null}
      </Drawer>
    </>
  )
}
