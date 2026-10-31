import * as React from 'react'
import { PRODUCT } from '@/lib/brand'

/** The browser tab's title for a page: its name, then the product's (WCAG 2.4.2). */
export const pageTitle = (name: string | null | undefined) =>
  name?.trim() ? `${name.trim()} - ${PRODUCT}` : PRODUCT

/**
 * Sets the tab's title for a page without the app's header (sign-in, the docs); a page with one
 * gets it from its heading (SiteHeader).
 */
export function usePageTitle(name: string | undefined) {
  React.useEffect(() => {
    document.title = pageTitle(name)
  }, [name])
}
