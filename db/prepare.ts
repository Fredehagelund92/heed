import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { migrate } from '../src/server/db/migrate.ts'
import { applyGrants, createLocalDatabase, createLocalRoles } from '../src/server/db/roles.ts'
import { loadDemo, type DemoCounts } from './seed/demo.ts'

/*
  Gets Heed's database ready for the service: `npm run db:migrate`, and the container's start
  before the service (compose.yaml).

  1. With DATABASE_URL_BOOTSTRAP, a superuser, it creates Heed's roles and the database
     DATABASE_URL_MIGRATE names when they are missing. Without it, both must exist (db/README.md).
  2. As the owner, DATABASE_URL_MIGRATE, it applies the migrations not applied yet, then the grants.
  3. With SEED_DEMO=on it loads the demo into a database that holds nothing yet: the demo library
     with its quality history and gaps (db/seed/demo.ts), as the superuser. The demo is about the
     demo Cube model, so it loads only while CUBE_MODEL_DIR holds that model (db/seed/cube); beside
     your own model it loads nothing and says so. SEED_DEMO is off unless set, and refused when
     NODE_ENV=production, so a real install never gets demo data by accident.
*/

export const demoModelDir = fileURLToPath(new URL('./seed/cube/', import.meta.url))

export class PrepareError extends Error {
  override name = 'PrepareError'
}

/** The database a connection string names. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1))
}

/** A connection string for another database on the same server, as the same user. */
export function onDatabase(url: string, database: string): string {
  const next = new URL(url)
  next.pathname = `/${encodeURIComponent(database)}`
  return next.href
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

/**
 * Steps 1 and 2: the roles and the database when a superuser's address is given, then the
 * migrations and the grants as the owner. Returns whether it created the database and how many
 * migrations it applied.
 */
export async function migrateDatabase(options: {
  bootstrapUrl?: string | undefined
  migrateUrl: string
}): Promise<{ created: boolean; applied: number }> {
  const created = options.bootstrapUrl
    ? await withClient(options.bootstrapUrl, async (client) => {
        await createLocalRoles(client)
        return createLocalDatabase(client, databaseName(options.migrateUrl))
      })
    : false
  const applied = await withClient(options.migrateUrl, async (client) => {
    const count = await migrate(client)
    await applyGrants(client)
    return count
  })
  return { created, applied }
}

/** Every file under a folder, by its path inside it, with its contents. */
async function folderFiles(folder: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    files.set(path.slice(folder.length), await readFile(path))
  }
  return files
}

/** Whether a folder holds exactly the demo Cube model: the same files with the same contents. */
export async function isDemoModel(folder: string | undefined): Promise<boolean> {
  if (!folder) return false
  const [demo, given] = await Promise.all([
    folderFiles(demoModelDir),
    folderFiles(resolve(folder) + '/').catch(() => new Map<string, Buffer>()),
  ])
  return (
    demo.size === given.size &&
    [...demo].every(([path, content]) => given.get(path)?.equals(content) === true)
  )
}

/** Whether a database holds nothing yet: no item, person or edition (what the bulk seed asks). */
export async function isEmpty(client: pg.Client): Promise<boolean> {
  const result = await client.query<{ empty: boolean }>(
    `select not (exists (select 1 from items) or exists (select 1 from people)
      or exists (select 1 from editions)) as empty`,
  )
  return result.rows[0]!.empty
}

/**
 * Step 3: the demo into an empty database, as the superuser. Returns what it added, or why it
 * added nothing.
 */
export async function seedDemoIfEmpty(options: {
  seedUrl: string
  cubeModelDir: string | undefined
}): Promise<DemoCounts | 'not-empty' | 'not-demo-model'> {
  if (!(await isDemoModel(options.cubeModelDir))) return 'not-demo-model'
  return withClient(options.seedUrl, async (client) =>
    (await isEmpty(client)) ? loadDemo(client) : 'not-empty',
  )
}

/** The settings, checked; every problem is named by its variable. */
export function prepareSettings(env: Record<string, string | undefined>) {
  const value = (name: string) => env[name]?.trim() || undefined
  const problems: string[] = []
  const url = (name: string) => {
    const given = value(name)
    if (given && !/^postgres(ql)?:$/.test(URL.parse(given)?.protocol ?? ''))
      problems.push(`${name}: expected a PostgreSQL URL`)
    return given
  }
  const bootstrapUrl = url('DATABASE_URL_BOOTSTRAP')
  const migrateUrl =
    url('DATABASE_URL_MIGRATE') ?? 'postgres://context_layer_owner@localhost:5432/context_layer_dev'
  const seedDemo = value('SEED_DEMO') ?? 'off'
  if (seedDemo !== 'on' && seedDemo !== 'off') problems.push('SEED_DEMO: expected on or off')
  if (seedDemo === 'on' && env.NODE_ENV === 'production')
    problems.push('SEED_DEMO: the demo data is refused when NODE_ENV=production')
  if (seedDemo === 'on' && !bootstrapUrl)
    problems.push('SEED_DEMO: loading the demo needs a superuser in DATABASE_URL_BOOTSTRAP')
  if (problems.length) throw new PrepareError(`Invalid configuration:\n  ${problems.join('\n  ')}`)
  return {
    bootstrapUrl,
    migrateUrl,
    seedDemo: seedDemo === 'on',
    cubeModelDir: value('CUBE_MODEL_DIR'),
  }
}

/** Steps 1 to 3 with the settings from the environment, saying what each did. */
export async function prepare(env: Record<string, string | undefined>): Promise<void> {
  const settings = prepareSettings(env)
  const database = databaseName(settings.migrateUrl)
  const { created, applied } = await migrateDatabase(settings)
  console.log(
    `${created ? `Created the database ${database}` : `Database ${database}`}: applied ${applied} ${applied === 1 ? 'migration' : 'migrations'}`,
  )
  if (!settings.seedDemo) return
  const seeded = await seedDemoIfEmpty({
    seedUrl: onDatabase(settings.bootstrapUrl!, database),
    cubeModelDir: settings.cubeModelDir,
  })
  if (seeded === 'not-empty')
    console.log('SEED_DEMO=on: the database holds data already, so the demo was not loaded')
  else if (seeded === 'not-demo-model')
    console.log(
      'SEED_DEMO=on: CUBE_MODEL_DIR is not the demo Cube model (db/seed/cube), so the demo, which is about that model, was not loaded',
    )
  else
    console.log(
      `Loaded the demo: ${seeded.items.toLocaleString('en')} items, ${seeded.questions} test questions, ${seeded.runs} weekly runs, ${seeded.passes} retrieval passes and ${seeded.gaps} gaps`,
    )
}

if (import.meta.main) {
  try {
    await prepare(process.env)
  } catch (error) {
    if (!(error instanceof PrepareError)) throw error
    console.error(error.message)
    process.exitCode = 1
  }
}
