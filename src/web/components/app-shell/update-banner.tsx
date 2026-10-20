import { RefreshCwIcon, TriangleAlertIcon } from '@/components/icons'
import { updateAdvice } from '@/api/api-version'
import { Button } from '@/components/ui/button'
import { useOutdated } from '@/hooks/use-outdated'

/**
 * The banner every signed-in person sees while the app and the service come from different code
 * (api/api-version.ts): an update where one side was not started again. It says which, and what
 * to do: reload an old page, or start the service again. It goes once the service answers with
 * the app's own contract again.
 */
export function UpdateBanner() {
  const side = useOutdated()
  if (!side || side === 'checking') return null
  return (
    <section
      aria-label="The app was updated"
      role="status"
      data-slot="update-banner"
      className="flex flex-wrap items-center gap-3 border-b border-status-warning-border bg-status-warning-bg px-gutter py-3 text-body text-status-warning-fg"
    >
      <TriangleAlertIcon aria-hidden className="size-5 shrink-0 text-status-warning-icon" />
      <p className="min-w-0 flex-1">{updateAdvice(side)}</p>
      {side === 'page' ? (
        <Button
          variant="outline"
          size="sm"
          className="max-md:w-full"
          onClick={() => window.location.reload()}
        >
          <RefreshCwIcon aria-hidden />
          Reload
        </Button>
      ) : null}
    </section>
  )
}
