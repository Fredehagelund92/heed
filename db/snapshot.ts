import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { databaseFromPool } from '../src/server/db/database.ts'
import { pgTool } from '../src/server/db/restore-drill.ts'
import { applyGrants, identifier, localRoles } from '../src/server/db/roles.ts'
import { setSetting } from '../src/server/modules/admin/index.ts'
import {
  checkModelSetting,
  createModelPort,
  modelRoles,
} from '../src/server/modules/models/index.ts'
import { relayOutbox } from '../src/server/modules/notifications/index.ts'
import {
  databaseName,
  demoModelDir,
  migrateDatabase,
  onDatabase,
  seedDemoIfEmpty,
} from './prepare.ts'

/*
  The demo as a file, for a database without a superuser, such as Neon (docs/vercel.md). The demo
  seed needs a superuser, so it runs on one you have, such as a local PostgreSQL 18; the file then
  restores as the database's owner alone.

    npm run db:snapshot -- take --file heed-demo.dump [--model <provider>:<model>]
      With a superuser in DATABASE_URL_BOOTSTRAP: a new scratch database on that server with
      Heed's roles, the migrations and the demo (db/prepare.ts), the outbox relayed so the demo's
      inbox items are in it, and with --model every model role set to that provider and model.
      Then pg_dump writes the file and the scratch database is dropped.

    npm run db:snapshot -- restore --file heed-demo.dump
      As the owner in DATABASE_URL_MIGRATE (on Neon, the direct address, not the pooled one):
      the file into that database, which must hold nothing yet, then the grants. Refuses when
      Heed's runtime roles are missing, or when one is a superuser or bypasses row security.

    npm run db:snapshot -- reset --file heed-demo.dump
      The same, into a database that holds the demo already: everything the owner owns there is
      dropped first. Refused for a database that holds anything but the demo.
*/

export class SnapshotError extends Error {
  override name = 'SnapshotError'
}

async function withClient<T>(url: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await use(client)
  } finally {
    await client.end()
  }
}

/** The same server and database as another role, which a superuser may become. */
function asRole(url: string, role: string): string {
  const next = new URL(url)
  next.searchParams.set('options', `-c role=${role}`)
  return next.href
}

/** `vercel-gateway:anthropic/claude-haiku-5.5` as a model setting, checked against the providers. */
export function modelSetting(value: string): { provider: string; model: string } {
  const at = value.indexOf(':')
  const setting = { provider: value.slice(0, at), model: value.slice(at + 1) }
  if (at < 1 || !setting.model)
    throw new SnapshotError(
      `--model: expected <provider>:<model>, such as vercel-gateway:anthropic/claude-haiku-5.5`,
    )
  const port = createModelPort({ mode: 'mock' })
  for (const role of modelRoles.filter((role) => role !== 'judge'))
    try {
      checkModelSetting(port, `models.${role}`, setting)
    } catch (error) {
      throw new SnapshotError(`--model: ${error instanceof Error ? error.message : String(error)}`)
    }
  return setting
}

/** Every model role but the judge (a model of another family) set to one provider and model. */
async function setModels(url: string, setting: { provider: string; model: string }) {
  const pool = new pg.Pool({ connectionString: asRole(url, localRoles.api), max: 1 })
  try {
    const [admin] = (
      await pool.query<{ id: string }>(
        `select person_id::text as id from global_role_grants
          where role = 'administrator' and upper_inf(valid_at) order by person_id limit 1`,
      )
    ).rows
    if (!admin) throw new SnapshotError('The demo has no administrator to change the models as')
    const port = createModelPort({ mode: 'mock' })
    await databaseFromPool(pool).transaction(admin.id, async (tx) => {
      for (const role of modelRoles.filter((role) => role !== 'judge')) {
        const key = `models.${role}`
        const [current] = await tx.query<{ version: number }>(
          'select version from settings_current where key = $1',
          [key],
        )
        await setSetting(
          tx,
          {
            key,
            version: current?.version ?? 1,
            value: setting,
            reason: `The demo snapshot answers with ${setting.provider} ${setting.model}`,
          },
          () => Promise.resolve([]),
          (changed, value) => checkModelSetting(port, changed, value),
        )
      }
    })
  } finally {
    await pool.end()
  }
}

/** `take`: the demo seeded on a superuser's server, written to a file. */
export async function takeSnapshot(options: {
  bootstrapUrl: string
  file: string
  model?: { provider: string; model: string }
}): Promise<{ bytes: number }> {
  const scratch = `heed_snapshot_${randomBytes(4).toString('hex')}`
  const scratchUrl = onDatabase(options.bootstrapUrl, scratch)
  const admin = new pg.Client({ connectionString: options.bootstrapUrl })
  await admin.connect()
  try {
    await migrateDatabase({
      bootstrapUrl: options.bootstrapUrl,
      migrateUrl: asRole(scratchUrl, localRoles.owner),
    })
    const seeded = await seedDemoIfEmpty({ seedUrl: scratchUrl, cubeModelDir: demoModelDir })
    if (typeof seeded === 'string') throw new SnapshotError(`The demo did not load (${seeded})`)
    // The service relays as it starts; a function relays only after a change. The file carries the
    // inbox items the demo's events make, so they are there before anyone changes anything.
    const pool = new pg.Pool({ connectionString: asRole(scratchUrl, localRoles.api), max: 1 })
    try {
      await relayOutbox(databaseFromPool(pool))
    } finally {
      await pool.end()
    }
    if (options.model) await setModels(scratchUrl, options.model)
    await pgTool('pg_dump', undefined, [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      `--file=${options.file}`,
      `--dbname=${scratchUrl}`,
    ])
    return { bytes: (await stat(options.file)).size }
  } finally {
    await admin.query(`drop database if exists ${identifier(scratch)} with (force)`)
    await admin.end()
  }
}

