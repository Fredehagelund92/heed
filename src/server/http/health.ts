import type { FastifyInstance } from 'fastify'
import type { Database } from '../db/database.ts'
import { heedVersion } from '../version.ts'

/**
 * `GET /health` answers while the process runs (liveness). `GET /health/ready` also asks the
 * database and answers 503 when it cannot reach it (readiness), so a load balancer stops sending
 * traffic without restarting the process. Both name the version that runs (package.json), so an
 * operator can tell which release answers.
 */
export function registerHealthRoutes(app: FastifyInstance, database: Database): void {
  app.get('/health', () => ({ status: 'ok', service: 'heed', version: heedVersion }))

  app.get('/health/ready', async (request, reply) => {
    try {
      await database.ping()
      return { status: 'ok', service: 'heed', version: heedVersion, checks: { database: 'ok' } }
    } catch (error) {
      request.log.error({ err: error }, 'readiness check: database unreachable')
      return reply.code(503).send({
        status: 'unavailable',
        service: 'heed',
        version: heedVersion,
        checks: { database: 'unavailable' },
      })
    }
  })
}
