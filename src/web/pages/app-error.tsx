import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { toApiError } from '@/api/errors'
import { CircleAlertIcon } from '@/components/icons'
import { Logo } from '@/components/heed/logo'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { usePageTitle } from '@/lib/page-title'

/**
 * The whole app when it cannot start, or fails outside a page's own error boundary (App.tsx): the
 * root route's error page, in place of the router's stock one. It renders without the app's
 * providers, which are what failed. Try again draws the app again where it was, and the reads that
 * failed are read again; the page is not loaded again. A failure the service answered names its
 * request id, which an admin can look up.
 */
export function AppErrorPage({ error, reset }: ErrorComponentProps) {
  usePageTitle("Didn't open")
  const queries = useQueryErrorResetBoundary()
  const failure = toApiError(error)
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted p-4 md:p-10">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Logo className="h-8" />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>
              <h1>Your workspace didn't open</h1>
            </EmptyTitle>
            <EmptyDescription>
              {failure.kind === 'unanswered'
                ? 'It got no answer. Check your connection, then try again.'
                : 'Something failed as it opened. Nothing you saved is lost. Try again in a moment.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                queries.reset()
                reset()
              }}
            >
              Try again
            </Button>
            {failure.requestId && (
              <div className="flex flex-col items-center gap-1 text-xs">
                <p className="text-muted-foreground">
                  If it keeps happening, give your admin this request id:
                </p>
                <p className="font-mono break-all">{failure.requestId}</p>
              </div>
            )}
          </EmptyContent>
        </Empty>
      </div>
    </main>
  )
}
