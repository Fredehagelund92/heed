import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, inject } from 'vitest'
import { bulkSeed } from '../../db/seed/bulk.ts'
import { contract } from '../../src/contract/index.ts'
import { calendarDateTypes, databaseFromPool, type Database } from '../../src/server/db/database.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { generateItems } from '../../src/web/mocks/items.ts'
import { seededName, seedingName } from './global-setup.ts'

/**
 * The bulk seed of the demo library (`generateItems()`) in a database of its own, which a seeded
 * test database copies. Seeding takes one to six minutes on a busy machine, copying seconds, so a
 * run seeds once: the first file to ask seeds it under a lock while the others wait for it.
 * The database gets its name only once seeded, so one that exists is whole.
 */
/** Six minutes for one seed, measured at a one-minute load near 75 (October 2026), and room. */
const seedBudget = 600_000

async function seededTemplate(admin: pg.Client, templateUrl: URL) {
  const template = templateUrl.pathname.slice(1)
  const seeded = seededName(template)
  await admin.query('select pg_advisory_lock(hashtextextended($1, 0))', [seeded])
  try {
    const found = await admin.query('select 1 from pg_database where datname = $1', [seeded])
    if (found.rowCount) return seeded
    const seeding = seedingName(template)
    await admin.query(`drop database if exists ${identifier(seeding)} with (force)`)
    await admin.query(
      `create database ${identifier(seeding)} template ${identifier(template)} owner ${identifier(localRoles.owner)}`,
    )
    const url = new URL(templateUrl)
    url.pathname = '/' + seeding
    const client = connect(url)
    await client.connect()
    try {
      await bulkSeed(client, generateItems())
    } finally {
      await client.end()
    }
    await admin.query(`alter database ${identifier(seeding)} rename to ${identifier(seeded)}`)
    return seeded
  } finally {
    await admin.query('select pg_advisory_unlock(hashtextextended($1, 0))', [seeded])
  }
}

/** A client that keeps calendar days as strings, as the service's pool does. */
function connect(url: URL) {
  return new pg.Client({
    connectionString: url.href,
    types: {
      getTypeParser(oid, format): (value: string) => unknown {
        if (oid === pg.types.builtins.DATE) return (value: string) => value
        const parse = pg.types.getTypeParser(oid, format) as (value: string) => unknown
        return parse
      },
    },
  })
}

/**
 * A database of the test file's own, migrated and empty, or with `seeded` a copy of the bulk
 * seed of the demo library. With `unmigrated` it has no migration yet, as a new database has.
 */
export function testDatabase({
  seeded = false,
  unmigrated = false,
}: { seeded?: boolean; unmigrated?: boolean } = {}) {
  const templateUrl = new URL(inject('databaseTemplate'))
  const template = templateUrl.pathname.slice(1)
  const name = `${template}_${randomBytes(4).toString('hex')}`
  const url = new URL(templateUrl)
  url.pathname = '/' + name
  const adminUrl = new URL(templateUrl)
  adminUrl.pathname = '/postgres'
  const admin = new pg.Client({ connectionString: adminUrl.href })
  const client = connect(url)
  beforeAll(
    async () => {
      await admin.connect()
      const source = seeded ? await seededTemplate(admin, templateUrl) : template
      await admin.query(
        unmigrated
          ? `create database ${identifier(name)} owner ${identifier(localRoles.owner)}`
          : `create database ${identifier(name)} template ${identifier(source)} owner ${identifier(localRoles.owner)}`,
      )
      await client.connect()
      await client.query(`set role ${identifier(localRoles.owner)}`)
    },
    seeded ? seedBudget : undefined,
  )
  afterAll(async () => {
    await client.end()
    // Never drop a shared database or another run's copy.
    if (
      !name.startsWith(template + '_') ||
      !/^context_layer_test_\d+_[a-f0-9]+_[a-f0-9]+$/.test(name)
    )
      throw new Error('Unsafe test database name')
    await admin.query(`drop database if exists ${identifier(name)} with (force)`)
    await admin.end()
  })
  return { client, url: url.href }
}

export async function transaction<T>(client: pg.Client, work: () => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    const result = await work()
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

/**
 * The service's `Database` on a test database, as the application role: every pooled connection
 * switches to `context_layer_api` first, so grants and row security apply as they do in the service.
 */
export function apiDatabase(url: string): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: 4,
    options: `-c role=${localRoles.api}`,
    types: calendarDateTypes,
  })
  ignoreTeardownDisconnects(pool)
  return databaseFromPool(pool)
}

/** A pool as the serving role, with calendar days kept as strings like the service's own pool. */
export function servingPool(url: string, max = 4) {
  return ignoreTeardownDisconnects(
    new pg.Pool({
      connectionString: url,
      max,
      options: `-c role=${localRoles.serve}`,
      types: {
        getTypeParser(oid, format): (value: string) => unknown {
          return oid === pg.types.builtins.DATE
            ? (value) => value
            : (pg.types.getTypeParser(oid, format) as (value: string) => unknown)
        },
      },
    }),
  )
}

/**
 * `testDatabase` drops its database with force when the file ends, which ends any idle pooled
 * connection with 57P01. A pool without an error listener turns that into an uncaught exception.
 */
export function ignoreTeardownDisconnects(pool: pg.Pool): pg.Pool {
  pool.on('error', () => undefined)
  return pool
}

/**
 * Every row of every table outside the system schemas, one line per table, for comparing the
 * database before and after requests that must change nothing. `except` names tables to skip.
 */
export async function tableContents(client: pg.Client, except: readonly string[] = []) {
  const tables = await client.query<{ name: string }>(
    `select format('%I.%I', n.nspname, c.relname) as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and not c.relispartition
        and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
      order by 1`,
  )
  const lines: string[] = []
  for (const { name } of tables.rows) {
    if (except.includes(name)) continue
    const [row] = (
      await client.query<{ rows: string }>(
        `select coalesce(string_agg(t::text, E'\\n' order by t::text), '') as rows from ${name} t`,
      )
    ).rows
    lines.push(`${name} ${row!.rows}`)
  }
  return lines
}

export type Operation = { name: string; method: string; path: string }

/** Every API operation of the contract, with its method and its full path under /api/v1. */
export function contractOperations(router: object = contract, prefix = ''): Operation[] {
  return Object.entries(router).flatMap(([key, value]: [string, unknown]) => {
    const name = prefix ? `${prefix}.${key}` : key
    if (!value || typeof value !== 'object') return []
    if (!('~orpc' in value)) return contractOperations(value, name)
    const { route } = (value as { '~orpc': { route: { method: string; path: string } } })['~orpc']
    return [{ name, method: route.method, path: '/api/v1' + route.path }]
  })
}
