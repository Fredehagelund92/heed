import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { api, type Edition } from '@/api'
import {
  CircleStopIcon,
  DownloadIcon,
  EllipsisIcon,
  FileTextIcon,
  GitCompareArrowsIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePendingIndicator } from '@/hooks/use-pending-indicator'
import { editionChanges } from '@/lib/edition-feed'
import { showToast } from '@/lib/toast'
import { usePermissions } from '@/lib/use-session'
import { RollbackDialog, StopDeliveryDialog } from './release-dialogs'

/** Saves an edition as one JSON document (NFR-045), named after its number. */
export async function downloadEdition(label: string) {
  const document = await api.exportEdition(label)
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(window.document.createElement('a'), {
    href: url,
    download: `edition-${label}.json`,
  })
  link.click()
  // The download has started from the link; the object URL is not needed after that.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Export JSON: a pending spinner while the edition is read, and a toast if it fails. */
export function ExportButton({
  label,
  className,
  children = 'Export JSON',
}: {
  label: string
  className?: string
  children?: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const spinning = usePendingIndicator(busy)
  return (
    <Button
      variant="outline"
      className={className}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (busy) return
        setBusy(true)
        downloadEdition(label)
          .catch((error: unknown) =>
            showToast(
              "Couldn't download the export",
              error instanceof Error ? error.message : 'Try again.',
            ),
          )
          .finally(() => setBusy(false))
      }}
    >
      {spinning ? (
        <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
      ) : (
        <DownloadIcon aria-hidden />
      )}
      {children}
    </Button>
  )
}

/**
 * The overflow menu of an edition (contract 8.2; Editions design, slice S5). On a row of the
 * table and in the docked panel: what changed, its page and export. On the live card: its page.
 * On the edition's own page, which shows the rest: only the guarded action. For an administrator,
 * below a divider, the guarded action: going back to an earlier edition, or stopping delivery
 * from the live one. Each opens a dialog that shows the real effect before it can be confirmed.
 */
export function EditionRowMenu({
  edition,
  place = 'row',
  className,
}: {
  edition: Edition
  place?: 'row' | 'page' | 'card'
  className?: string
}) {
  const { isAdmin } = usePermissions()
  const [rollback, setRollback] = useState(false)
  const [stopping, setStopping] = useState(false)
  if (place === 'page' && !isAdmin) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={place === 'row' ? 'ghost' : 'outline'}
              size={place === 'row' ? 'icon-sm' : 'icon'}
              aria-label={
                place === 'card'
                  ? 'More actions for this edition'
                  : `Actions for edition ${edition.label}`
              }
              className={className}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-menu">
          {place === 'row' ? (
            <DropdownMenuItem
              render={<Link to="/editions/compare" search={editionChanges(edition.label)} />}
            >
              <GitCompareArrowsIcon />
              What changed
            </DropdownMenuItem>
          ) : null}
          {place === 'page' ? null : (
            <DropdownMenuItem
              render={<Link to="/editions/$label" params={{ label: edition.label }} />}
            >
              <FileTextIcon />
              Open edition
            </DropdownMenuItem>
          )}
          {place === 'row' ? (
            <DropdownMenuItem
              onClick={() => {
                downloadEdition(edition.label).catch((error: unknown) =>
                  showToast(
                    "Couldn't download the export",
                    error instanceof Error ? error.message : 'Try again.',
                  ),
                )
              }}
            >
              <DownloadIcon />
              Export JSON
            </DropdownMenuItem>
          ) : null}
          {isAdmin ? (
            <>
              {place === 'page' ? null : <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuLabel>Two steps, nothing deleted</DropdownMenuLabel>
                {edition.live ? (
                  <DropdownMenuItem variant="destructive" onClick={() => setStopping(true)}>
                    <CircleStopIcon />
                    Stop sharing…
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" onClick={() => setRollback(true)}>
                    <RotateCcwIcon />
                    Go back to this edition…
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {isAdmin && !edition.live ? (
        <RollbackDialog label={edition.label} open={rollback} onOpenChange={setRollback} />
      ) : null}
      {isAdmin && edition.live ? (
        <StopDeliveryDialog open={stopping} onOpenChange={setStopping} />
      ) : null}
    </>
  )
}
