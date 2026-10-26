import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { Database, Queryable } from '../../db/database.ts'
import { createLimiter } from '../../http/rate-limit.ts'
import type { LoginServerConfig } from '../../config/env.ts'
import { createPersonVerifier, personScopes, signedInClient } from '../../mcp/auth.ts'
import { initialsOf, principalFor } from '../auth/index.ts'
import {
  fetchMetadataDocument,
  isMetadataDocumentId,
  metadataDocumentProblem,
  readClientMetadata,
  supportedGrantTypes,
  type FetchMetadataDocument,
} from './clients.ts'
import { localKeys, type KeyRing } from './keys.ts'
import { redirectMatches, redirectWith } from './redirects.ts'

/** A sign-in code is used within a minute; an access token lives ten minutes (docs/ai-sign-in.md). */
export const accessTokenSeconds = 600
const codeSeconds = 60
const requestSeconds = 600
/**
 * A dynamic registration nobody ever connected with goes after a day; one whose connections have
 * all ended goes after 30 days unused. There is no cap that could lock other apps out: the
 * registration rate bounds the table.
 */
const unconnectedRegistrationDays = 1
const unusedRegistrationDays = 30
export const browserCookie = 'heed_oauth_browser'
/**
 * What a sign-in grants when the agent asks for nothing in particular: read, report and suggest,
 * so suggest_context is on with the scope granted at consent (FR-121 as changed). The consent
 * screen names each one.
 */
export const defaultScopes = ['read', 'feedback', 'propose'] as const
export type PersonScope = (typeof personScopes)[number]

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('base64url')

/** Constant-time equality of two strings of any length. */
export function sameText(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right) && a.length === b.length
}

/** The S256 proof (RFC 7636): BASE64URL(SHA256(verifier)) equals the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return sameText(createHash('sha256').update(verifier).digest('base64url'), challenge)
}

/**
 * Reason codes of the sign-in log (FR-411). A line names the result, the reason and the client
 * label, never a person, a token, an address or anything a client sent.
 */
export type SignInReason =
  | 'unknown_client'
  | 'bad_client_metadata'
  | 'metadata_unreadable'
  | 'bad_redirect'
  | 'bad_request'
  | 'unsupported_response_type'
  | 'pkce_required'
  | 'bad_scope'
  | 'bad_resource'
  | 'request_expired'
  | 'person_denied'
  | 'code_unknown'
  | 'code_expired'
  | 'code_reuse'
  | 'client_mismatch'
  | 'redirect_mismatch'
  | 'pkce_failed'
  | 'person_inactive'
  | 'refresh_unknown'
  | 'refresh_expired'
  | 'refresh_reuse'
  | 'connection_revoked'
  | 'registration_off'
export interface SignInLog {
  info(fields: object, message: string): void
  warn(fields: object, message: string): void
}
export const logSignIn = (
  log: SignInLog,
  result: string,
  reason?: SignInReason,
  level: 'info' | 'warn' = reason ? 'warn' : 'info',
) => log[level]({ event: 'ai_sign_in', result, reason, client: signedInClient }, 'Agent sign-in')

/**
 * Connections revoked in this process, by id, for as long as their access tokens can live: the
 * MCP server refuses those tokens at once instead of when they expire. The list is filled from
 * the database at start, so a restart does not forget a recent disconnect. Until it has been
 * read, a token issued before this process started counts as revoked: it fails closed, and the
 * app gets a new token with its refresh token, which the database checks.
 */
export function createRevocations(now: () => Date) {
  const until = new Map<string, number>()
  const span = (accessTokenSeconds + 60) * 1000
  const startedSecond = Math.floor(now().getTime() / 1000)
  let loaded = false
  return {
    add(connection: string) {
      until.set(connection, now().getTime() + span)
    },
    /** The recent disconnects have been read from the database. */
    loaded() {
      loaded = true
    },
    has(connection: string, issuedAt?: number) {
      if (!loaded && (issuedAt === undefined || issuedAt < startedSecond)) return true
      const time = now().getTime()
      for (const [id, end] of until) if (end <= time) until.delete(id)
      return until.has(connection)
    },
  }
}

/** Refreshes per minute for one connection. */
const refreshesPerMinute = 5

type Builtin = Extract<LoginServerConfig, { kind: 'builtin' }>
type Client = { id: string; kind: string; name: string; redirectUris: string[] }
export type TokenAnswer =
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false
      status: number
      error: string
      description: string
      reason?: SignInReason
      retryAfter?: number
    }
