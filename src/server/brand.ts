import { productNameFrom } from '../domain/brand.ts'
import { withRenamedSettings } from '../domain/renamed-settings.ts'

/**
 * The product's name on the service (src/domain/brand.ts): read once, when the service starts,
 * from the same `HEED_PRODUCT_NAME` that `loadConfig` checks (or its old name, which `loadConfig`
 * warns of). Module text built from it, such as the assistant's instructions and the MCP tools'
 * descriptions, is therefore the same for every request, so prompt caching keeps hitting.
 */
export const productName = productNameFrom(
  withRenamedSettings(process.env).environment.HEED_PRODUCT_NAME,
)
