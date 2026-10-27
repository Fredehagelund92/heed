/**
 * The page an address of the static docs site opens: `/docs/privacy` (or `privacy.html`, or
 * `privacy/`) is `privacy`, and the base alone is the landing page.
 */
export function slugAt(pathname: string, base: string): string | undefined {
  if (!pathname.startsWith(base)) return undefined
  const rest = pathname
    .slice(base.length)
    .replace(/^\/+|\/+$/g, '')
    .replace(/(^|\/)index\.html$/, '')
    .replace(/\.html$/, '')
  return rest || undefined
}
