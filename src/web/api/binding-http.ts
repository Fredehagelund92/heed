import { API_PREFIX } from '@contract/limits'
import { createHttpApi } from './http'

// The binding of a build with VITE_API_MODE=http: the Heed service at /api/v1 on the page's own
// origin (the dev server proxies it). It stands in for binding.ts (vite.app.config.ts).

export function binding() {
  return {
    api: createHttpApi({ baseUrl: new URL(API_PREFIX, window.location.origin).href }),
    controls: null,
  }
}
