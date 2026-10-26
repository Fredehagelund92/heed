import * as React from "react"
import { useDefinitions } from "@/lib/definitions"
import { linksOf } from "@/lib/links"
import { useFacts } from "@/lib/store"

/** The links of a context item, a definition or a domain, as they stand: what get_related follows. */
export function useRelated(id: string) {
  const facts = useFacts()
  const definitions = useDefinitions()
  return React.useMemo(() => (id ? linksOf(id, { facts, definitions }) : []), [id, facts, definitions])
}