export type AuthorizeAnswer =
  /** Shown as a page: the client or its redirect address could not be trusted. */
  | { kind: 'page'; status: number; message: string; reason: SignInReason }
  /** Sent back to the client's redirect address. */
  | { kind: 'redirect'; location: string; reason?: SignInReason }
  /** Sent to the consent page, with the cookie that ties the sign-in to this browser. */
  | { kind: 'consent'; location: string; browser: string }

const refused = (
  error: string,
  description: string,
  reason?: SignInReason,
  status = 400,
): TokenAnswer => ({ ok: false, status, error, description, ...(reason ? { reason } : {}) })

export interface LoginServer {
  readonly config: Builtin
  readonly issuer: string
  readonly resource: string
  readonly keys: KeyRing
  readonly revocations: ReturnType<typeof createRevocations>
  /** The MCP server's verifier for this issuer's tokens: it checks them itself (FR-402). */
  readonly verifier: ReturnType<typeof createPersonVerifier>
  metadata(): Record<string, unknown>
  /** Refills the revocation list from the database. */
  loadRevocations(database: Queryable): Promise<void>
  register(database: Database, body: unknown, log: SignInLog): Promise<TokenAnswer>
  authorize(
    database: Database,
    query: Record<string, string>,
    cookie: string | undefined,
    log: SignInLog,
  ): Promise<AuthorizeAnswer>
  token(
    database: Database,
    form: Record<string, string>,
    log: SignInLog,
    identity: Identity,
  ): Promise<TokenAnswer>
  revoke(database: Database, form: Record<string, string>, log: SignInLog): Promise<void>
  /** The sign-in in progress that this browser started, for the consent screen. */
  describeRequest(
    tx: Queryable,
    cookie: string | undefined,
    id: string,
  ): Promise<ConsentRequest | null>
  /** The person's answer on the consent screen: where the browser goes next. */
  decide(
    tx: Queryable,
    cookie: string | undefined,
    personId: string,
    id: string,
    allow: boolean,
    log: SignInLog,
  ): Promise<{ redirectTo: string } | null>
  connections(tx: Queryable, personId: string): Promise<Connection[]>
  disconnect(tx: Queryable, personId: string, id: string, log: SignInLog): Promise<boolean>
  /** Every person's open connections, for an administrator, the last used first. */
  everyConnection(tx: Queryable): Promise<PersonConnection[]>
  /**
   * An administrator ends one connection, or every open connection of one person, with a reason
   * the history log keeps. The count of connections it ended; null when the signed-in person is
   * no longer an administrator.
   */
  disconnectAsAdmin(
    tx: Queryable,
    target: { id: string } | { personId: string },
    reason: string,
    log: SignInLog,
  ): Promise<number | null>
}

/**
 * What the identity connector says about a signed-in person when a token is issued (FR-405):
 * their audience groups, read afresh at every sign-in and refresh. Missing groups mean the
 * audience for everyone only (CON-403).
 */
export interface Identity {
  groups(tx: Queryable, personId: string): Promise<readonly string[]>
}

export interface ConsentRequest {
  clientName: string
  /** How the client is known: by its own published document, or by a registration here. */
  clientKind: 'document' | 'registered'
  /** The host the client's description lives on (a document) or where the person returns to. */
  clientHost: string
  /** Where the browser goes after the answer, as a host name. */
  redirectHost: string
  scopes: PersonScope[]
  expiresAt: string
}
export interface Connection {
  id: string
  clientName: string
  clientHost: string
  scopes: PersonScope[]
  connectedAt: string
  /** When the app last got a token: an app in use gets one every ten minutes. */
  lastUsedAt: string
  expiresAt: string
}
export interface PersonConnection extends Connection {
  person: { id: string; name: string; initials: string; email: string | null }
}
type RevokeReason =
  | 'disconnected'
  | 'disconnected_by_admin'
  | 'refresh_reuse'
  | 'code_reuse'
  | 'revoked_by_client'
  | 'person_inactive'

