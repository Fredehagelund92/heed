import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import type { Logger } from 'pino'
import {
  createDevSignIn,
  createOidcSignIn,
  readClientSecret,
  readDevPeople,
  type DevPerson,
  type SignIn,
} from './modules/auth/index.ts'
import { createMcpDependencies } from './mcp/runtime.ts'
import { buildApp } from './app.ts'
import { systemClock, type Clock } from './clock.ts'
import { describeDatabase, type Config } from './config/env.ts'
import { createDatabase, type Database } from './db/database.ts'
import {
  ConnectorRegistry,
  configuredSources,
  connectorSyncJob,
  createWorkspaceSources,
  noSecretStore,
  openLocalSecretStore,
  readFigureOverrides,
  type FigureOverrides,
  type SecretStore,
} from './modules/connectors/index.ts'
import { evalJobs } from './modules/evals/index.ts'
import { alertsJob } from './modules/alerts/index.ts'
import { gapDetectionJob } from './modules/gaps/index.ts'
import { savedCheckJob } from './modules/saved-questions/index.ts'
import { createJobRunner, maintenanceJobs, type JobRunner } from './modules/jobs/index.ts'
import {
  checkModelSettings,
  createModelPort,
  ModelConfigError,
  readModelSettings,
} from './modules/models/index.ts'
import { createRelay, outboxRelayJob, type Relay } from './modules/notifications/index.ts'
import { createLoginServer, loadKeyRing } from './modules/oauth/index.ts'
import { snapshotJob, weeklyRollupJob } from './modules/observability/index.ts'
import { createPageReader } from './modules/web/index.ts'

/**
 * The service, composed from its configuration: the database, sign-in, the models, the job
 * runner, the outbox relay and the HTTP app. Nothing listens yet, and the runner and the relay wait
 * to be started. The long-running process (main.ts) listens and starts both; the Vercel function
 * (vercel.ts) starts neither and answers one request at a time.
 */

export interface Service {
  app: FastifyInstance
  database: Database
  jobs: JobRunner
  relay: Relay
}

export interface ServiceOptions {
  /** The MCP server and its serving pool. Off where /mcp is not served. Default on. */
  mcp?: boolean
  /** The picker's people, when they are not read from HEED_DEV_PEOPLE_FILE. */
  devPeople?: readonly DevPerson[]
  /** The application pool's size, and a hook that is handed the pool once it exists. */
  pool?: { max?: number; attach?: (pool: pg.Pool) => void }
}

/** Why the service could not be composed. The message names the setting, never a secret. */
export class ServiceError extends Error {
  override name = 'ServiceError'
}

/** The start-up log lines: what is configured, and a warning when anyone can sign in as anyone. */
export function logConfiguration(config: Config, logger: Logger): void {
  logger.info(
    {
      nodeEnv: config.nodeEnv,
      database: describeDatabase(config.databaseUrl),
      auth: config.auth,
      oidcIssuer: config.oidc?.issuer ?? null,
      fixedToday: config.fixedToday ?? null,
      models: config.models,
      cubeModelDir: config.cubeModelDir ?? null,
      serverFolders: Object.keys(config.serverFolders),
      secretStore: config.secretsDir === undefined ? 'off' : 'local',
      metrics: config.metricsToken === undefined ? 'off' : 'on',
      webReadLoopback: config.webReadLoopback ? 'on' : 'off',
      loginServer: config.loginServer.kind,
      trustedProxies: config.trustedProxies,
    },
    'configuration loaded',
  )
  // The pickers let anyone who reaches the service in as anyone, administrators included.
  if (config.auth !== 'oidc')
    logger.warn(
      `Sign-in is the people picker (HEED_AUTH=${config.auth}): anyone who can reach this service can sign in as any person, an administrator included. Only for trying it out on this computer; for real people, set NODE_ENV=production and sign people in with your OpenID Connect provider (docs/operations.md).`,
    )
}

/** Composes the service. When that fails, the database pool it opened is closed again. */
export async function createService(
  config: Config,
  logger: Logger,
  options: ServiceOptions = {},
): Promise<Service> {
  const clock = systemClock(config.fixedToday)
  const database = createDatabase(config.databaseUrl, logger, options.pool)
  try {
    return await compose(config, logger, options, clock, database)
  } catch (error) {
    await database.close()
    throw error
  }
}

