import type * as Api from '@/api'

// The static docs site talks to no service: in its build `@/api` is this (vite.docs.config.ts), so
// the parts it shares with the app (a button's loading state) find no binding and carry no data.

export const mockControls: typeof Api.mockControls = null
