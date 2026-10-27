import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import {
  createLocalJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from 'jose'
import type { Database, Queryable } from '../../db/database.ts'
import type { SignIn } from './dev-sign-in.ts'
import {
  currentSession,
  endSession,
  principalFor,
  startSession,
  type Session,
  type SessionLifetime,
} from './sessions.ts'
import { acceptInvite } from './invites.ts'

/*
  Company sign-in with OpenID Connect (FR-416; the threat note is in docs/ai-sign-in.md): the
  authorization code flow with PKCE (S256), the provider found by discovery, and every check the
  ID token needs (signature by the provider's published keys, issuer, audience, authorized party,
  expiry, nonce). A sign-in in progress is kept ten minutes, tied to the browser that started it
  by an HttpOnly cookie, and used once whatever its outcome. Signing in makes a new session and
  ends the one the browser had.

  Who may sign in: a person already linked to their account at the provider; an active person or
  an open invite, by an address the provider has verified; or, when the install maps groups, a
  member of one (a Member, or an Admin for the admin group). Anyone else is told one plain thing,
  whatever the reason, so the answer says nothing about which addresses Heed knows.

  Nothing here logs an address, a subject, a code or a token: a sign-in line carries its result
  and a reason code only.
*/

export interface OidcSettings {
  issuer: string
  clientId: string
  /** A confidential client's secret, read from its owner-only file; null for a public client. */
  clientSecret: string | null
  redirectUrl: string
  scopes: string
  groupsClaim: string
  adminGroups: readonly string[]
  memberGroups: readonly string[]
  name: string | null
}

/** Why a sign-in did not happen, as the sign-in screen reads it (`?error=`). */
export type OidcRefusal =
  /** The person said no at the provider, or the provider refused. */
  | 'cancelled'
  /** The sign-in was not started in this browser, was used already or took too long. */
  | 'expired'
  /** The provider could not be reached or answered wrongly. */
  | 'unavailable'
  /** The provider's answer did not pass the checks. */
  | 'failed'
  /** The provider has not confirmed the email address. */
  | 'email_unverified'
  /** Not someone this workspace lets in: the same answer for every such person. */
  | 'not_allowed'

/** Where a sign-in writes its line: the request's logger. */
export interface OidcLog {
  info(object: object, message: string): void
  warn(object: object, message: string): void
}

export interface OidcSignIn extends SignIn {
  readonly method: 'oidc'
  readonly settings: OidcSettings
  /** The sign-in button's name for the provider. */
  readonly label: string
  /** Begins a sign-in: where to send the browser, and the cookie that ties the sign-in to it. */
  start(input: { returnTo: string | undefined }): Promise<{ redirect: string; cookie: string }>
  /** Ends a sign-in at the redirect address: a new session, or why not. */
  finish(input: {
    query: Record<string, unknown>
    cookie: string | undefined
    log: OidcLog
    requestId?: string
  }): Promise<
    | { ok: true; token: string; session: Session; returnTo: string }
    | { ok: false; refusal: OidcRefusal }
  >
}

export const OIDC_BROWSER_COOKIE = 'heed_oidc_browser'
const REQUEST_MINUTES = 10
const FETCH_MS = 5000
const ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const random = () => randomBytes(32).toString('base64url')

/**
 * Reads a confidential client's secret from its file, which only its owner may read (mode 0600 or
 * stricter). The secret is never logged; the error names the file, not what is in it.
 */
export async function readClientSecret(file: string): Promise<string> {
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`CL_OIDC_CLIENT_SECRET_FILE: ${file} is not a file`)
  if ((info.mode & 0o077) !== 0)
    throw new Error(
      `CL_OIDC_CLIENT_SECRET_FILE: ${file} may be read by others; make it readable by its owner only (chmod 600)`,
    )
  const secret = (await readFile(file, 'utf8')).trim()
  if (!secret) throw new Error(`CL_OIDC_CLIENT_SECRET_FILE: ${file} is empty`)
  return secret
}

/**
 * Where to go back to after signing in: a path on the web app, never another site. Anything else
 * goes to the start page.
 */
