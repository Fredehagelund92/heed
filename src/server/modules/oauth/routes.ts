import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { productName } from '../../brand.ts'
import type { Database } from '../../db/database.ts'
import { createLimiter } from '../../http/rate-limit.ts'
import {
  browserCookie,
  logSignIn,
  type Identity,
  type LoginServer,
  type TokenAnswer,
} from './service.ts'

/**
 * The login server's addresses (docs/ai-sign-in.md): discovery (RFC 8414), the key set, dynamic
 * registration (RFC 7591, behind a setting), the authorize and token endpoints of the OAuth 2.1
 * code flow with PKCE, and revocation (RFC 7009). Every address has its own rate per caller
 * address, answers only to the issuer's host, is never cached and never framed. Access log lines
 * carry the path only (observability/logger.ts); the sign-in lines add the outcome (FR-411).
 */

type Form = { values: Record<string, string>; repeated: boolean }

/** Requests per minute per caller address, and failed token requests per client and caller address. */
const limits = {
  discovery: 120,
  register: 10,
  authorize: 30,
  token: 60,
  tokenClient: 30,
  revoke: 30,
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const product = escapeHtml(productName)
const page = (message: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${product} sign-in</title></head>` +
  `<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">` +
  `<h1 style="font-size: 1.25rem">The app can’t sign in to ${product}</h1><p>${escapeHtml(message)}</p>` +
  `<p>Close this window and try again from the app. If it keeps happening, tell an admin.</p></body></html>`

/** Single-valued parameters only: a repeated parameter makes the request invalid (RFC 6749 3.1). */
function single(values: Record<string, unknown>): Form {
  const out: Record<string, string> = Object.create(null) as Record<string, string>
  let repeated = false
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') out[key] = value
    else repeated = true
  }
  return { values: out, repeated }
}

export function registerLoginRoutes(
  app: FastifyInstance,
  deps: { login: LoginServer; database: Database; identity: Identity; now?: () => Date },
) {
  const { login, database, identity } = deps
  const limit = createLimiter(deps.now ?? (() => new Date()))
  const issuerHost = new URL(login.issuer).hostname
  const secure = login.issuer.startsWith('https://')

  app.register((scope, _options, ready) => {
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: 4096 },
      (_request, body, done) => {
        const values: Record<string, string> = Object.create(null) as Record<string, string>
        let repeated = false
        for (const [key, value] of new URLSearchParams(body as string)) {
          if (key in values) repeated = true
          values[key] = value
        }
        done(null, { values, repeated } satisfies Form)
      },
    )
    scope.addHook('onSend', async (_request, reply, payload) => {
      reply.header('cache-control', 'no-store')
      reply.header('pragma', 'no-cache')
      reply.header('x-content-type-options', 'nosniff')
      reply.header('referrer-policy', 'no-referrer')
      reply.header('x-frame-options', 'DENY')
      reply.header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      )
      return payload
    })
    /** Refuses another host (DNS rebinding) and a caller over its rate. Null lets it through. */
    const gate = (request: FastifyRequest, reply: FastifyReply, name: keyof typeof limits) => {
      let host: string
      try {
        host = new URL(`http://${request.headers.host}`).hostname
      } catch {
        host = ''
      }
      if (host !== issuerHost) return reply.code(403).send({ error: 'invalid_request' })
      const retry = limit([{ key: `oauth:${name}:${request.ip}`, limit: limits[name] }])
      if (!retry) return null
      reply.header('retry-after', String(retry))
      return reply.code(429).send({
        error: 'temporarily_unavailable',
        error_description: `Too many requests; retry after ${retry} seconds`,
      })
    }
    const answer = (reply: FastifyReply, result: TokenAnswer, created = false) =>
      result.ok
        ? reply.code(created ? 201 : 200).send(result.body)
        : reply
            .code(result.status)
            .send({ error: result.error, error_description: result.description })

    scope.get(
      '/.well-known/oauth-authorization-server',
      (request, reply) => gate(request, reply, 'discovery') ?? reply.send(login.metadata()),
    )
    scope.get(
      '/oauth/jwks',
      (request, reply) => gate(request, reply, 'discovery') ?? reply.send(login.keys.jwks),
    )

    scope.post('/oauth/register', { bodyLimit: 8192 }, async (request, reply) => {
      const refused = gate(request, reply, 'register')
      if (refused) return refused
      if (!String(request.headers['content-type'] ?? '').startsWith('application/json'))
        return reply.code(400).send({
          error: 'invalid_client_metadata',
          error_description: 'Send the client metadata as JSON',
        })
      return answer(reply, await login.register(database, request.body, request.log), true)
    })

    scope.get('/oauth/authorize', async (request, reply) => {
      const refused = gate(request, reply, 'authorize')
      if (refused) return refused
      const query = single(request.query as Record<string, unknown>)
      if (query.repeated) {
        logSignIn(request.log, 'refused', 'bad_request')
        return reply
          .code(400)
          .type('text/html; charset=utf-8')
          .send(page('The app sent a parameter twice.'))
      }
      const result = await login.authorize(
        database,
        query.values,
        request.headers.cookie,
        request.log,
      )
      if (result.kind === 'page')
        return reply.code(result.status).type('text/html; charset=utf-8').send(page(result.message))
      if (result.kind === 'consent')
        reply.header(
          'set-cookie',
          `${browserCookie}=${result.browser}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`,
        )
      return reply.redirect(result.location, 302)
    })

    scope.post('/oauth/token', async (request, reply) => {
      const refused = gate(request, reply, 'token')
      if (refused) return refused
      const form = request.body as Form | undefined
      if (!form || typeof form !== 'object' || !('values' in form) || form.repeated)
        return reply.code(400).send({
          error: 'invalid_request',
          error_description: 'Send single parameters as application/x-www-form-urlencoded',
        })
      // No client here holds a secret: a client that authenticates is not one of ours.
      if (request.headers.authorization)
        return reply.code(401).send({
          error: 'invalid_client',
          error_description: 'Clients do not authenticate with a secret',
        })
      const clientId = form.values.client_id
      const failures = clientId
        ? {
            key: `oauth:token-failed:${request.ip}:${createHash('sha256').update(clientId).digest('hex')}`,
            limit: limits.tokenClient,
          }
        : undefined
      const limited = (retry: number) => {
        reply.header('retry-after', String(retry))
        return reply.code(429).send({
          error: 'temporarily_unavailable',
          error_description: `Too many requests; retry after ${retry} seconds`,
        })
      }
      const over = failures && limit([{ ...failures, peek: true }])
      if (over) return limited(over)
      const result = await login.token(database, form.values, request.log, identity)
      if (!result.ok && result.retryAfter) return limited(result.retryAfter)
      if (!result.ok && failures) limit([failures])
      return answer(reply, result)
    })

    scope.post('/oauth/revoke', async (request, reply) => {
      const refused = gate(request, reply, 'revoke')
      if (refused) return refused
      const form = request.body as Form | undefined
      if (!form || typeof form !== 'object' || !('values' in form) || form.repeated)
        return reply.code(400).send({ error: 'invalid_request' })
      if (!form.values.token || !form.values.client_id)
        return reply.code(400).send({
          error: 'invalid_request',
          error_description: 'token and client_id are required',
        })
      await login.revoke(database, form.values, request.log)
      return reply.code(200).send({})
    })
    ready()
  })
}
