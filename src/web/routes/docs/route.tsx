import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useFoldedSidebar } from '@/components/app-shell/dock-hooks'
import { useShellActions } from '@/components/app-shell/shell-actions'
import { DocsPagesBar, DocsSidebar } from '@/components/app-shell/docs-nav'
import { useIsMobile } from '@/hooks/use-mobile'
import { docsQuery } from '@/lib/docs-sections'

export const Route = createFileRoute('/docs')({
  component: DocsMode,
})

/**
 * Docs mode (contract 8.11): while the docs are open the app's sidebar folds to its rail, as it
 * does for a record in the Workbench, and the docs' own sidebar opens beside it, in the shell's
 * side region. Below 1024 wide its bar under the header opens the same tree as a drawer.
 */
function DocsMode() {
  const phone = useIsMobile()
  useFoldedSidebar(!phone)
  const { sideRegion } = useShellActions()
  const docs = useQuery(docsQuery())
  return (
    <>
      {docs.data && sideRegion ? createPortal(<DocsSidebar docs={docs.data} />, sideRegion) : null}
      {docs.data ? <DocsPagesBar docs={docs.data} /> : null}
      <Outlet />
    </>
  )
}
