import { Link } from '@tanstack/react-router'
import { Page, PageContent } from '@/components/page/page'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'

/** An address no page answers to; the trail names the place it was under, when there is one. */
export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <PageContent>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>This page doesn't exist</EmptyTitle>
            <EmptyDescription>
              The address may be mistyped or the page may have moved.
            </EmptyDescription>
          </EmptyHeader>
          <Button render={<Link to="/" />}>Go to Home</Button>
        </Empty>
      </PageContent>
    </Page>
  )
}
