import * as React from 'react'
import { CircleAlertIcon } from '@/components/icons'
import { ApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { LoadError } from '@/components/heed/load-state'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

// Catches a screen that fails to render or to load (a lazy chunk the server no longer serves), so
// one broken page shows what happened and a way back instead of blanking the whole app. A read the
// service failed or never answered is said as that, with Retry, which reads it again (`onRetry`
// resets the failed reads, then the screen draws again and waits for them in its skeleton).
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onRetry?: () => void },
  { error: Error | null }
> {
  override state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error) {
    console.error('[heed] a screen failed:', error)
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    const { onRetry } = this.props
    if (
      onRetry &&
      error instanceof ApiError &&
      (error.kind === 'failed' || error.kind === 'unanswered')
    )
      return (
        <div className="flex h-full items-center justify-center p-4">
          <LoadError
            what="this page"
            className="max-w-lg"
            onRetry={() => {
              onRetry()
              this.setState({ error: null })
            }}
          />
        </div>
      )
    const load =
      /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
        error.message,
      )
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{load ? "This page didn't load" : 'This page hit an error'}</EmptyTitle>
          <EmptyDescription>
            {load
              ? "This page's code couldn't be fetched. If you run the app locally, check that the dev server is still running, then reload."
              : 'Something on this page failed. Reload to start the demo again.'}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </EmptyContent>
      </Empty>
    )
  }
}
