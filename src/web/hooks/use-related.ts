import { useQuery } from '@tanstack/react-query'
import type { Related } from '@/api/client'
import { relatedQuery } from '@/api/queries'

const NONE: Related = { links: [], following: true }

/**
 * The links of a context item or a definition, as they stand: what get_related follows, and
 * whether agents follow links now. Nothing until the read answers, so Related shows once it has.
 */
export function useRelated(id: string): Related {
  return useQuery({ ...relatedQuery(id), enabled: id !== '' }).data ?? NONE
}