async function compose(
  config: Config,
  logger: Logger,
  options: ServiceOptions,
  clock: Clock,
  database: Database,
): Promise<Service> {
  let models
  try {
    models = createModelPort({ mode: config.models, env: config.modelEnv })
    // With real models, every role's provider and model must be one this service can serve
    // before it answers. Without the database the check waits for each use and each change.
    if (models.mode === 'live') {
      const settings = await readModelSettings(database).catch((error: unknown) => {
        if (error instanceof ModelConfigError) throw error
        logger.warn({ err: error }, 'model settings not checked: the database is not reachable')
        return null
      })
      if (settings) checkModelSettings(models, settings)
    }
  } catch (error) {
    if (!(error instanceof ModelConfigError)) throw error
    throw new ServiceError(error.message)
  }
  let login
  if (config.loginServer.kind === 'builtin') {
    try {
      login = createLoginServer({
        config: config.loginServer,
        resource: config.mcpResourceUrl,
        keys: await loadKeyRing({
          file: config.loginServer.signingKeyFile,
          previousFiles: config.loginServer.previousKeyFiles,
          nodeEnv: config.nodeEnv,
        }),
        nodeEnv: config.nodeEnv,
        now: () => clock.now(),
      })
    } catch (error) {
      // The message names the setting and the file, never key material.
      throw new ServiceError(
        error instanceof Error ? error.message : 'the login server could not start',
      )
    }
  }
  // How people sign in (HEED_AUTH): the picker from a local file, or the company's OIDC provider.
  let signIn: SignIn
  if (config.oidc) {
    let clientSecret: string | null = null
    if (config.oidc.clientSecretFile !== null) {
      try {
        clientSecret = await readClientSecret(config.oidc.clientSecretFile)
      } catch (error) {
        // The message names the setting and the file, never the secret.
        throw new ServiceError(
          error instanceof Error ? error.message : 'the client secret could not be read',
        )
      }
    }
    signIn = createOidcSignIn({
      settings: { ...config.oidc, clientSecret },
      database,
      webOrigin: config.webOrigins[0]!,
      lifetime: config.sessions,
    })
  } else {
    signIn = createDevSignIn(
      options.devPeople ?? (await readDevPeople(config.devPeopleFile)),
      config.nodeEnv,
      { method: config.auth === 'demo' ? 'demo' : 'dev', lifetime: config.sessions },
    )
  }
  let secrets: SecretStore = noSecretStore
  if (config.secretsDir !== undefined) {
    try {
      secrets = await openLocalSecretStore(config.secretsDir)
    } catch (error) {
      // The message names the folder and what is wrong with it, never a secret.
      throw new ServiceError(
        error instanceof Error ? error.message : 'the secret store could not open',
      )
    }
  }
  const mcp = options.mcp === false ? undefined : await createMcpDependencies(config, logger, login)
  const sources = new ConnectorRegistry(configuredSources(config), {
    secrets,
    worker: config.cubeCompile,
  })
  let figureOverrides: FigureOverrides | undefined
  if (config.figureOverridesFile !== undefined) {
    try {
      figureOverrides = await readFigureOverrides(config.figureOverridesFile)
    } catch (error) {
      throw new ServiceError(error instanceof Error ? error.message : 'HEED_FIGURE_OVERRIDES')
    }
  }
  const workspaceSources = createWorkspaceSources({
    secrets,
    registry: sources,
    ...(figureOverrides ? { figureOverrides } : {}),
  })
  const jobs = createJobRunner({
    connectionString: config.databaseUrl,
    database,
    logger,
    jobs: [
      ...maintenanceJobs,
      outboxRelayJob,
      gapDetectionJob,
      alertsJob({ clock }),
      weeklyRollupJob({ clock }),
      snapshotJob({ clock }),
      connectorSyncJob(sources, { clock }),
      savedCheckJob({ clock }),
      ...evalJobs({ port: models, clock }),
    ],
  })
  const relay = createRelay({ connectionString: config.databaseUrl, database, logger })
  const app = buildApp({
    database,
    jobs,
    sources,
    workspaceSources,
    logger,
    ...(mcp ? { mcp } : {}),
    clock,
    models,
    signIn,
    origins: config.webOrigins,
    trustedProxies: config.trustedProxies,
    nodeEnv: config.nodeEnv,
    metricsToken: config.metricsToken,
    askLoop: config.askLoop,
    profileLabel: config.profileLabel,
    // The end-to-end tests serve their web pages on this machine; elsewhere, the public web only.
    ...(config.webReadLoopback ? { readPage: createPageReader({ loopback: true }) } : {}),
    login,
  })
  app.addHook('preClose', () => relay.stop())
  return { app, database, jobs, relay }
}
