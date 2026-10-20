import { Fragment, lazy, Suspense, type MouseEvent } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons'
import type { Crumb } from '@/lib/crumbs'
import { cn } from '@/lib/utils'
import { OriginBack } from './origin-back'
import { goToOrigin, goUp, plainClick } from './trail'
import { useOrigin, useTrail } from './trail-context'

// The list's search index stays in the item route's lazy graph.
const ItemCrumb = lazy(() => import('@/components/item/item-breadcrumb'))

/** A crumb's link: its page, as the person last left that list. */
export const crumbLink = (crumb: Crumb, onClick?: (event: MouseEvent) => void) => (
  <Link
    to={crumb.to as '/'}
    params={crumb.params as never}
    search={crumb.search as never}
    onClick={onClick}
  />
)

/**
 * The trail (contract 8.6, 8.11 and 9.11) from the crumb tree (lib/crumbs.ts): the sidebar place
 * first, then each page above this one, which opens its list as the person left it, then the
 * page, or its section, as plain text. On list and overview pages the last crumb is the page
 * title; a record page ends with the record's short identity, and an item opened from a list
 * adds its position there.
 *
 * A page opened from a page that is not on its trail (an item from What changed) shows
 * "← What changed" before the trail: back there, by going back when it is the entry behind.
 *
 * A phone has room for one control beside the menu: a top-level place shows its title, anything
 * deeper shows "‹ origin" when there is one, else "‹ parent", which goes up one level (back,
 * when the parent is the entry behind).
 */
export function AppBreadcrumbs() {
  const router = useRouter()
  const crumbs = useTrail()
  const origin = useOrigin()
  const last = crumbs.length - 1
  const parent = crumbs[last - 1]
  return (
    <>
      {origin ? (
        <OriginBack
          label={origin.label}
          href={origin.href}
          // A plain click goes back there; a modified one opens its address as links do.
          onClick={(event) => {
            if (!plainClick(event)) return
            event.preventDefault()
            goToOrigin(router, origin)
          }}
        />
      ) : null}
      <Breadcrumb
        className={cn('min-w-0', parent && 'max-md:hidden')}
        data-edge={origin ? undefined : 'start'}
      >
        <BreadcrumbList className="flex-nowrap md:text-body">
          {crumbs.map((crumb, index) => (
            <Fragment key={index}>
              {index > 0 ? (
                <BreadcrumbSeparator>
                  <ChevronRightIcon />
                </BreadcrumbSeparator>
              ) : null}
              <BreadcrumbItem className="min-w-0">
                {index === last ? (
                  <BreadcrumbPage
                    className={cn(
                      'truncate',
                      crumb.mono ? 'font-mono text-caption text-muted-foreground' : 'font-bold',
                    )}
                  >
                    {crumb.itemId ? (
                      <Suspense fallback={crumb.label}>
                        <ItemCrumb kind={crumb.label} itemId={crumb.itemId} />
                      </Suspense>
                    ) : (
                      crumb.label
                    )}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={crumbLink(crumb)} className="truncate">
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      {parent && !origin ? (
        <Button
          variant="ghost"
          size="touch"
          // A plain click goes up; a modified one opens the parent's link as links do.
          render={crumbLink(parent, (event) => {
            if (!plainClick(event)) return
            event.preventDefault()
            goUp(router, parent)
          })}
          aria-label={`Back to ${parent.label}`}
          className="min-w-0 shrink px-2 md:hidden"
        >
          <ChevronLeftIcon />
          <span className="truncate">{parent.label}</span>
        </Button>
      ) : null}
    </>
  )
}
