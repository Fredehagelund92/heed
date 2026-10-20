import type { ReactNode } from 'react'
import type { Icon } from '@/components/icons'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Page, PageContent } from './page'

/**
 * A placeholder page for a route that has no screen yet. It exists so the route, its typed
 * search params and its breadcrumb can be built and tested before the real screen.
 */
export function StubPage({
  title,
  description,
  icon: IconComponent,
  search,
  children,
}: {
  title: string
  description: string
  icon: Icon
  /** The parsed search params, shown so the typed URL state is visible while the screen is empty. */
  search?: Record<string, unknown>
  children?: ReactNode
}) {
  const entries = search ? Object.entries(search).filter(([, value]) => value !== undefined) : []
  return (
    <Page title={title}>
      <PageContent>
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconComponent />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
          {children}
          {search ? (
            <p data-testid="stub-search" className="font-mono text-caption text-muted-foreground">
              {entries.length > 0
                ? entries.map(([key, value]) => `${key}=${String(value)}`).join('  ')
                : 'no search params'}
            </p>
          ) : null}
        </Empty>
      </PageContent>
    </Page>
  )
}
