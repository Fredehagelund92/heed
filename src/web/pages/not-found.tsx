import { Page } from '@/components/site-header'
import { buttonVariants } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { useRoute } from '@/lib/router'

/** An address the app does not know: it says so, under the address that was asked for. */
export function NotFoundPage() {
  const { path } = useRoute()
  return (
    <Page title="Page not found">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>There is no page at this address</EmptyTitle>
          <EmptyDescription className="wrap-anywhere">
            Nothing lives at {path}. The link may be old or mistyped.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <a href="/inbox" className={buttonVariants({ size: 'sm' })}>
            Go to the Inbox
          </a>
        </EmptyContent>
      </Empty>
    </Page>
  )
}
