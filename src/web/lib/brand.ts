import { productNameFrom } from '../../domain/brand.ts'

/**
 * The product's name in the app (src/domain/brand.ts): from `CL_PRODUCT_NAME` when the app was
 * built, the same variable the service reads. Say it only where a sentence names the product, as
 * in "Sign in to Heed" or "What is Heed"; a label such as Back or Add to your agent goes without
 * it.
 *
 * The mocks are also loaded outside a Vite build (Playwright, scripts), where there is no
 * `import.meta.env`: there the process's own environment says it.
 */
const built = (import.meta as { env?: { CL_PRODUCT_NAME?: string } }).env?.CL_PRODUCT_NAME
const running = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
  ?.env.CL_PRODUCT_NAME

export const productName = productNameFrom(built ?? running)
