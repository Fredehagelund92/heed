import { ConfigError, loadConfig, type Config } from './config/env.ts'
import { createLogger } from './observability/logger.ts'
import { createService, logConfiguration, ServiceError, type Service } from './service.ts'

/**
 * The long-running service: configuration, logging, the service (service.ts), HTTP on a port, the
 * job runner, the outbox relay, and a graceful shutdown.
 */

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
  logConfiguration(config, logger)
  let service: Service
  try {
    service = await createService(config, logger)
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error
    logger.fatal(error.message)
    process.exitCode = 1
    return
  }
  const { app, jobs, relay } = service

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
