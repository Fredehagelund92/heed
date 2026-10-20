/**
 * Sources an administrator adds (connector interface v2): the kinds they may add and an added
 * source's settings. The keys live with every other key (`queryKeys`), so adding or changing a
 * source makes these reads stale; the options live here, apart from queries.ts, so only Sources
 * loads them, not the shell.
 */
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/api'
import { queryKeys } from './queries'

/** The types of source an administrator may add, with their forms. They change with a release. */
export const sourceTypesQuery = () =>
  queryOptions({
    queryKey: queryKeys.sourceTypes,
    queryFn: () => api.listSourceTypes(),
    staleTime: Infinity,
  })

/** A source an administrator added: its settings and which secrets are set; null if none. */
export const sourceSettingsQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.sourceSettings(id), queryFn: () => api.getSourceSettings(id) })
