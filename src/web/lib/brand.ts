// The product's name, in one place, so a rename or a white label is a one-line change. UI wording
// never says the name: sentences say "it", "agents" or "your workspace". The name appears only where
// it is the brand: the logo's label, sign-in and the page title (index.html reads it through Vite).
// Addresses, the MCP server name and the CLI follow it.

import { productNameFrom } from '../../domain/brand.ts'

/**
 * From `CL_PRODUCT_NAME` when the app was built, the setting the service reads too
 * (src/domain/brand.ts). Outside a Vite build (the Vite config, unit tests) the process's own
 * environment says it.
 */
const built = (import.meta as { env?: { CL_PRODUCT_NAME?: string } }).env?.CL_PRODUCT_NAME
const running = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
  ?.env.CL_PRODUCT_NAME
export const PRODUCT = productNameFrom(built ?? running)
/** How a side area (Settings, and later Observability) leads back: to the app, not to a workspace's name. */
export const BACK_TO_APP = 'Back to app'

const slug = PRODUCT.toLowerCase()
export const APP_URL = `https://${slug}.example.com`
export const MCP_URL = `${APP_URL}/mcp`
/** The MCP server's name in an agent's config, and the CLI's name. */
export const SLUG = slug
/** The Google service account a Drive folder is shared with. */
export const SERVICE_ACCOUNT = `${slug}-reader@larchwood-${slug}.iam.gserviceaccount.com`
/** A key the app keeps in the browser's storage: every key starts with the product's slug, so a rename moves them together. */
export const storageKey = (name: string) => `${slug}-${name}`
