import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, CircleStopIcon } from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { Button } from '@/components/ui/button'
import { stopHeadline } from '@/lib/editions'
import { formatMoment } from '@/lib/library'
import { usePermissions } from '@/lib/use-session'
import { useStops } from '@/components/editions/use-stops'

/**
 * The banner every signed-in person sees while a stop switch is on (FR-805, plan call 5): what is
 * stopped, since when and why. It sits under the shell header on every page and is read again
 * every minute, so a stop or a restart shows without a reload. An administrator also gets the way
 * to the Editions page, where sharing starts again.
 */
export function DeliveryBanner() {
  const { stops } = useStops()
  const { isAdmin } = usePermissions()
  if (stops.length === 0) return null
  return (
    <section
      aria-label="Sharing stopped"
      data-slot="delivery-banner"
      className="flex flex-wrap items-start gap-3 border-b border-status-warning-border bg-status-warning-bg px-gutter py-3 text-body text-status-warning-fg"
    >
      <CircleStopIcon aria-hidden className="size-5 shrink-0 text-status-warning-icon" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <ul className="flex min-w-0 flex-col gap-2">
          {stops.map((stop) => (
            <li key={`${stop.scope}:${stop.areaId ?? ''}:${stop.itemId ?? ''}`} className="min-w-0">
              <p className="font-bold">{stopHeadline(stop.target)}</p>
              <p className="text-dense">
                Since {formatMoment(stop.at)}
                {stop.reason ? <>. Why: {stop.reason}</> : null}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-dense">
          <HelpLink to="editions#the-stop-switch" className="text-current">
            What stopping does
          </HelpLink>
        </p>
      </div>
      {isAdmin ? (
        <Button
          variant="outline"
          size="sm"
          className="max-md:w-full"
          render={<Link to="/editions" />}
        >
          {/* eslint-disable-next-line heed/plain-words -- the name of the page it opens */}
          Open Editions
          <ArrowRightIcon aria-hidden data-icon="inline-end" />
        </Button>
      ) : null}
    </section>
  )
}
