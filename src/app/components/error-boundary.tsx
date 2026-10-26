import * as React from 'react'
import { CircleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

// Catches a screen that fails to render or to load (a lazy chunk the server no longer serves), so
// one broken page shows what happened and a way back instead of blanking the whole app.
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[heed] a screen failed:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
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
              ? "This page's code couldn't be fetched. If you run the mockup locally, check that the dev server is still running, then reload."
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
