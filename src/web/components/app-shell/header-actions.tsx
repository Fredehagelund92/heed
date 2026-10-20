import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useShellActions } from './shell-actions'

/**
 * A page's own header actions (contract 8.11: on a document page, the page's actions come
 * first on the right of the header). Rendered into the shell header, before Search. Phones keep
 * them in the page's own action bar at the bottom (contract 8.5), unless the page has none
 * (`phone`): the assistant's pages keep their Dock button in the header.
 */
export function HeaderActions({
  phone = false,
  children,
}: {
  phone?: boolean
  children: ReactNode
}) {
  const { headerActions } = useShellActions()
  return headerActions
    ? createPortal(
        <div className={cn('flex items-center gap-2', !phone && 'max-md:hidden')}>{children}</div>,
        headerActions,
      )
    : null
}