/** Why the runtime roles cannot serve from this database, if they cannot. */
async function rolesProblem(client: pg.Client): Promise<string | undefined> {
  const runtime = [localRoles.api, localRoles.serve, localRoles.readonly]
  const rows = (
    await client.query<{ name: string; privileged: boolean }>(
      // A member of another role may hold its privileges: on Neon, a role made in the console is
      // a member of neon_superuser.
      `select rolname as name, rolsuper or rolbypassrls or rolcreaterole or rolcreatedb
           or exists (select 1 from pg_auth_members where member = r.oid) as privileged
         from pg_roles r where rolname = any($1)`,
      [runtime],
    )
  ).rows
  const missing = runtime.filter((role) => !rows.some((row) => row.name === role))
  if (missing.length)
    return `Create the roles ${missing.join(', ')} first, each with its own password and no other privilege (docs/vercel.md)`
  const privileged = rows.filter((row) => row.privileged).map((row) => row.name)
  if (privileged.length)
    return `The roles ${privileged.join(', ')} may bypass row security, create roles or databases, or belong to another role; Heed's runtime roles must not (db/README.md, docs/vercel.md)`
  return undefined
}

/** What the database holds: nothing of Heed's, the demo, or something else. */
async function contents(client: pg.Client): Promise<'empty' | 'demo' | 'other'> {
  const [row] = (
    await client.query<{ tables: number; demo: boolean }>(
      `select (select count(*)::int from pg_tables where schemaname not in ('pg_catalog', 'information_schema')) as tables,
         to_regclass('public.areas') is not null as demo`,
    )
  ).rows
  if (!row!.tables) return 'empty'
  if (!row!.demo) return 'other'
  const demo = await client.query<{ demo: boolean }>(
    "select exists (select 1 from areas where id = 'area_sandbox' and is_demo) as demo",
  )
  return demo.rows[0]!.demo ? 'demo' : 'other'
}

/** `restore` and `reset`: the file into the owner's database, then the grants. */
export async function restoreSnapshot(options: {
  migrateUrl: string
  file: string
  reset: boolean
}): Promise<void> {
  const database = databaseName(options.migrateUrl)
  await withClient(options.migrateUrl, async (client) => {
    const [{ owner }] = (
      await client.query<{ owner: boolean }>(
        'select pg_get_userbyid(datdba) = current_user as owner from pg_database where datname = current_database()',
      )
    ).rows as [{ owner: boolean }]
    if (!owner)
      throw new SnapshotError(
        `DATABASE_URL_MIGRATE: expected the owner of the database ${database}, which owns everything the snapshot makes`,
      )
    const problem = await rolesProblem(client)
    if (problem) throw new SnapshotError(problem)
    const found = await contents(client)
    if (found === 'other')
      throw new SnapshotError(
        `The database ${database} holds something other than the demo, so the snapshot is not restored into it`,
      )
    if (found === 'demo' && !options.reset)
      throw new SnapshotError(
        `The database ${database} holds the demo already. To replace it with the snapshot, run reset`,
      )
    // Every object of the demo is the owner's, as the last restore made it.
    if (found === 'demo') await client.query('drop owned by current_user cascade')
  })
  await pgTool('pg_restore', undefined, [
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--no-acl',
    `--dbname=${options.migrateUrl}`,
    options.file,
  ])
  await withClient(options.migrateUrl, (client) => applyGrants(client))
}

async function main(argv: string[], env: Record<string, string | undefined>) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { file: { type: 'string' }, model: { type: 'string' } },
  })
  const [command] = positionals
  if (!values.file || !['take', 'restore', 'reset'].includes(command ?? ''))
    throw new SnapshotError(
      'Usage: npm run db:snapshot -- take|restore|reset --file <file> [--model <provider>:<model>]',
    )
  if (command === 'take') {
    const bootstrapUrl = env.DATABASE_URL_BOOTSTRAP?.trim()
    if (!bootstrapUrl)
      throw new SnapshotError('take: name a superuser in DATABASE_URL_BOOTSTRAP to seed the demo')
    const model = values.model === undefined ? undefined : modelSetting(values.model)
    const { bytes } = await takeSnapshot({
      bootstrapUrl,
      file: values.file,
      ...(model ? { model } : {}),
    })
    console.log(`Wrote the demo to ${values.file} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
    return
  }
  if (values.model !== undefined)
    throw new SnapshotError('--model: only take sets the models; they are in the file')
  const migrateUrl = env.DATABASE_URL_MIGRATE?.trim()
  if (!migrateUrl)
    throw new SnapshotError(`${command}: name the database's owner in DATABASE_URL_MIGRATE`)
  await restoreSnapshot({ migrateUrl, file: values.file, reset: command === 'reset' })
  console.log(`Restored ${values.file} into ${databaseName(migrateUrl)}`)
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2), process.env)
  } catch (error) {
    if (!(error instanceof SnapshotError)) throw error
    console.error(error.message)
    process.exitCode = 1
  }
}
