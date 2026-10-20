import { RefreshCwIcon, TriangleAlertIcon } from '@/components/icons'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/** A read failed and nothing is cached (contract 9.5, "Error"): what failed, and Try again. */
export function LoadError({
  what,
  onRetry,
  detail,
}: {
  /** What could not be loaded, as the end of "We couldn't load …". */
  what: string
  onRetry: () => void
  detail?: string
}) {
  return (
    <Alert variant="danger" role="alert" className="max-w-reading">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertContent>
        <AlertTitle>We couldn&apos;t load {what}</AlertTitle>
        <AlertDescription>
          <p>Nothing is lost. Check your connection, then try again.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={onRetry}>
              <RefreshCwIcon />
              Try again
            </Button>
            {detail ? (
              <details className="text-caption">
                <summary className="cursor-pointer">Details for support</summary>
                {detail}
              </details>
            ) : null}
          </div>
        </AlertDescription>
      </AlertContent>
    </Alert>
  )
}
