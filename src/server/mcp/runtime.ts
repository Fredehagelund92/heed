import { createRemoteJWKSet } from 'jose'
import pg from 'pg'
import type { Logger } from 'pino'
import type { Config } from '../config/env.ts'
import { calendarDateTypes } from '../db/database.ts'
import { createEditionSource } from '../modules/editions/index.ts'
import type { LoginServer } from '../modules/oauth/index.ts'
import {
  createDevVerifier,
  createIssuerVerifier,
  createPersonVerifier,
  devIssuer,
  devKey,
  type TokenVerifier,
} from './auth.ts'
import { loadStateKey } from './state-key.ts'
import { createAnonymousStore } from './store.ts'

/**
 * The MCP server's dependencies. It verifies every token itself (FR-402), choosing by issuer: dev
 * tokens from `npm run token:dev`, and a person's tokens from the login server the settings name
 * (FR-404): the built-in one, whose keys it holds, or another one, whose key set it reads.
 */
export async function createMcpDependencies(config: Config, logger: Logger, login?: LoginServer) {
  const key = await devKey(config.mcpDevKeyFile, config.nodeEnv)
  const pool = new pg.Pool({
    connectionString: config.databaseServeUrl,
    application_name: 'heed-serve',
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    types: calendarDateTypes,
  })
  pool.on('error', () =>
    logger.error({ reason: 'connection_failed' }, 'serving database connection failed'),
  )
  const verifiers = new Map<string, TokenVerifier>([
    [devIssuer, createDevVerifier(key, config.mcpResourceUrl, config.nodeEnv)],
  ])
  const servers: string[] = []
  if (config.loginServer.kind === 'builtin' && login) {
    verifiers.set(login.issuer, login.verifier)
    servers.push(login.issuer)
  }
  if (config.loginServer.kind === 'external') {
    const { issuer, jwksUrl } = config.loginServer
    verifiers.set(
      issuer,
      createPersonVerifier({
        issuer,
        resource: config.mcpResourceUrl,
        keys: createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 5000 }),
        algorithms: ['EdDSA', 'ES256', 'RS256', 'PS256'],
        requireAccessTokenType: false,
      }),
    )
    servers.push(issuer)
  }
  const stateKey = await loadStateKey(config.mcpStateKeyFile, config.nodeEnv)
  if (!stateKey)
    logger.warn(
      'CL_MCP_STATE_KEY_FILE does not exist: draft_context lists its questions instead of asking them in the AI app',
    )
  return {
    ...(stateKey ? { stateKey } : {}),
    source: createEditionSource(pool),
    store: createAnonymousStore(pool),
    verifier: createIssuerVerifier(verifiers),
    resource: config.mcpResourceUrl,
    authorizationServers: servers,
    close: () => pool.end(),
  }
}
