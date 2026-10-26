import * as React from 'react'
import { useDefinitions } from '@/lib/definitions'
import { linksOf } from '@/lib/links'
import { useDomains, useFacts } from '@/lib/workspace'

/** The links of a context item, a definition or a domain, as they stand: what get_related follows. */
export function useRelated(id: string) {
  const facts = useFacts()
  const definitions = useDefinitions()
  const domains = useDomains()
  return React.useMemo(
    () => (id ? linksOf(id, { facts, definitions, domains }) : []),
    [id, facts, definitions, domains],
  )
}
