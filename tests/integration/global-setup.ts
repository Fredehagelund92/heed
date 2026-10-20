import { randomBytes } from 'node:crypto'
import pg from 'pg'
import type { TestProject } from 'vitest/node'
import { migrate } from '../../src/server/db/migrate.ts'
import { applyGrants, createLocalRoles, identifier, localRoles } from '../../src/server/db/roles.ts'

/**
 * The bulk seeded copy of the run's template (tests/integration/support.ts), and the name it has
 * while it is seeded.
 */
export const seededName = (template: string) => `${template}_seeded`
export const seedingName = (template: string) => `${template}_seeding`

export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/postgres'
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  const template = `context_layer_test_${process.pid}_${randomBytes(6).toString('hex')}`
  try {
    await createLocalRoles(admin)
    await admin.query(
      `create database ${identifier(template)} owner ${identifier(localRoles.owner)}`,
    )
    const templateUrl = new URL(url)
    templateUrl.pathname = '/' + template
    const client = new pg.Client({ connectionString: templateUrl.href })
    await client.connect()
    try {
      await client.query(`set role ${identifier(localRoles.owner)}`)
      await migrate(client)
      await applyGrants(client)
    } finally {
      await client.end()
    }
    project.provide('databaseTemplate', templateUrl.href)
  } catch (error) {
    await admin.query(`drop database if exists ${identifier(template)} with (force)`)
    await admin.end()
    throw error
  }
  return async () => {
    for (const name of [seededName(template), seedingName(template)])
      await admin.query(`drop database if exists ${identifier(name)} with (force)`)
    await admin.query(`drop database ${identifier(template)} with (force)`)
    await admin.end()
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseTemplate: string
  }
}
