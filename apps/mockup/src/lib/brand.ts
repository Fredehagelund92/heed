// The product's name, in one place, so a rename or a white label is a one-line change. UI wording
// never says the name: sentences say "it", "agents" or "your workspace". The name appears only where
// it is the brand: the logo's label, sign-in and the page title (index.html reads it through Vite).
// Addresses, the MCP server name and the CLI follow it.

export const PRODUCT = "Heed"
/** How a side area (Settings, and later Observability) leads back: to the app, not to a workspace's name. */
export const BACK_TO_APP = "Back to app"

const slug = PRODUCT.toLowerCase()
export const APP_URL = `https://${slug}.example.com`
export const MCP_URL = `${APP_URL}/mcp`
/** The MCP server's name in an agent's config, and the CLI's name. */
export const SLUG = slug
/** The Google service account a Drive folder is shared with. */
export const SERVICE_ACCOUNT = `${slug}-reader@larchwood-${slug}.iam.gserviceaccount.com`
