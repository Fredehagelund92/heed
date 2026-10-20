import pg from 'pg'
import { loadConfig } from './config/env.ts'
import { databaseFromPool } from './db/database.ts'
import {
  ConnectorRegistry,
  ConnectorService,
  configuredSource,
} from './modules/connectors/index.ts'

const config = loadConfig(process.env)
const source = configuredSource(config)
const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 2000 })
try {
  const service = new ConnectorService(databaseFromPool(pool), new ConnectorRegistry([source]))
  const result = await service.sync(source.id)
  console.log(JSON.stringify(result))
  if (result.status === 'failed') process.exitCode = 1
} finally {
  await pool.end()
}