/** The browser's sign-in cookie, when it holds exactly one well-formed value. */
export function browserToken(cookie: string | undefined): string | undefined {
  const values =
    cookie
      ?.split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${browserCookie}=`)) ?? []
  if (values.length !== 1) return undefined
  const value = values[0]!.slice(browserCookie.length + 1)
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined
}

const scopeList = (value: string | undefined): PersonScope[] | null => {
  if (value === undefined) return [...defaultScopes]
  const asked = value.split(' ').filter(Boolean)
  if (!asked.length || asked.some((s) => !(personScopes as readonly string[]).includes(s)))
    return null
  return personScopes.filter((s) => asked.includes(s))
}

const hostOf = (client: Client, redirect: string) =>
  client.kind === 'metadata_document' ? new URL(client.id).hostname : new URL(redirect).hostname

export function createLoginServer(options: {
  config: Builtin
  resource: string
  keys: KeyRing
  nodeEnv: string
  fetchDocument?: FetchMetadataDocument
  now?: () => Date
}): LoginServer {
  if (options.nodeEnv === 'production' && !options.resource.startsWith('https://'))
    throw new Error('The login server needs an https MCP address in production')
  const { config, resource, keys } = options
  const issuer = config.issuer
  const now = options.now ?? (() => new Date())
  const fetchDocument = options.fetchDocument ?? fetchMetadataDocument
  const revocations = createRevocations(now)
  const limitRefresh = createLimiter(now)
  const verifier = createPersonVerifier({
    issuer,
    resource,
    keys: localKeys(keys),
    algorithms: ['EdDSA'],
    requireAccessTokenType: true,
    isRevoked: (id, issuedAt) => revocations.has(id, issuedAt),
    now,
  })
  const seconds = () => Math.floor(now().getTime() / 1000)
  const at = (offsetSeconds: number) => new Date(now().getTime() + offsetSeconds * 1000)

  async function accessToken(grant: {
    id: string
    personId: string
    clientId: string
    scopes: string[]
    groups: readonly string[]
  }) {
    const issued = seconds()
    return new SignJWT({
      client_id: grant.clientId,
      scope: grant.scopes.join(' '),
      sid: grant.id,
      groups: [...grant.groups],
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid: keys.active.kid })
      .setIssuer(issuer)
      .setSubject(grant.personId)
      .setAudience(resource)
      .setIssuedAt(issued)
      .setExpirationTime(issued + accessTokenSeconds)
      .setJti(randomUUID())
      .sign(keys.active.privateKey)
  }

  /** Issues the next refresh token of a connection; the caller has used up the last one. */
  async function refreshToken(tx: Queryable, grantId: string, grantExpires: Date) {
    const token = `hrt_${secret()}`
    // Used tokens stay for reuse detection while they could still have worked; then they go.
    await tx.query('delete from auth.oauth_refresh_tokens where grant_id=$1 and expires_at <= $2', [
      grantId,
      now(),
    ])
    const idle = at(config.refreshIdleHours * 3600)
    await tx.query(
      'insert into auth.oauth_refresh_tokens(token_hash,grant_id,expires_at) values($1,$2,$3)',
      [digest(token), grantId, idle < grantExpires ? idle : grantExpires],
    )
    return token
  }

  /**
   * Ends a connection: its refresh tokens go, and the MCP server refuses its access tokens from
   * the next request. Every way a connection ends comes here. `step` is the reason an
   * administrator gave, and the batch the connections they ended at once share.
   */
  async function revokeGrant(
    tx: Queryable,
    grantId: string,
    reason: RevokeReason,
    actor: string | null,
    step: { reason: string; batchId: string | null } | null = null,
  ) {
    const [grant] = await tx.query<{ person: string; client: string; name: string }>(
      `update auth.oauth_grants g set revoked_at=$2, revoked_reason=$3
         from auth.oauth_clients c
        where g.id=$1 and c.id=g.client_id and g.revoked_at is null
        returning g.person_id::text as person, g.client_id as client, c.name`,
      [grantId, now(), reason],
    )
    await tx.query('delete from auth.oauth_refresh_tokens where grant_id=$1', [grantId])
    revocations.add(grantId)
    if (!grant) return false
    await tx.query(
      `insert into audit_log(actor_id,actor_kind,action,subject_type,subject_id,details,reason,batch_id)
       values($1,$2,$3,'ai_connection',$4,$5,$6,$7)`,
      [
        actor,
        actor ? 'person' : 'system',
        reason === 'disconnected' || reason === 'disconnected_by_admin'
          ? 'ai_client.disconnected'
          : 'ai_client.revoked',
        grantId,
        JSON.stringify({ reason, client: grant.name, person: grant.person }),
        step?.reason ?? null,
        step?.batchId ?? null,
      ],
    )
    return true
  }

  /** A connection row as the lists show it, with where the app came from. */
  const listed = (row: {
    id: string
    name: string
    kind: string
    clientId: string
    redirects: string[]
    scopes: PersonScope[]
    connectedAt: Date
    lastUsedAt: Date
    expiresAt: Date
  }): Connection => ({
    id: row.id,
    clientName: row.name,
    clientHost: hostOf(
      { id: row.clientId, kind: row.kind, name: row.name, redirectUris: row.redirects },
      row.redirects[0]!,
    ),
    scopes: row.scopes,
    connectedAt: row.connectedAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  })
  const connectionColumns = `g.id::text, c.name, c.kind, c.id as "clientId", c.redirect_uris as redirects, g.scopes,
                g.created_at as "connectedAt", g.last_used_at as "lastUsedAt", g.expires_at as "expiresAt"`

  /** The client by id: a metadata document read again now, or a dynamic registration. */
  async function findClient(
    database: Queryable,
    id: string,
  ): Promise<{ client: Client } | { reason: SignInReason; message: string }> {
    if (isMetadataDocumentId(id)) {
      if (metadataDocumentProblem(id))
        return {
          reason: 'bad_client_metadata',
          message: 'The agent describes itself in a way we can’t accept.',
        }
      let document: unknown
      try {
        document = await fetchDocument(id)
      } catch {
        return {
          reason: 'metadata_unreadable',
          message: 'We couldn’t read the agent’s description. Try again later.',
        }
      }
      const read = readClientMetadata(document, { metadataDocument: id })
      if ('problem' in read)
        return {
          reason: 'bad_client_metadata',
          message: 'The agent describes itself in a way we can’t accept.',
        }
      // Nothing is stored for a document app until a signed-in person allows it (decide).
      return { client: { id, kind: 'metadata_document', ...read.metadata } }
    }
    if (!config.dynamicRegistration || !/^hc_[A-Za-z0-9_-]{43}$/.test(id))
      return { reason: 'unknown_client', message: 'We don’t know this agent.' }
    const [row] = await database.query<Client>(
      `select id, kind, name, redirect_uris as "redirectUris" from auth.oauth_clients
        where id=$1 and kind='registered'`,
      [id],
    )
    return row
      ? { client: row }
      : { reason: 'unknown_client', message: 'We don’t know this agent.' }
  }

  return {
    config,
    issuer,
    resource,
    keys,
    revocations,
    verifier,

    metadata() {
      return {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        jwks_uri: `${issuer}/oauth/jwks`,
        ...(config.dynamicRegistration
          ? { registration_endpoint: `${issuer}/oauth/register` }
          : {}),
        scopes_supported: [...personScopes],
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
      }
    },

    async loadRevocations(database) {
      const rows = await database.query<{ id: string }>(
        'select id::text from auth.oauth_grants where revoked_at > $1',
        [at(-(accessTokenSeconds + 60))],
      )
      for (const row of rows) revocations.add(row.id)
      revocations.loaded()
    },

    async register(database, body, log) {
      if (!config.dynamicRegistration) {
        logSignIn(log, 'registration_refused', 'registration_off')
        return refused('invalid_request', 'Dynamic registration is off', 'registration_off', 404)
      }
      const read = readClientMetadata(body)
      if ('problem' in read) {
        logSignIn(log, 'registration_refused', 'bad_client_metadata')
        return refused('invalid_client_metadata', read.problem, 'bad_client_metadata')
      }
      const id = `hc_${secret()}`
      const answer = await database.transaction(null, async (tx) => {
        // A registration nobody ever connected with goes after a day; one whose connections
        // have all ended, after 30 days unused.
        await tx.query(
          `delete from auth.oauth_clients c where c.kind='registered'
             and ((c.created_at < $1 and not exists (select 1 from auth.oauth_grants g where g.client_id=c.id))
               or (c.last_used_at < $2 and not exists (select 1 from auth.oauth_grants g where g.client_id=c.id
                                                        and g.revoked_at is null and g.expires_at > $3)))`,
          [at(-unconnectedRegistrationDays * 86400), at(-unusedRegistrationDays * 86400), now()],
        )
        const [row] = await tx.query<{ issued: number }>(
          `insert into auth.oauth_clients(id,kind,name,redirect_uris,created_at,last_used_at)
           values($1,'registered',$2,$3,$4,$4) returning extract(epoch from created_at)::bigint as issued`,
          [id, read.metadata.name, read.metadata.redirectUris, now()],
        )
        return row!.issued
      })
      logSignIn(log, 'registered')
      return {
        ok: true,
        body: {
          client_id: id,
          client_id_issued_at: Number(answer),
          client_name: read.metadata.name,
          redirect_uris: read.metadata.redirectUris,
          grant_types: [...supportedGrantTypes],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      }
    },

    async authorize(database, query, cookie, log) {
      const page = (reason: SignInReason, message: string, status = 400): AuthorizeAnswer => {
        logSignIn(log, 'refused', reason)
        return { kind: 'page', status, message, reason }
      }
      const clientId = query.client_id
      if (!clientId || clientId.length > 512)
        return page('unknown_client', 'The agent didn’t say which agent it is.')
      const found = await findClient(database, clientId)
      if ('reason' in found) return page(found.reason, found.message)
      const { client } = found
      const redirect = query.redirect_uri
      if (!redirect || !redirectMatches(client.redirectUris, redirect))
        return page('bad_redirect', 'The agent asked to send you to an address it didn’t register.')
      // From here on, the client and where it gets its answer are known: errors go back there.
      const back = (error: string, description: string, reason: SignInReason): AuthorizeAnswer => {
        logSignIn(log, 'refused', reason)
        return {
          kind: 'redirect',
          reason,
          location: redirectWith(redirect, {
            error,
            error_description: description,
            state: query.state,
            iss: issuer,
          }),
        }
      }
      if (query.state !== undefined && query.state.length > 512)
        return back('invalid_request', 'state is too long', 'bad_request')
      if (query.response_type !== 'code')
        return back(
          'unsupported_response_type',
          'Only the code flow is supported',
          'unsupported_response_type',
        )
      if (query.code_challenge_method !== 'S256' || !query.code_challenge)
        return back('invalid_request', 'PKCE with S256 is required', 'pkce_required')
      if (!/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge))
        return back('invalid_request', 'code_challenge is not an S256 challenge', 'pkce_required')
      const scopes = scopeList(query.scope)
      if (!scopes) return back('invalid_scope', 'Unknown scope', 'bad_scope')
      if (query.resource !== undefined && query.resource !== resource)
        return back('invalid_target', 'Unknown resource', 'bad_resource')
      const id = secret()
      const browser = browserToken(cookie) ?? randomBytes(32).toString('hex')
      await database.transaction(null, async (tx) => {
        await tx.query('delete from auth.oauth_requests where expires_at <= $1', [now()])
        await tx.query(
          `insert into auth.oauth_requests(id_hash,browser_hash,client_id,client_kind,client_name,redirect_uri,scopes,state,code_challenge,expires_at)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            digest(id),
            digest(browser),
            client.id,
            client.kind,
            client.name,
            redirect,
            scopes,
            query.state ?? null,
            query.code_challenge,
            at(requestSeconds),
          ],
        )
      })
      logSignIn(log, 'requested')
      return {
        kind: 'consent',
        browser,
        location: redirectWith(config.consentUrl, { request: id }),
      }
    },

    async describeRequest(tx, cookie, id) {
      const browser = browserToken(cookie)
      if (!browser || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null
      // A sign-in another browser started is answered as one that does not exist.
      const [row] = await tx.query<{
        id: string
        kind: string
        name: string
        redirect: string
        scopes: PersonScope[]
        expiresAt: Date
      }>(
        `select r.client_id as id, r.client_kind as kind, r.client_name as name,
                r.redirect_uri as redirect, r.scopes, r.expires_at as "expiresAt"
           from auth.oauth_requests r
          where r.id_hash=$1 and r.browser_hash=$2 and r.expires_at > $3`,
        [digest(id), digest(browser), now()],
      )
      if (!row) return null
      return {
        clientName: row.name,
        clientKind: row.kind === 'metadata_document' ? 'document' : 'registered',
        clientHost: hostOf({ ...row, redirectUris: [row.redirect] }, row.redirect),
        redirectHost: new URL(row.redirect).hostname,
        scopes: row.scopes,
        expiresAt: row.expiresAt.toISOString(),
      }
    },

    async decide(tx, cookie, personId, id, allow, log) {
      const browser = browserToken(cookie)
      if (!browser || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null
      // One answer per sign-in: the request is taken out as it is answered.
      const [request] = await tx.query<{
        clientId: string
        clientKind: string
        clientName: string
        redirect: string
        scopes: PersonScope[]
        state: string | null
        challenge: string
      }>(
        `delete from auth.oauth_requests where id_hash=$1 and browser_hash=$2 and expires_at > $3
         returning client_id as "clientId", client_kind as "clientKind", client_name as "clientName",
                   redirect_uri as redirect, scopes, state, code_challenge as challenge`,
        [digest(id), digest(browser), now()],
      )
      if (!request) return null
      const back = (parameters: Record<string, string | undefined>) =>
        redirectWith(request.redirect, {
          ...parameters,
          state: request.state ?? undefined,
          iss: issuer,
        })
      if (!allow) {
        logSignIn(log, 'denied', 'person_denied', 'info')
        return {
          redirectTo: back({ error: 'access_denied', error_description: 'The person said no' }),
        }
      }
      if (request.clientKind === 'metadata_document') {
        // The app is stored now that a signed-in person allowed it; one that never got a
        // connection goes after a day.
        await tx.query(
          `delete from auth.oauth_clients c where c.kind='metadata_document' and c.last_used_at < $1
             and not exists (select 1 from auth.oauth_grants g where g.client_id=c.id)`,
          [at(-86400)],
        )
        await tx.query(
          `insert into auth.oauth_clients(id,kind,name,redirect_uris,last_used_at)
           values($1,'metadata_document',$2,$3,$4)
           on conflict (id) do update set name=excluded.name, last_used_at=excluded.last_used_at`,
          [request.clientId, request.clientName, [request.redirect], now()],
        )
      } else {
        // A registration removed while the person decided: the sign-in has ended.
        const [known] = await tx.query('select 1 from auth.oauth_clients where id=$1', [
          request.clientId,
        ])
        if (!known) return null
      }
      const code = secret()
      // A code is checked for reuse for an hour after it expired; then it goes.
      await tx.query('delete from auth.oauth_codes where expires_at <= $1', [at(-3600)])
      await tx.query(
        `insert into auth.oauth_codes(code_hash,client_id,person_id,redirect_uri,scopes,code_challenge,expires_at)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [
          digest(code),
          request.clientId,
          personId,
          request.redirect,
          request.scopes,
          request.challenge,
          at(codeSeconds),
        ],
      )
      logSignIn(log, 'approved')
      return { redirectTo: back({ code }) }
    },

    async token(database, form, log, identity) {
      const fail = (error: string, description: string, reason?: SignInReason, status = 400) => {
        if (reason) logSignIn(log, 'token_refused', reason)
        return refused(error, description, reason, status)
      }
      const clientId = form.client_id
      if (!clientId || clientId.length > 512)
        return fail('invalid_client', 'client_id is required', 'unknown_client', 401)
      if (form.client_secret !== undefined || form.client_assertion !== undefined)
        return fail(
          'invalid_client',
          'Clients do not authenticate with a secret',
          'unknown_client',
          401,
        )
      if (form.resource !== undefined && form.resource !== resource)
        return fail('invalid_target', 'Unknown resource', 'bad_resource')
      if (form.grant_type === 'authorization_code')
        return codeGrant(database, form, log, identity, fail)
      if (form.grant_type === 'refresh_token')
        return refreshGrant(database, form, log, identity, fail)
      return fail('unsupported_grant_type', 'Unsupported grant type', 'bad_request')
    },

    async revoke(database, form, log) {
      const token = form.token ?? ''
      const clientId = form.client_id ?? ''
      let grantId: string | undefined
      if (/^hrt_[A-Za-z0-9_-]{43}$/.test(token)) {
        const [row] = await database.query<{ grant: string; client: string }>(
          `select r.grant_id::text as grant, g.client_id as client from auth.oauth_refresh_tokens r
             join auth.oauth_grants g on g.id=r.grant_id where r.token_hash=$1`,
          [digest(token)],
        )
        if (row && row.client === clientId) grantId = row.grant
      } else if (token.length < 4096) {
        try {
          const { payload } = await jwtVerify(token, localKeys(keys), {
            issuer,
            audience: resource,
            algorithms: ['EdDSA'],
            typ: 'at+jwt',
            currentDate: now(),
          })
          if (payload.client_id === clientId && typeof payload.sid === 'string')
            grantId = payload.sid
        } catch {
          // RFC 7009: an unknown or invalid token is answered like a revoked one.
        }
      }
      if (!grantId) return
      const id = grantId
      const revoked = await database.transaction(null, (tx) =>
        revokeGrant(tx, id, 'revoked_by_client', null),
      )
      if (revoked) logSignIn(log, 'revoked', undefined)
    },

    async connections(tx, personId) {
      const rows = await tx.query<Parameters<typeof listed>[0]>(
        `select ${connectionColumns}
           from auth.oauth_grants g join auth.oauth_clients c on c.id=g.client_id
          where g.person_id=$1 and g.revoked_at is null and g.expires_at > $2
          order by g.created_at desc, g.id`,
        [personId, now()],
      )
      return rows.map(listed)
    },

    async everyConnection(tx) {
      const rows = await tx.query<
        Parameters<typeof listed>[0] & {
          personId: string
          personName: string
          email: string | null
        }
      >(
        `select ${connectionColumns}, p.id::text as "personId", p.display_name as "personName",
                case when p.erased_at is null then p.email end as email
           from auth.oauth_grants g join auth.oauth_clients c on c.id=g.client_id
           join public.people p on p.id=g.person_id
          where g.revoked_at is null and g.expires_at > $1
          order by g.last_used_at desc, g.id`,
        [now()],
      )
      return rows.map((row) => ({
        ...listed(row),
        person: {
          id: row.personId,
          name: row.personName,
          initials: initialsOf(row.personName),
          email: row.email,
        },
      }))
    },

    async disconnect(tx, personId, id, log) {
      const [grant] = await tx.query<{ id: string }>(
        'select id::text from auth.oauth_grants where id=$1 and person_id=$2 and revoked_at is null',
        [id, personId],
      )
      if (!grant) return false
      await revokeGrant(tx, grant.id, 'disconnected', personId)
      logSignIn(log, 'disconnected')
      return true
    },

    async disconnectAsAdmin(tx, target, reason, log) {
      // The policy let the request in; the database says again who is signed in and what they hold.
      const [actor] = await tx.query<{ admin: boolean; id: string | null }>(
        'select cl_is_admin_now() as admin, cl_person()::text as id',
      )
      if (!actor?.admin || !actor.id) return null
      const grants = await tx.query<{ id: string }>(
        `select id::text from auth.oauth_grants
          where ${'id' in target ? 'id' : 'person_id'}=$1 and revoked_at is null and expires_at > $2
          order by created_at, id for update`,
        ['id' in target ? target.id : target.personId, now()],
      )
      // The connections of one person ended in one step share a batch, as role changes do.
      const [batch] =
        'personId' in target && grants.length
          ? await tx.query<{ id: string }>('select uuidv7()::text as id')
          : []
      let ended = 0
      for (const grant of grants)
        if (
          await revokeGrant(tx, grant.id, 'disconnected_by_admin', actor.id, {
            reason,
            batchId: batch?.id ?? null,
          })
        )
          ended++
      if (ended) logSignIn(log, 'disconnected_by_admin')
      return ended
    },
  }

  async function codeGrant(
    database: Database,
    form: Record<string, string>,
    log: SignInLog,
    identity: Identity,
    fail: (e: string, d: string, r?: SignInReason, s?: number) => TokenAnswer,
  ): Promise<TokenAnswer> {
    const code = form.code ?? ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(code))
      return fail('invalid_grant', 'The code is not valid', 'code_unknown')
    if (!form.redirect_uri)
      return fail('invalid_request', 'redirect_uri is required', 'bad_request')
    if (!form.code_verifier)
      return fail('invalid_request', 'code_verifier is required', 'pkce_failed')
    // The code is used up by this attempt whatever its outcome, so it cannot be guessed at.
    const outcome = await database.transaction(null, async (tx) => {
      const [row] = await tx.query<{
        clientId: string
        personId: string
        redirect: string
        scopes: PersonScope[]
        challenge: string
        expiresAt: Date
        usedAt: Date | null
        grantId: string | null
      }>(
        `select client_id as "clientId", person_id::text as "personId", redirect_uri as redirect, scopes,
                code_challenge as challenge, expires_at as "expiresAt", used_at as "usedAt", grant_id::text as "grantId"
           from auth.oauth_codes where code_hash=$1 for update`,
        [digest(code)],
      )
      if (!row) return { reason: 'code_unknown' as const }
      if (row.usedAt) {
        // A code presented twice was copied: the connection it made is revoked (RFC 6749 4.1.2).
        if (row.grantId) await revokeGrant(tx, row.grantId, 'code_reuse', null)
        return { reason: 'code_reuse' as const }
      }
      await tx.query('update auth.oauth_codes set used_at=$2 where code_hash=$1', [
        digest(code),
        now(),
      ])
      if (row.expiresAt <= now()) return { reason: 'code_expired' as const }
      if (row.clientId !== form.client_id) return { reason: 'client_mismatch' as const }
      if (row.redirect !== form.redirect_uri) return { reason: 'redirect_mismatch' as const }
      if (
        !/^[A-Za-z0-9._~-]{43,128}$/.test(form.code_verifier!) ||
        !pkceMatches(form.code_verifier!, row.challenge)
      )
        return { reason: 'pkce_failed' as const }
      const person = await principalFor(tx, row.personId)
      if (!person) return { reason: 'person_inactive' as const }
      const expires = at(config.connectionDays * 86400)
      const [grant] = await tx.query<{ id: string }>(
        `insert into auth.oauth_grants(person_id,client_id,scopes,created_at,expires_at,last_used_at)
         values($1,$2,$3,$4,$5,$4) returning id::text`,
        [row.personId, row.clientId, row.scopes, now(), expires],
      )
      await tx.query('update auth.oauth_codes set grant_id=$2 where code_hash=$1', [
        digest(code),
        grant!.id,
      ])
      const [client] = await tx.query<{ name: string }>(
        'update auth.oauth_clients set last_used_at=$2 where id=$1 returning name',
        [row.clientId, now()],
      )
      await tx.query(
        `insert into audit_log(actor_id,actor_kind,action,subject_type,subject_id,details)
         values($1,'person','ai_client.connected','ai_connection',$2,$3)`,
        [row.personId, grant!.id, JSON.stringify({ client: client?.name, scopes: row.scopes })],
      )
      return {
        grant: {
          id: grant!.id,
          personId: row.personId,
          clientId: row.clientId,
          scopes: row.scopes,
          groups: await identity.groups(tx, row.personId),
        },
        refresh: await refreshToken(tx, grant!.id, expires),
      }
    })
    if ('reason' in outcome) return fail('invalid_grant', 'The code is not valid', outcome.reason)
    logSignIn(log, 'token_issued')
    return {
      ok: true,
      body: {
        access_token: await accessToken(outcome.grant),
        token_type: 'Bearer',
        expires_in: accessTokenSeconds,
        refresh_token: outcome.refresh,
        scope: outcome.grant.scopes.join(' '),
      },
    }
  }

  async function refreshGrant(
    database: Database,
    form: Record<string, string>,
    log: SignInLog,
    identity: Identity,
    fail: (e: string, d: string, r?: SignInReason, s?: number) => TokenAnswer,
  ): Promise<TokenAnswer> {
    const token = form.refresh_token ?? ''
    if (!/^hrt_[A-Za-z0-9_-]{43}$/.test(token))
      return fail('invalid_grant', 'The refresh token is not valid', 'refresh_unknown')
    const asked = form.scope === undefined ? undefined : scopeList(form.scope)
    if (asked === null) return fail('invalid_scope', 'Unknown scope', 'bad_scope')
    const outcome = await database.transaction(null, async (tx) => {
      const [row] = await tx.query<{
        grantId: string
        usedAt: Date | null
        expiresAt: Date
        clientId: string
        personId: string
        scopes: PersonScope[]
        grantExpires: Date
        revokedAt: Date | null
      }>(
        `select r.grant_id::text as "grantId", r.used_at as "usedAt", r.expires_at as "expiresAt",
                g.client_id as "clientId", g.person_id::text as "personId", g.scopes,
                g.expires_at as "grantExpires", g.revoked_at as "revokedAt"
           from auth.oauth_refresh_tokens r join auth.oauth_grants g on g.id=r.grant_id
          where r.token_hash=$1 for update of r, g`,
        [digest(token)],
      )
      if (!row) return { reason: 'refresh_unknown' as const }
      if (row.usedAt || row.clientId !== form.client_id) {
        // A used refresh token presented again, or by another client, was copied: the whole
        // connection is revoked, so neither copy works any more.
        await revokeGrant(tx, row.grantId, 'refresh_reuse', null)
        return { reason: 'refresh_reuse' as const }
      }
      if (row.revokedAt) return { reason: 'connection_revoked' as const }
      const retry = limitRefresh([
        { key: `oauth:refresh:${row.grantId}`, limit: refreshesPerMinute },
      ])
      if (retry) return { retry }
      await tx.query('update auth.oauth_refresh_tokens set used_at=$2 where token_hash=$1', [
        digest(token),
        now(),
      ])
      if (row.expiresAt <= now() || row.grantExpires <= now())
        return { reason: 'refresh_expired' as const }
      if (asked && asked.some((scope) => !row.scopes.includes(scope)))
        return { reason: 'bad_scope' as const }
      const person = await principalFor(tx, row.personId)
      if (!person) {
        await revokeGrant(tx, row.grantId, 'person_inactive', null)
        return { reason: 'person_inactive' as const }
      }
      await tx.query('update auth.oauth_grants set last_used_at=$2 where id=$1', [
        row.grantId,
        now(),
      ])
      return {
        grant: {
          id: row.grantId,
          personId: row.personId,
          clientId: row.clientId,
          scopes: asked ?? row.scopes,
          groups: await identity.groups(tx, row.personId),
        },
        refresh: await refreshToken(tx, row.grantId, row.grantExpires),
      }
    })
    if ('retry' in outcome)
      return {
        ok: false,
        status: 429,
        error: 'temporarily_unavailable',
        description: `Too many refreshes; retry after ${outcome.retry} seconds`,
        retryAfter: outcome.retry,
      }
    if ('reason' in outcome)
      return outcome.reason === 'bad_scope'
        ? fail('invalid_scope', 'The scope is wider than the connection', 'bad_scope')
        : fail('invalid_grant', 'The refresh token is not valid', outcome.reason)
    logSignIn(log, 'refreshed')
    return {
      ok: true,
      body: {
        access_token: await accessToken(outcome.grant),
        token_type: 'Bearer',
        expires_in: accessTokenSeconds,
        refresh_token: outcome.refresh,
        scope: outcome.grant.scopes.join(' '),
      },
    }
  }
}
