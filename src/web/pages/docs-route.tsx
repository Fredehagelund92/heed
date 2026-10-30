import { DocsSite } from '@/pages/docs'
import { navigate, useRoute } from '@/lib/router'

/** The documentation inside the app, at /docs: the page the address names, through the app's router. */
export function DocsRoute() {
  const { parts, query } = useRoute()
  return <DocsSite slug={parts[1]} query={query} go={(href) => navigate(href)} />
}
