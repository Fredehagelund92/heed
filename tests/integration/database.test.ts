import {
  itemKinds,
  riskLevels,
  claimLevels,
  creationChannels,
  areaStates,
  checkFlags,
} from '../../src/domain/item.ts'
import { describe, expect, it } from 'vitest'
import { testDatabase } from './support.ts'
import { buildApp } from '../../src/server/app.ts'
import { createDatabase } from '../../src/server/db/database.ts'
import { createJobRunner } from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'

const { client, url: databaseUrl } = testDatabase()

describe('PostgreSQL', () => {
  it('is version 18', async () => {
    const result = await client.query<{ server_version_num: string }>('show server_version_num')
    const major = Math.floor(Number(result.rows[0]?.server_version_num) / 10_000)
    expect(major).toBe(18)
  })

  it('makes the service ready', async () => {
    const logger = createLogger({ level: 'silent' })
    const database = createDatabase(databaseUrl, logger)
    const jobs = createJobRunner({ connectionString: databaseUrl, database, logger, jobs: [] })
    const app = buildApp({ database, jobs, logger })
    try {
      const response = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'ok', service: 'heed', checks: { database: 'ok' } })
    } finally {
      await app.close()
    }
  })
})

it.each(
  Object.entries({
    item_kind: itemKinds,
    risk_level: riskLevels,
    claim_level: claimLevels,
    creation_channel: creationChannels,
    area_state: areaStates,
    source_flag: checkFlags,
  }),
)('keeps %s aligned with the existing domain model', async (name, values) => {
  const result = await client.query<{ enumlabel: string }>(
    'select enumlabel from pg_enum join pg_type on pg_type.oid=enumtypid where typname=$1 order by enumsortorder',
    [name],
  )
  expect(result.rows.map((row) => row.enumlabel)).toEqual(values)
})
