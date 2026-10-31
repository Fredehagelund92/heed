import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose'

/**
 * A local OpenID Connect provider for the sign-in harness tests: discovery, a key set, the
 * authorize endpoint (no screen: it signs in whoever the test names) and the token endpoint, which
 * checks the code, the redirect address, the PKCE verifier and, for a confidential client, its
 * secret. A test can make it answer wrongly in each way an attacker or a broken provider might.
 */
export interface Account {
  sub: string
  email?: string
  email_verified?: boolean | string
  name?: string
  groups?: string[]
}

export interface Tweaks {
  /** Claims to add or replace in the ID token. */
  claims?: JWTPayload
  /** Sign with a key the provider never published. */
  foreignKey?: boolean
  /** An unsigned token (`alg: none`). */
  unsigned?: boolean
  /** The `iss` the authorize endpoint sends back with the code (RFC 9207). */
  responseIss?: string | null
  /** Answer the authorize request with this error instead of a code. */
  error?: string
}

export async function startOidcProvider(
  options: {
    clientSecret?: string | null
    /** The port on 127.0.0.1: any free one unless the caller names one. */
    port?: number
  } = {},
) {
  const clientId = 'heed-test'
  const clientSecret = options.clientSecret === undefined ? 'test-secret' : options.clientSecret
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const foreign = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  let account: Account = { sub: 'nobody' }
  let tweaks: Tweaks = {}
  const codes = new Map<
    string,
    { redirectUri: string; challenge: string; nonce: string; account: Account; tweaks: Tweaks }
  >()
  /** Every authorize request, as the provider saw it. */
  const authorizations: URLSearchParams[] = []
  /** Every token request's form and whether it carried the client's secret. */
  const tokenRequests: { form: URLSearchParams; secret: boolean }[] = []

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.statusCode = 500
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const issuer = `http://127.0.0.1:${port}`

  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  async function idToken(code: { nonce: string; account: Account; tweaks: Tweaks }) {
    const { sub, ...profile } = code.account
    const payload: JWTPayload = { nonce: code.nonce, ...profile, ...code.tweaks.claims }
    if (code.tweaks.unsigned) {
      const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const now = Math.floor(Date.now() / 1000)
      return `${part({ alg: 'none', typ: 'JWT' })}.${part({ iss: issuer, aud: clientId, sub, iat: now, exp: now + 300, ...payload })}.`
    }
    let jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(sub)
      .setIssuedAt()
    if (payload.iss === undefined) jwt = jwt.setIssuer(issuer)
    if (payload.aud === undefined) jwt = jwt.setAudience(clientId)
    if (payload.exp === undefined) jwt = jwt.setExpirationTime('5m')
    return jwt.sign(code.tweaks.foreignKey ? foreign.privateKey : privateKey)
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', issuer)
    if (url.pathname === '/.well-known/openid-configuration')
      return json(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
        authorization_response_iss_parameter_supported: true,
      })
    if (url.pathname === '/jwks') return json(response, 200, { keys: [jwk] })
    if (url.pathname === '/authorize') {
      const query = url.searchParams
      authorizations.push(query)
      const redirect = new URL(query.get('redirect_uri') ?? '')
      if (query.get('client_id') !== clientId || query.get('response_type') !== 'code')
        return json(response, 400, { error: 'invalid_request' })
      if (tweaks.error) {
        redirect.searchParams.set('error', tweaks.error)
      } else {
        const code = randomBytes(24).toString('base64url')
        codes.set(code, {
          redirectUri: redirect.href,
          challenge: query.get('code_challenge') ?? '',
          nonce: query.get('nonce') ?? '',
          account,
          tweaks,
        })
        redirect.searchParams.set('code', code)
      }
      redirect.searchParams.set('state', query.get('state') ?? '')
      if (tweaks.responseIss !== null)
        redirect.searchParams.set('iss', tweaks.responseIss ?? issuer)
      response.writeHead(302, { location: redirect.href })
      return response.end()
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const form = new URLSearchParams(body)
      const basic = request.headers.authorization ?? ''
      const presented = basic.startsWith('Basic ')
        ? Buffer.from(basic.slice(6), 'base64').toString().split(':').map(decodeURIComponent)
        : null
      const secret = presented?.[0] === clientId && presented[1] === clientSecret
      tokenRequests.push({ form, secret })
      const code = codes.get(form.get('code') ?? '')
      codes.delete(form.get('code') ?? '')
      const verifier = form.get('code_verifier') ?? ''
      if (
        !code ||
        form.get('grant_type') !== 'authorization_code' ||
        form.get('client_id') !== clientId ||
        form.get('redirect_uri') !== code.redirectUri ||
        createHash('sha256').update(verifier).digest('base64url') !== code.challenge ||
        (clientSecret !== null && !secret)
      )
        return json(response, 400, { error: 'invalid_grant' })
      return json(response, 200, {
        access_token: randomBytes(16).toString('hex'),
        token_type: 'Bearer',
        id_token: await idToken(code),
      })
    }
    return json(response, 404, { error: 'not_found' })
  }

  return {
    issuer,
    clientId,
    clientSecret,
    authorizations,
    tokenRequests,
    /** Who the next sign-in at the provider is, and how it answers. */
    as(next: Account, nextTweaks: Tweaks = {}) {
      account = next
      tweaks = nextTweaks
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
