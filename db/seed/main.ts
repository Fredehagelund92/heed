import { parseArgs } from 'node:util'
import pg from 'pg'
import type { ContextItem } from '../../src/domain/item.ts'
import { readDevPeople } from '../../src/server/modules/auth/dev-sign-in.ts'
import { generateItems } from '../../src/web/mocks/items.ts'
import { isEmpty } from '../prepare.ts'
import { bulkSeed, type LibraryExtras } from './bulk.ts'
import { loadDemo } from './demo.ts'
import { goldenExtras, goldenLibrary } from './golden-fixtures.ts'
import { norwayLibrary } from './norway.ts'
import { PracticeHalfSeededError, seedPractice } from './practice.ts'

/*
  `npm run seed`: data to develop, test and show Heed on, in a local database (db/README.md).
  A new database gets the demo on its own when SEED_DEMO=on (db/prepare.ts); this is the same
  data, and the variants the tests and the show need.

    npm run seed                          the demo: 1,500 items with their quality history and gaps
    npm run seed -- --library golden      the golden set's library (golden-fixtures.ts), same history
    npm run seed -- --library norway   the show's library (norway.ts, docs/demo.md), same history
    npm run seed -- --items-only          the library alone: Quality, Gaps and Health stay empty,
                                          as CI's end-to-end tests on the service expect
    npm run seed -- --items-only --count 50000   a larger generated library, for performance
    npm run seed -- --practice            the practice domain, through the service's API

  A library goes into an empty database, as a superuser: DATABASE_URL_SEED, a local
  context_layer_dev or context_layer_test database. The practice domain goes into any migrated
  local database, as the service's role (DATABASE_URL, people from CL_DEV_PEOPLE_FILE).
*/

const usage = `Usage: npm run seed [-- --library demo|golden|norway] [--items-only [--count <n>]]
       npm run seed -- --practice
See db/README.md.`

class UsageError extends Error {}

const loopback = ['localhost', '127.0.0.1', '[::1]']

/** The database a library goes into: DATABASE_URL_SEED, a local development or test database. */
function librarySeedUrl(env: NodeJS.ProcessEnv): string {
  const url = env.DATABASE_URL_SEED
  if (!url)
    throw new UsageError(
      'Set DATABASE_URL_SEED to an empty local Heed database as a superuser, such as postgres://localhost:5432/context_layer_dev',
    )
  const parsed = new URL(url)
  if (
    !loopback.includes(parsed.hostname) ||
    !/^\/context_layer_(dev|test(?:_[a-z0-9_]+)?)$/.test(parsed.pathname)
  )
    throw new UsageError(
      'DATABASE_URL_SEED must name a local context_layer_dev or context_layer_test database',
    )
  return url
}

/** The database the practice domain goes into: the service's, on this computer. */
function practiceUrl(env: NodeJS.ProcessEnv): string {
  const url = env.DATABASE_URL ?? 'postgres://context_layer_api@localhost:5432/context_layer_dev'
  if (!loopback.includes(new URL(url).hostname))
    throw new UsageError('The practice domain goes into a local database only (DATABASE_URL)')
  return url
}

function library(
  name: string,
  count: number | undefined,
): { items: ContextItem[]; extras?: LibraryExtras } {
  if (count !== undefined && name !== 'demo')
    throw new UsageError('--count makes a generated library; it goes with the demo library only')
  if (name === 'demo') return { items: generateItems(count) }
  if (name === 'golden') return { items: goldenLibrary(), extras: goldenExtras }
  if (name === 'norway') return { items: norwayLibrary() }
  throw new UsageError(usage)
}

async function main(args: string[], env: NodeJS.ProcessEnv) {
  let values
  try {
    values = parseArgs({
      args,
      options: {
        library: { type: 'string' },
        'items-only': { type: 'boolean', default: false },
        count: { type: 'string' },
        practice: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    }).values
  } catch {
    throw new UsageError(usage)
  }
  if (values.help) {
    console.log(usage)
    return
  }
  if (env.NODE_ENV === 'production') throw new UsageError('Seed data is never for production')

  if (values.practice) {
    if (values['items-only'] || values.count !== undefined || values.library !== undefined)
      throw new UsageError(usage)
    const result = await seedPractice({
      databaseUrl: practiceUrl(env),
      people: await readDevPeople(env.CL_DEV_PEOPLE_FILE ?? 'db/seed/people.local.yml'),
      ...(env.CL_FIXED_TODAY ? { today: env.CL_FIXED_TODAY } : {}),
    })
    console.log(
      result.seeded
        ? `Seeded the practice domain: proposals ${JSON.stringify(result.proposals)}, gaps ${JSON.stringify(result.gaps)}, ${result.editions} editions`
        : 'The practice domain is already there; nothing changed',
    )
    return
  }

  const count = values.count === undefined ? undefined : Number(values.count)
  if (
    count !== undefined &&
    (!values['items-only'] || !Number.isSafeInteger(count) || count < 1 || count > 50_000)
  )
    throw new UsageError('--count goes with --items-only and is a number from 1 to 50000')
  const name = values.library ?? 'demo'
  const chosen = library(name, count)
  const client = new pg.Client({ connectionString: librarySeedUrl(env) })
  await client.connect()
  try {
    if (!(await isEmpty(client)))
      throw new UsageError(
        'The database holds data already; a library goes into an empty one. Drop and create it again, then run npm run db:migrate and this.',
      )
    if (values['items-only']) {
      const items = await bulkSeed(client, chosen.items, chosen.extras)
      console.log(`Loaded ${items.toLocaleString('en')} items (${name} library)`)
    } else {
      const added = await loadDemo(client, chosen)
      console.log(
        `Loaded ${added.items.toLocaleString('en')} items (${name} library), ${added.questions} test questions, ${added.runs} weekly runs, ${added.passes} retrieval passes and ${added.gaps} gaps`,
      )
    }
  } finally {
    await client.end()
  }
}

try {
  await main(process.argv.slice(2), process.env)
} catch (error) {
  if (!(error instanceof UsageError) && !(error instanceof PracticeHalfSeededError)) throw error
  console.error(error.message)
  process.exitCode = 1
}
