import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { SignJWT, decodeJwt, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import type { AgentKind, AgentToolName } from '../../domain/agents.ts'

export type Principal = {
  client: string
  scopes: readonly string[]
  caller: 'agent' | 'eval'
  canSelectEdition: boolean
  /**
   * The person a login server signed in (`sub`); absent for a dev token or an access key, which
   * are no person.
   * Only the per-person rate count reads it, as a digest; it never enters a record or a log line.
   */
  subject?: string
  /** Audience groups from the verified identity (FR-405). Groups are parked: serving ignores them. */
  groups?: readonly string[]
  /**
   * The built-in login server's connection the token belongs to (`sid`), which names the agent.
   * Like `subject`, it never enters a record or a log line.
   */
  connection?: string
  /**
   * The agent Heed knows the token as (FR-420): an app a person connected, or an access key, with
   * the tools an admin left on for it now. The gateway offers and runs only those, and only where
   * `scopes` allow them too. Absent for a token Heed keeps no agent for: a dev token, or one from
   * another login server.
   */
  agent?: { kind: AgentKind; id: string; tools: readonly AgentToolName[] }
}
export interface TokenVerifier {
  verify(token: string): Promise<Principal>
}
export const devIssuer = 'urn:heed:local'

/** Why a token was refused, as a closed set of reason codes for the log (FR-411). */
export type TokenFailure =
  | 'malformed'
  | 'unknown_issuer'
  | 'bad_signature'
  | 'expired'
  | 'wrong_audience'
  | 'bad_claims'
  | 'revoked'
  | 'unknown_key'

export class TokenError extends Error {
  override name = 'TokenError'
  readonly reason: TokenFailure
  /** The client label, when the issuer that refused it names one. Never the token's own text. */
  readonly client: string
  constructor(reason: TokenFailure, client = 'unknown') {
    super(`Token refused: ${reason}`)
    this.reason = reason
    this.client = client
  }
}

/** The reason code of a verification failure; the library's message never reaches a log. */
function failureOf(error: unknown): TokenFailure {
  if (error instanceof TokenError) return error.reason
  if (error instanceof errors.JWTExpired) return 'expired'
  if (error instanceof errors.JWTClaimValidationFailed)
    return error.claim === 'aud'
      ? 'wrong_audience'
      : error.claim === 'iss'
        ? 'unknown_issuer'
        : 'bad_claims'
  if (
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JOSEAlgNotAllowed
  )
    return 'bad_signature'
  return 'malformed'
}

/** The scopes a person's token can carry (FR-414). Anything else in a token is ignored. */
export const personScopes = ['read', 'feedback', 'propose'] as const
/**
 * The one client label for every agent a person signs in with (`client_policies`): records
 * and logs name it, never the person or the app's self-chosen name (FR-410).
 */
export const signedInClient = 'signed-in'
/** The longest lifetime the MCP server accepts in a person's token, whoever issued it. */
const maxPersonTokenSeconds = 3600
const maxPersonTokenAge = '1h'

/**
 * Verifies a person's access token from one login server (FR-402): its signature with that
 * server's keys, the issuer, the audience (this MCP resource), the expiry and the claims. The
 * built-in login server's tokens also name their connection (`sid`), which a disconnect revokes.
 */
export function createPersonVerifier(options: {
  issuer: string
  resource: string
  keys: JWTVerifyGetKey
  algorithms: readonly string[]
  /** RFC 9068's `at+jwt`. The built-in login server always sets it. */
  requireAccessTokenType: boolean
  /** Whether the connection was revoked; `issuedAt` is the token's `iat`, in seconds. */
  isRevoked?: (connection: string, issuedAt: number) => boolean
  /** The clock of the login server that issues the tokens. */
  now?: () => Date
}): TokenVerifier {
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, options.keys, {
          issuer: options.issuer,
          audience: options.resource,
          algorithms: [...options.algorithms],
          requiredClaims: ['exp', 'iat', 'sub', 'client_id', 'scope'],
          maxTokenAge: maxPersonTokenAge,
          clockTolerance: 5,
          ...(options.now ? { currentDate: options.now() } : {}),
          ...(options.requireAccessTokenType ? { typ: 'at+jwt' } : {}),
        })
        const { sub, scope, groups, sid } = payload
        if (
          payload.exp! - payload.iat! > maxPersonTokenSeconds ||
          typeof sub !== 'string' ||
          !sub ||
          sub.length > 255 ||
          typeof payload.client_id !== 'string' ||
          typeof scope !== 'string' ||
          (groups !== undefined &&
            (!Array.isArray(groups) ||
              groups.length > 100 ||
              groups.some((g) => typeof g !== 'string' || !g || g.length > 100))) ||
          (sid !== undefined && typeof sid !== 'string')
        )
          throw new TokenError('bad_claims')
        if (typeof sid === 'string' && options.isRevoked?.(sid, payload.iat!))
          throw new TokenError('revoked')
        const scopes = personScopes.filter((known) => scope.split(' ').includes(known))
        if (!scopes.length) throw new TokenError('bad_claims')
        return {
          client: signedInClient,
          scopes,
          caller: 'agent',
          canSelectEdition: false,
          subject: sub,
          groups: (groups as string[] | undefined) ?? [],
          ...(typeof sid === 'string' ? { connection: sid } : {}),
        }
      } catch (error) {
        throw new TokenError(failureOf(error), signedInClient)
      }
    },
  }
}

