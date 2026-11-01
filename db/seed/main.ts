import { parseArgs } from 'node:util'
import pg from 'pg'
import type { ContextItem } from '../../src/domain/item.ts'
import { generateItems } from './fixtures/items.ts'
import { isEmpty } from '../prepare.ts'
import { bulkSeed, type LibraryExtras } from './bulk.ts'
import { loadDemo } from './demo.ts'
import { loadStory } from './story.ts'
import { goldenExtras, goldenLibrary } from './golden-fixtures.ts'

/*
  `npm run seed`: data to develop, test and show Heed on, in a local database (db/README.md).
  A new database gets the demo on its own when SEED_DEMO=on (db/prepare.ts); this is the same
  data, and the variants the tests need.

    npm run seed                          the demo: 1,500 items with their quality history and gaps,
                                          then its present (story.ts)
    npm run seed -- --library golden      the golden set's library (golden-fixtures.ts), same history
    npm run seed -- --items-only          the library alone, with no quality history or gaps,
                                          as tests on the service may want
    npm run seed -- --items-only --count 50000   a larger generated library, for performance

  A library goes into an empty database, as a superuser: DATABASE_URL_SEED, a local
  context_layer_dev or context_layer_test database.
*/

const usage = `Usage: npm run seed [-- --library demo|golden] [--items-only [--count <n>]]
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

function library(
  name: string,
  count: number | undefined,
): { items: ContextItem[]; extras?: LibraryExtras } {
  if (count !== undefined && name !== 'demo')
    throw new UsageError('--count makes a generated library; it goes with the demo library only')
  if (name === 'demo') return { items: generateItems(count) }
  if (name === 'golden') return { items: goldenLibrary(), extras: goldenExtras }
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
      // The demo's present is about the demo library; the golden set's library has none.
      if (name === 'demo') {
        const story = await loadStory(librarySeedUrl(env)).catch((error: unknown) => {
          throw new UsageError(
            `The demo is half loaded: its library is in the database but its present is not, because ${error instanceof Error ? error.message : String(error)}. ` +
              'Drop and create the database, run npm run db:migrate, then npm run seed again.',
          )
        })
        console.log(
          `Then ${story.items} items published today, ${story.suggestions} suggestions waiting and ${story.calls} calls from agents`,
        )
      }
    }
  } finally {
    await client.end()
  }
}

try {
  await main(process.argv.slice(2), process.env)
} catch (error) {
  if (!(error instanceof UsageError)) throw error
  console.error(error.message)
  process.exitCode = 1
}