export function safeReturnTo(value: unknown, webOrigin: string): string {
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/')) return '/'
  // A backslash (read as a slash by browsers) or a control character never goes through.
  if (value.startsWith('//') || [...value].some((c) => c === '\\' || c < ' ' || c === '\u007f'))
    return '/'
  try {
    const url = new URL(value, webOrigin)
    return url.origin === webOrigin ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch {
    return '/'
  }
}

interface Metadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  code_challenge_methods_supported?: string[]
  id_token_signing_alg_values_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  authorization_response_iss_parameter_supported?: boolean
}

/** An address the provider names: https, or http on this computer only. */
function endpoint(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`discovery: ${field} missing`)
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error(`discovery: ${field} is not https`)
  return url.href
}

export function createOidcSignIn(options: {
  settings: OidcSettings
  database: Database
  webOrigin: string
  lifetime: SessionLifetime
  fetch?: typeof globalThis.fetch
}): OidcSignIn {
  const { settings, database, webOrigin, lifetime } = options
  const fetcher = options.fetch ?? globalThis.fetch
  const secure = settings.redirectUrl.startsWith('https://')
  const cookiePath = new URL(settings.redirectUrl).pathname.replace(/\/[^/]*$/, '') || '/'

  const get = async (url: string) => {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_MS),
    })
    if (!response.ok) throw new Error(`${response.status} from the provider`)
    return response.json()
  }

  // The provider's discovery document and keys, read when first needed and kept for an hour;
  // keys are read again at once when a token names one not seen yet (a rotation).
  let metadata: { value: Metadata; until: number } | undefined
  async function discover(): Promise<Metadata> {
    if (metadata && metadata.until > Date.now()) return metadata.value
    const document = (await get(
      `${settings.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    )) as Record<string, unknown>
    if (document.issuer !== settings.issuer) throw new Error('discovery: issuer differs')
    const methods = document.code_challenge_methods_supported
    if (Array.isArray(methods) && !methods.includes('S256'))
      throw new Error('discovery: no S256 PKCE')
    const value: Metadata = {
      ...(document as unknown as Metadata),
      issuer: settings.issuer,
      authorization_endpoint: endpoint(document.authorization_endpoint, 'authorization_endpoint'),
      token_endpoint: endpoint(document.token_endpoint, 'token_endpoint'),
      jwks_uri: endpoint(document.jwks_uri, 'jwks_uri'),
    }
    metadata = { value, until: Date.now() + 3_600_000 }
    return value
  }
  let keys: { set: ReturnType<typeof createLocalJWKSet>; until: number } | undefined
  async function keySet(fresh = false) {
    if (!fresh && keys && keys.until > Date.now()) return keys.set
    const jwks = (await get((await discover()).jwks_uri)) as JSONWebKeySet
    keys = { set: createLocalJWKSet(jwks), until: Date.now() + 600_000 }
    return keys.set
  }

  /** The ID token's claims once every check passes; throws otherwise. */
  async function verify(idToken: string, nonce: string): Promise<JWTPayload> {
    const meta = await discover()
    const offered = meta.id_token_signing_alg_values_supported ?? ['RS256']
    const algorithms = ALGORITHMS.filter((algorithm) => offered.includes(algorithm))
    const check = async (fresh: boolean) =>
      jwtVerify(idToken, await keySet(fresh), {
        issuer: settings.issuer,
        audience: settings.clientId,
        algorithms,
        clockTolerance: 60,
        requiredClaims: ['sub', 'iat', 'exp'],
      })
    let result
    try {
      result = await check(false)
    } catch (error) {
      if (!(error instanceof joseErrors.JWKSNoMatchingKey)) throw error
      result = await check(true)
    }
    const claims = result.payload
    if (typeof claims.nonce !== 'string' || !equal(claims.nonce, nonce))
      throw new Error('nonce differs')
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if ((audiences.length > 1 || claims.azp !== undefined) && claims.azp !== settings.clientId)
      throw new Error('authorized party differs')
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255)
      throw new Error('subject missing')
    return claims
  }

  async function exchange(code: string, verifier: string): Promise<string> {
    const meta = await discover()
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: settings.redirectUrl,
      code_verifier: verifier,
      client_id: settings.clientId,
    })
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    }
    if (settings.clientSecret !== null) {
      const methods = meta.token_endpoint_auth_methods_supported ?? ['client_secret_basic']
      if (methods.includes('client_secret_basic')) {
        const pair = `${encodeURIComponent(settings.clientId)}:${encodeURIComponent(settings.clientSecret)}`
        headers.authorization = `Basic ${Buffer.from(pair).toString('base64')}`
      } else form.set('client_secret', settings.clientSecret)
    }
    const response = await fetcher(meta.token_endpoint, {
      method: 'POST',
      headers,
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_MS * 2),
    })
    if (!response.ok) throw new Error(`token endpoint ${response.status}`)
    const body = (await response.json()) as { id_token?: unknown; token_type?: unknown }
    if (typeof body.id_token !== 'string') throw new Error('no ID token')
    return body.id_token
  }

  const groupsOf = (claims: JWTPayload): string[] => {
    const value = claims[settings.groupsClaim]
    if (typeof value === 'string') return [value]
    return Array.isArray(value) ? value.filter((g): g is string => typeof g === 'string') : []
  }
  const nameOf = (claims: JWTPayload, email: string) => {
    const name =
      typeof claims.name === 'string'
        ? claims.name
        : [claims.given_name, claims.family_name].filter((p) => typeof p === 'string').join(' ')
    return name.trim().slice(0, 200) || email
  }

  /** The person this account signs in as, linking the account on its first sign-in; or why not. */
  async function personFor(
    tx: Queryable,
    claims: JWTPayload,
  ): Promise<{ id: string } | { refusal: OidcRefusal }> {
    const subject = claims.sub!
    const [linked] = await tx.query<{ id: string; email: string; active: boolean }>(
      `select p.id::text, p.email, (p.deactivated_at is null and p.erased_at is null) as active
         from auth.identities i join people p on p.id = i.person_id
        where i.issuer=$1 and i.subject=$2`,
      [settings.issuer, subject],
    )
    const groups = groupsOf(claims)
    const inAdmin = groups.some((g) => settings.adminGroups.includes(g))
    const inMember = inAdmin || groups.some((g) => settings.memberGroups.includes(g))
    let id: string | null = null
    if (linked) {
      id = linked.id
      if (!linked.active) {
        const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
        const verified = claims.email_verified === true || claims.email_verified === 'true'
        if (!email || !verified || email !== linked.email.toLowerCase())
          return { refusal: 'not_allowed' }
        const back = await acceptInvite(tx, { email, name: nameOf(claims, email) })
        if (back !== linked.id) return { refusal: 'not_allowed' }
      }
    } else {
      const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
      if (!email) return { refusal: 'not_allowed' }
      if (claims.email_verified !== true && claims.email_verified !== 'true')
        return { refusal: 'email_unverified' }
      const [known] = await tx.query<{ id: string; active: boolean; linked: boolean }>(
        `select p.id::text, (p.deactivated_at is null and p.erased_at is null) as active,
                exists (select 1 from auth.identities i where i.issuer=$2 and i.person_id=p.id) as linked
           from people p where p.email=$1`,
        [email, settings.issuer],
      )
      // Another account at this provider is linked to the person already: this one is not them.
      if (known?.linked) return { refusal: 'not_allowed' }
      if (known?.active) id = known.id
      id ??= await acceptInvite(tx, { email, name: nameOf(claims, email) })
      if (!id && inMember) {
        const [joined] = await tx.query<{ id: string | null }>(
          'select auth.join_by_group($1,$2)::text as id',
          [email, nameOf(claims, email)],
        )
        id = joined?.id ?? null
      }
      if (!id) return { refusal: 'not_allowed' }
      await tx.query('insert into auth.identities(issuer,subject,person_id) values($1,$2,$3)', [
        settings.issuer,
        subject,
        id,
      ])
    }
    if (settings.adminGroups.length)
      await tx.query('select auth.sync_group_admin($1,$2)', [id, inAdmin])
    await tx.query(
      'update auth.identities set last_signed_in_at=now() where issuer=$1 and subject=$2',
      [settings.issuer, subject],
    )
    return { id }
  }

  const sign: OidcSignIn = {
    method: 'oidc',
    settings,
    lifetime,
    label: settings.name ?? 'your company account',
    people: [],
    choices: () => Promise.resolve([]),
    initialize: () => Promise.resolve(),
    currentSession: (tx, cookie) => currentSession(tx, cookie, lifetime),
    signIn: () => Promise.resolve(null),
    signOut: endSession,
    groups: () => Promise.resolve([]),

    async start({ returnTo }) {
      const meta = await discover()
      const state = random()
      const nonce = random()
      const verifier = random()
      const browser = randomBytes(32).toString('hex')
      await database.transaction(null, async (tx) => {
        await tx.query('delete from auth.oidc_requests where expires_at <= now()')
        await tx.query(
          `insert into auth.oidc_requests(state_hash,browser_hash,nonce,code_verifier,return_to,expires_at)
           values($1,$2,$3,$4,$5,now() + make_interval(mins => $6))`,
          [
            sha256(state),
            sha256(browser),
            nonce,
            verifier,
            safeReturnTo(returnTo, webOrigin),
            REQUEST_MINUTES,
          ],
        )
      })
      const url = new URL(meta.authorization_endpoint)
      for (const [key, value] of Object.entries({
        response_type: 'code',
        client_id: settings.clientId,
        redirect_uri: settings.redirectUrl,
        scope: settings.scopes,
        state,
        nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }))
        url.searchParams.set(key, value)
      return {
        redirect: url.href,
        cookie: `${OIDC_BROWSER_COOKIE}=${browser}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${REQUEST_MINUTES * 60}${secure ? '; Secure' : ''}`,
      }
    },

    async finish({ query, cookie, log, requestId }) {
      const refuse = (refusal: OidcRefusal, detail?: string) => {
        log.warn({ event: 'web_sign_in', result: 'refused', reason: refusal, detail }, 'Sign-in')
        return { ok: false as const, refusal }
      }
      const one = (key: string) => (typeof query[key] === 'string' ? query[key] : undefined)
      const state = one('state')
      if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return refuse('expired', 'state')
      // Used once, whatever happens next.
      const [request] = await database.transaction(
        null,
        (tx) =>
          tx.query<{
            browserHash: string
            nonce: string
            verifier: string
            returnTo: string
            live: boolean
          }>(
            `delete from auth.oidc_requests where state_hash=$1
             returning browser_hash as "browserHash", nonce, code_verifier as verifier,
                       return_to as "returnTo", expires_at > now() as live`,
            [sha256(state)],
          ),
        { requestId },
      )
      const browser = browserValue(cookie)
      if (!request || !request.live || !browser || !equal(sha256(browser), request.browserHash))
        return refuse('expired', 'request')
      if (one('error') !== undefined) return refuse('cancelled', 'provider')
      let meta: Metadata
      try {
        meta = await discover()
      } catch {
        return refuse('unavailable', 'discovery')
      }
      // The answer must come from this provider (RFC 9207): a mix-up attack names another.
      const iss = one('iss')
      if (
        iss !== undefined
          ? iss !== settings.issuer
          : meta.authorization_response_iss_parameter_supported
      )
        return refuse('failed', 'iss')
      const code = one('code')
      if (!code || code.length > 2048) return refuse('failed', 'code')
      let idToken: string
      try {
        idToken = await exchange(code, request.verifier)
      } catch {
        return refuse('unavailable', 'token')
      }
      let claims: JWTPayload
      try {
        claims = await verify(idToken, request.nonce)
      } catch {
        return refuse('failed', 'id_token')
      }
      const outcome = await database.transaction(
        null,
        async (tx) => {
          const found = await personFor(tx, claims)
          if ('refusal' in found) return found
          const person = await principalFor(tx, found.id)
          if (!person) return { refusal: 'not_allowed' as const }
          return startSession(tx, person, 'oidc', lifetime, cookie)
        },
        { requestId },
      )
      if ('refusal' in outcome) return refuse(outcome.refusal, 'person')
      log.info({ event: 'web_sign_in', result: 'signed_in', method: 'oidc' }, 'Sign-in')
      return { ok: true, ...outcome, returnTo: request.returnTo }
    },
  }
  return sign
}

function equal(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function browserValue(cookie: string | undefined): string | undefined {
  const values =
    cookie
      ?.split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${OIDC_BROWSER_COOKIE}=`)) ?? []
  if (values.length !== 1) return undefined
  const value = values[0]!.slice(OIDC_BROWSER_COOKIE.length + 1)
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined
}

/** Clears the sign-in's browser cookie. */
export const clearBrowserCookie = (sign: OidcSignIn) =>
  `${OIDC_BROWSER_COOKIE}=; Path=${new URL(sign.settings.redirectUrl).pathname.replace(/\/[^/]*$/, '') || '/'}; HttpOnly; SameSite=Lax; Max-Age=0${sign.settings.redirectUrl.startsWith('https://') ? '; Secure' : ''}`