/** Which agent a connection signs in as, and its tools on; null when Heed keeps no agent for it. */
export type AgentCheck = (
  connection: string,
) => Promise<{ agentId: string; tools: readonly AgentToolName[] } | null>

/**
 * Names the agent behind a person's token (FR-420) with the tools an admin left on for it, asked
 * at every request so a switch acts at the next one. A token that names no connection passes as
 * it is.
 */
export function withAgents(tokens: TokenVerifier, check: AgentCheck): TokenVerifier {
  return {
    async verify(token) {
      const principal = await tokens.verify(token)
      if (!principal.connection) return principal
      const agent = await check(principal.connection)
      if (!agent) return principal
      return { ...principal, agent: { kind: 'app', id: agent.agentId, tools: agent.tools } }
    },
  }
}

/**
 * Picks the verifier by the token's issuer, read before verification, and lets that verifier
 * check everything, the issuer included. An issuer nobody configured is refused.
 */
export function createIssuerVerifier(byIssuer: ReadonlyMap<string, TokenVerifier>): TokenVerifier {
  return {
    async verify(token) {
      let issuer: unknown
      try {
        issuer = decodeJwt(token).iss
      } catch {
        throw new TokenError('malformed')
      }
      const verifier = typeof issuer === 'string' ? byIssuer.get(issuer) : undefined
      if (!verifier) throw new TokenError('unknown_issuer')
      return verifier.verify(token)
    },
  }
}

export async function devKey(path: string, nodeEnv: string): Promise<KeyObject> {
  if (nodeEnv === 'production') throw new Error('Dev MCP tokens are refused in production')
  try {
    return createPrivateKey(await readFile(path))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const { privateKey } = generateKeyPairSync('ed25519')
    try {
      await writeFile(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
        flag: 'wx',
        mode: 0o600,
      })
    } catch (writeError) {
      if (!(writeError instanceof Error && 'code' in writeError && writeError.code === 'EEXIST'))
        throw writeError
    }
    return createPrivateKey(await readFile(path))
  }
}

export function mintDevToken(
  key: KeyObject,
  resource: string,
  options: { client?: string; scopes?: string[]; expiresIn?: string } = {},
) {
  return new SignJWT({
    client_id: options.client ?? 'claude-code',
    scope: (options.scopes ?? ['read', 'feedback']).join(' '),
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt' })
    .setIssuer(devIssuer)
    .setAudience(resource)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '8h')
    .sign(key)
}

export function createDevVerifier(
  key: KeyObject,
  resource: string,
  nodeEnv: string,
): TokenVerifier {
  if (nodeEnv === 'production') throw new Error('Dev MCP tokens are refused in production')
  const publicKey = createPublicKey(key)
  const cache = new Map<string, { principal: Principal; until: number }>()
  return {
    async verify(token) {
      const hash = createHash('sha256').update(token).digest('hex')
      const cached = cache.get(hash)
      if (cached && cached.until > Date.now()) return cached.principal
      let payload: JWTPayload
      try {
        ;({ payload } = await jwtVerify(token, publicKey, {
          issuer: devIssuer,
          audience: resource,
          algorithms: ['EdDSA'],
          requiredClaims: ['exp', 'iat', 'client_id', 'scope'],
        }))
      } catch (error) {
        throw new TokenError(failureOf(error))
      }
      if (
        typeof payload.client_id !== 'string' ||
        !/^[a-z0-9_.-]{1,40}$/.test(payload.client_id) ||
        typeof payload.scope !== 'string'
      )
        throw new TokenError('bad_claims')
      const scopes = payload.scope.split(' ').filter(Boolean)
      // A dev token names a client label and scopes, never a person or a group: identity claims
      // in it are dropped, so only a login server's verified token carries a person.
      const principal: Principal = {
        client: payload.client_id,
        scopes,
        caller: payload.client_id === 'eval' ? 'eval' : 'agent',
        canSelectEdition: scopes.includes('edition'),
      }
      cache.set(hash, { principal, until: Math.min(Date.now() + 60000, payload.exp! * 1000) })
      if (cache.size > 1000) cache.delete(cache.keys().next().value!)
      return principal
    },
  }
}
