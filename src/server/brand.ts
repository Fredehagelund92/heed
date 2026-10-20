import { productNameFrom } from '../domain/brand.ts'

/**
 * The product's name on the service (src/domain/brand.ts): read once, when the service starts,
 * from the same `CL_PRODUCT_NAME` that `loadConfig` checks. Module text built from it, such as the
 * assistant's instructions and the MCP tools' descriptions, is therefore the same for every
 * request, so prompt caching keeps hitting.
 */
export const productName = productNameFrom(process.env.CL_PRODUCT_NAME)
