import {
  createDevSignIn,
  createOidcSignIn,
  readClientSecret,
  readDevPeople,
  type SignIn,
} from './modules/auth/index.ts'
import { createMcpDependencies } from './mcp/runtime.ts'
import { buildApp } from './app.ts'
import { systemClock } from './clock.ts'
import { ConfigError, describeDatabase, loadConfig, type Config } from './config/env.ts'
import { createDatabase } from './db/database.ts'
import {
  ConnectorRegistry,
  configuredSource,
  connectorSyncJob,
  createWorkspaceSources,
  noSecretStore,
  openLocalSecretStore,
  type SecretStore,
} from './modules/connectors/index.ts'
import { evalJobs } from './modules/evals/index.ts'
import { alertsJob } from './modules/alerts/index.ts'
import { gapDetectionJob } from './modules/gaps/index.ts'
import { savedCheckJob } from './modules/saved-questions/index.ts'
import { createJobRunner, maintenanceJobs } from './modules/jobs/index.ts'
import {
  checkModelSettings,
  createModelPort,
  ModelConfigError,
  readModelSettings,
} from './modules/models/index.ts'
import { createRelay, outboxRelayJob } from './modules/notifications/index.ts'
import { createLoginServer, loadKeyRing } from './modules/oauth/index.ts'
import { snapshotJob, weeklyRollupJob } from './modules/observability/index.ts'
import { createPageReader } from './modules/web/index.ts'
import { createLogger } from './observability/logger.ts'

/** Composition root: configuration, logging, database, jobs, HTTP, and a graceful shutdown. */

function readConfig(): Config | undefined {
  try {
    return loadConfig(process.env)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.message)
    process.exitCode = 1
    return undefined
  }
}

async function main(): Promise<void> {
  const config = readConfig()
  if (!config) return

  const logger = createLogger({ level: config.logLevel })
  logger.info(
    {
      nodeEnv: config.nodeEnv,
      database: describeDatabase(config.databaseUrl),
      auth: config.auth,
      oidcIssuer: config.oidc?.issuer ?? null,
      fixedToday: config.fixedToday ?? null,
      models: config.models,
      cubeModelDir: config.cubeModelDir ?? null,
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
      `Sign-in is the people picker (CL_AUTH=${config.auth}): anyone who can reach this service can sign in as any person, an administrator included. Only for trying it out on this computer; for real people, set NODE_ENV=production and sign people in with your OpenID Connect provider (docs/operations.md).`,
    )

  const clock = systemClock(config.fixedToday)
  const database = createDatabase(config.databaseUrl, logger)
  let models
  try {
    models = createModelPort({ mode: config.models, env: config.modelEnv })
    // With real models, every role's provider and model must be one this service can serve
    // before it listens. Without the database the check waits for each use and each change.
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
    logger.fatal(error.message)
    await database.close()
    process.exitCode = 1
    return
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
      logger.fatal(error instanceof Error ? error.message : 'the login server could not start')
      await database.close()
      process.exitCode = 1
      return
    }
    // A disconnect shortly before a restart still refuses that connection's access tokens. Until
    // the list is read, tokens issued before the start are refused (revocations), so it is
    // read again every 30 seconds until it works.
    const loginServer = login
    const loadRevocations = () =>
      loginServer.loadRevocations(database).then(
        () => true,
        () => {
          logger.warn('recent disconnects not read: the database is not reachable')
          return false
        },
      )
    if (!(await loadRevocations())) {
      const retry = setInterval(() => {
        void loadRevocations().then((done) => {
          if (done) clearInterval(retry)
        })
      }, 30_000)
      retry.unref()
    }
  }
  // How people sign in (CL_AUTH): the picker from a local file, or the company's OIDC provider.
  let signIn: SignIn
  if (config.oidc) {
    let clientSecret: string | null = null
    if (config.oidc.clientSecretFile !== null) {
      try {
        clientSecret = await readClientSecret(config.oidc.clientSecretFile)
      } catch (error) {
        // The message names the setting and the file, never the secret.
        logger.fatal(error instanceof Error ? error.message : 'the client secret could not be read')
        await database.close()
        process.exitCode = 1
        return
      }
    }
    signIn = createOidcSignIn({
      settings: { ...config.oidc, clientSecret },
      database,
      webOrigin: config.webOrigins[0]!,
      lifetime: config.sessions,
    })
  } else {
    signIn = createDevSignIn(await readDevPeople(config.devPeopleFile), config.nodeEnv, {
      method: config.auth === 'demo' ? 'demo' : 'dev',
      lifetime: config.sessions,
    })
  }
  let secrets: SecretStore = noSecretStore
  if (config.secretsDir !== undefined) {
    try {
      secrets = await openLocalSecretStore(config.secretsDir)
    } catch (error) {
      // The message names the folder and what is wrong with it, never a secret.
      logger.fatal(error instanceof Error ? error.message : 'the secret store could not open')
      await database.close()
      process.exitCode = 1
      return
    }
  }
  const mcp = await createMcpDependencies(config, logger, login)
  const sources = new ConnectorRegistry([configuredSource(config)], {
    secrets,
    worker: config.cubeCompile,
  })
  const workspaceSources = createWorkspaceSources({ secrets, registry: sources })
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
    mcp,
    clock,
    models,
    signIn,
    origins: config.webOrigins,
    trustedProxies: config.trustedProxies,
    nodeEnv: config.nodeEnv,
    metricsToken: config.metricsToken,
    // The end-to-end tests serve their web pages on this machine; elsewhere, the public web only.
    ...(config.webReadLoopback ? { readPage: createPageReader({ loopback: true }) } : {}),
    login,
  })
  app.addHook('preClose', () => relay.stop())

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'shutting down')
    app.close().then(
      () => logger.info('stopped'),
      (error: unknown) => {
        logger.error({ err: error }, 'shutdown failed')
        process.exitCode = 1
      },
    )
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (error) {
    logger.fatal({ err: error }, 'could not start')
    await app.close()
    process.exitCode = 1
    return
  }
  // The runner keeps retrying while the database is down; HTTP and readiness answer meanwhile.
  void jobs.start()
  relay.start()
}

await main()
