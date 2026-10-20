/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `http` talks to the Heed service at /api/v1; anything else (the default) uses the mock API. */
  readonly VITE_API_MODE?: string
  /** Simulated delay of the mock API in milliseconds. 0 disables it. Default 120. */
  readonly VITE_MOCK_LATENCY_MS?: string
  /** Set to "true" to show the TanStack Query and Router devtools in development. */
  readonly VITE_DEVTOOLS?: string
  /** Set to "true" to include the design preview route in a production build (used by Playwright). */
  readonly VITE_DESIGN_PREVIEW?: string
  /** "true" lets a production build read the mock scenario and person (Storybook sets it). */
  readonly VITE_MOCK_CONTROLS?: string
  /** The product's name (src/web/lib/brand.ts); the service reads the same variable. */
  readonly CL_PRODUCT_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
