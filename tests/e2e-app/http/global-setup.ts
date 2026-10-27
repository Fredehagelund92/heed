import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import pg from 'pg'
import { migrate } from '../../../src/server/db/migrate.ts'
import {
  applyGrants,
  createLocalRoles,
  identifier,
  localRoles,
} from '../../../src/server/db/roles.ts'
import { checkCards, queue, seedDemoWeek } from '../../app/http/demo-week.ts'
import { workName } from './harness.ts'

/*
  Once per run of the http journeys: a migrated database with the mockup's demo week, as the
  template each journey copies (harness.ts), and the world file the journeys read to find the
  service's ids for the mock's cards (go.ts).
*/

export const worldFile = 'test-results/golden-http/world.json'

export default async function setup() {
  const adminUrl =
    process.env.GOLDEN_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    'postgres://localhost:5432/postgres'
  const template = `context_layer_test_golden_${process.pid}`
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  const drop = async () => {
    for (const name of [workName(template), template])
      await admin.query(`drop database if exists ${identifier(name)} with (force)`)
  }
  try {
    await createLocalRoles(admin)
    await drop()
    await admin.query(
      `create database ${identifier(template)} owner ${identifier(localRoles.owner)}`,
    )
    const url = new URL(adminUrl)
    url.pathname = `/${template}`
    const client = new pg.Client({ connectionString: url.href })
    await client.connect()
    try {
      await client.query(`set role ${identifier(localRoles.owner)}`)
      await migrate(client)
      await applyGrants(client)
    } finally {
      await client.end()
    }
    const ids = await seedDemoWeek(url.href)
    // The mock's cards by the service's ids: a suggestion by its proposal, a check by its item.
    const world: Record<string, string> = {
      ...Object.fromEntries(queue.map((card) => [card, ids[card]])),
      ...checkCards(),
    }
    await mkdir(dirname(worldFile), { recursive: true })
    await writeFile(worldFile, JSON.stringify({ ids: world, queue }, null, 2))
  } catch (error) {
    await drop()
    await admin.end()
    throw error
  }
  process.env.GOLDEN_ADMIN_URL = adminUrl
  process.env.GOLDEN_TEMPLATE = template
  return async () => {
    await drop()
    await admin.end()
  }
}
