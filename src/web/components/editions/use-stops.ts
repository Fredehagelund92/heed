import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ActiveStop } from '@/api'
import { areasQuery, libraryQuery, stopsQuery } from '@/api/queries'
import type { StopTarget } from '@/lib/editions'

export type NamedStop = ActiveStop & { target: StopTarget }

/**
 * The stop switches that are on, each with the name of what it stops: the domain's name, or the
 * item's title from the library index (read only while an item is stopped). Everyone signed in
 * reads them; a refusal or an error reads as "nothing to show", so the banner never blocks a page.
 */
export function useStops() {
  const stops = useQuery(stopsQuery())
  const { data: areas } = useQuery(areasQuery())
  const itemStopped = stops.data?.some((stop) => stop.scope === 'item') ?? false
  const { data: library } = useQuery({ ...libraryQuery(), enabled: itemStopped })
  const named = useMemo<NamedStop[]>(
    () =>
      (stops.data ?? []).map((stop) => ({
        ...stop,
        target: {
          scope: stop.scope,
          areaName: areas?.find((area) => area.id === stop.areaId)?.name,
          itemTitle: library?.items.find((item) => item.id === stop.itemId)?.title,
        },
      })),
    [stops.data, areas, library],
  )
  return { stops: named, pending: stops.isPending, failed: stops.isError }
}
