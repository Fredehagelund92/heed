import type { HeedApi } from './client'
import type { MockControls } from './mock'
import { binding } from './binding'

export type * from './client'
export { ApiError, isSignedOut, toApiError } from './errors'
export type { ApiErrorKind } from './errors'
export type { MockControls } from './mock'

/**
 * The API the app talks to, once `startApi` has bound this build's binding. `VITE_API_MODE=http`
 * talks to the Heed service at `/api/v1` on the page's own origin (the dev server proxies it).
 * Anything else uses the mock binding, as the golden journeys, the unit tests and the static demo
 * do, so they stay deterministic.
 */
export let api: HeedApi = new Proxy({} as HeedApi, {
  get: (_, method) => {
    throw new Error(`The API was used before startApi (${String(method)}).`)
  },
})

/** The mock binding's own controls (review flags, Slow network); null with the http binding. */
export let mockControls: MockControls | null = null

/** Uses this binding from now on: startApi's choice, or a test's own. */
export function bindApi(binding: HeedApi, controls: MockControls | null = null) {
  api = binding
  mockControls = controls
}

/**
 * Binds this build's binding (binding.ts, or binding-http.ts with VITE_API_MODE=http) before the
 * app is drawn, so the first screen never waits on one.
 */
export function startApi() {
  const { api: chosen, controls } = binding()
  bindApi(chosen, controls)
}
