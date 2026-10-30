import { createMockApi } from './mock'

// The binding this build talks to: the mock binding, as the golden journeys, the unit tests and the
// static demo use. A build with VITE_API_MODE=http reads binding-http.ts in its place
// (vite.app.config.ts), so neither build carries the other.

export function binding() {
  const mock = createMockApi()
  return { api: mock.api, controls: mock.controls }
}
