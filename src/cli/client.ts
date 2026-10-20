/**
 * The command-line tool's connection to Heed: the typed contract client (src/contract), signed in
 * the way the web app is. Locally that is the dev sign-in; the company sign-in replaces it with
 * the hosting stage. Mutations carry the session's CSRF token, the origin the service allows,
 * and a fresh retry key.
 */
import { randomUUID } from 'node:crypto'
import { createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { API_PREFIX, contract, type Contract } from '../contract/index.ts'

export type HeedClient = ContractRouterClient<Contract>
export type Connection = {
  /** The service, for example http://127.0.0.1:3000. */
  url: string
  /** The origin the service accepts for changes (CL_WEB_ORIGINS). */
  origin: string
  fetch?: typeof globalThis.fetch
}

export function createClient(connection: Connection) {
  const send = connection.fetch ?? globalThis.fetch
  const session = { cookie: '', csrf: 'dev-sign-in' }
  const link = new OpenAPILink(contract, {
    url: new URL(API_PREFIX, connection.url).href,
    fetch: async (request, init) => {
      const headers = new Headers(request.headers)
      if (session.cookie) headers.set('cookie', session.cookie)
      if (request.method !== 'GET') {
        headers.set('origin', connection.origin)
        headers.set('x-heed-csrf', session.csrf)
        headers.set('idempotency-key', randomUUID())
      }
      const response = await send(new Request(request, { headers }), init)
      const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]!)
      if (cookies.length) session.cookie = cookies.join('; ')
      return response
    },
  })
  const client: HeedClient = createORPCClient(link)
  return {
    client,
    /** Dev sign-in as a person in the service's people file. */
    async signIn(email: string) {
      const signedIn = await client.auth.signIn({ email })
      session.csrf = signedIn.csrfToken
      return signedIn.person
    },
  }
}
