import type { ReactNode } from 'react'
import { LockIcon } from '@/components/icons'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import type { Audience } from '@/lib/permissions'
import { usePermissions } from '@/lib/use-session'
import { Page, PageContent } from './page'

/**
 * A page for a narrower audience than everyone (Quality design, section 0). The sidebar and the
 * palette do not offer it to anyone else, and an address opened anyway says whose page it is and
 * whom to ask, instead of the page; nothing of the page is read. While the roles load it shows a
 * line that waits, so the page never flashes a refusal. The service checks every call again.
 */
export function AudienceGate({
  audience,
  title,
  refusal,
  children,
}: {
  audience: Audience
  /** The page's title, shown as the breadcrumb and the hidden heading while refused. */
  title: string
  refusal: { title: string; description: string }
  children: ReactNode
}) {
  const { ready, isFor } = usePermissions()
  if (!ready) return <RolesPending title={title} />
  if (isFor(audience)) return children
  return (
    <Page title={title}>
      <PageContent width="overview">
        <Empty className="flex-none border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockIcon />
            </EmptyMedia>
            <EmptyTitle>{refusal.title}</EmptyTitle>
            <EmptyDescription>{refusal.description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </PageContent>
    </Page>
  )
}

/**
 * The line a page shows while the person's roles load, when what it shows depends on them: a
 * page for a narrower audience, or one that sends some people elsewhere (the Gaps page sends the
 * Workbench's people there). It waits rather than flash what may then go.
 */
export function RolesPending({ title }: { title: string }) {
  return (
    <Page title={title}>
      <PageContent width="overview">
        <Skeleton role="status" aria-label="Loading your roles" className="h-16 w-full" />
      </PageContent>
    </Page>
  )
}
