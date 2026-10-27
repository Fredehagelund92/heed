import type { FastifyInstance, FastifyReply } from 'fastify'
import { API_PREFIX } from '../../contract/index.ts'
import {
  clearBrowserCookie,
  cookieAge,
  sessionCookie,
  type OidcSignIn,
} from '../modules/auth/index.ts'

/**
 * The two addresses of company sign-in (FR-416): start sends the browser to the provider, and the
 * callback (the redirect address registered there) ends the sign-in and sends the browser back to
 * the web app, signed in, or to its sign-in screen with the reason (`?error=`). Never cached, never
 * framed, and the callback's address (which holds the code) is never sent on as a referrer.
 */
export function registerOidcRoutes(
  app: FastifyInstance,
  deps: { signIn: OidcSignIn; webOrigin: string },
) {
  const { signIn, webOrigin } = deps
  const secure = signIn.settings.redirectUrl.startsWith('https://')
  const signInScreen = (error: string) => `${webOrigin}/#/signin?error=${error}`
  const headers = (reply: FastifyReply) =>
    reply
      .header('cache-control', 'no-store')
      .header('pragma', 'no-cache')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")

  app.get(`${API_PREFIX}/auth/oidc/start`, async (request, reply) => {
    headers(reply)
    const { returnTo } = request.query as { returnTo?: unknown }
    try {
      const started = await signIn.start({
        returnTo: typeof returnTo === 'string' ? returnTo : undefined,
      })
      return reply.header('set-cookie', started.cookie).redirect(started.redirect, 302)
    } catch {
      request.log.warn(
        { event: 'web_sign_in', result: 'refused', reason: 'unavailable', detail: 'discovery' },
        'Sign-in',
      )
      return reply.redirect(signInScreen('unavailable'), 302)
    }
  })

  app.get(`${API_PREFIX}/auth/oidc/callback`, async (request, reply) => {
    headers(reply)
    const result = await signIn.finish({
      query: request.query as Record<string, unknown>,
      cookie: request.headers.cookie,
      log: request.log,
      requestId: request.id,
    })
    const cookies = [clearBrowserCookie(signIn)]
    if (result.ok) cookies.push(sessionCookie(result.token, secure, cookieAge(signIn.lifetime)))
    return reply
      .header('set-cookie', cookies)
      .redirect(result.ok ? `${webOrigin}${result.returnTo}` : signInScreen(result.refusal), 302)
  })
}
