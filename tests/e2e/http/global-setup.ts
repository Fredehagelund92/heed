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
import { spainDraft } from '@/api/mock/data/drafts'
import { facts } from '@/api/mock/data/world'
import { driveCards } from '../../web/http/demo-drive.ts'
import { checkCards, queue, seedDemoWeek, serverItemId } from '../../web/http/demo-week.ts'
import { demoCube, inventedToken, seedDemoFigures } from '../../web/http/demo-figures.ts'
import { emptyName, workName } from './harness.ts'

/*
  Once per run of the http journeys: a migrated database with the mockup's demo week, as the
  template each journey copies (harness.ts), a migrated empty one for a new install, and the world file the journeys read to find the
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
  const cubeToken = inventedToken()
  let cube: Awaited<ReturnType<typeof demoCube>> | undefined
  const drop = async () => {
    await cube?.drop()
    for (const name of [workName(template), emptyName(template), template])
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
    // A new install: the migrated database alone, before anything is seeded into it.
    await admin.query(
      `create database ${identifier(emptyName(template))} template ${identifier(template)} owner ${identifier(localRoles.owner)}`,
    )
    const ids = await seedDemoWeek(url.href)
    // Cube's figures read from a stand-in Cube over the demo warehouse, for the whole run: every
    // journey's copy of the demo week names its endpoint, and its service holds its token.
    cube = await demoCube(adminUrl, cubeToken)
    await seedDemoFigures(url.href, cube.endpoint)
    // The mock's cards by the service's ids: a suggestion by its proposal, a check by its item,
    // the saved questions that need a look by their domain; and its context items, a draft by its
    // proposal.
    const world: Record<string, string> = {
      ...Object.fromEntries(facts.map((f) => [f.id, ids.drafts[f.id] ?? serverItemId(f.id)])),
      ...Object.fromEntries([...queue, ...driveCards].map((card) => [card, ids[card]])),
      'flag-germany': ids['flag-germany'],
      ...Object.fromEntries(Object.entries(ids).filter(([k]) => k.startsWith('topic.'))),
      ...checkCards(),
      // The saved-question alert's card: the domain's saved questions that need a look.
      'look-sales': 'look:area_sales',
    }
    // What the answer panel compares with: before the last publish, by the live edition's day.
    const seeded = new pg.Client({ connectionString: url.href })
    await seeded.connect()
    const [live] = (
      await seeded.query<{ label: string }>(
        'select e.label from editions e join live_edition l on l.seq = e.seq',
      )
    ).rows
    await seeded.end()
    const day = new Date(`${live!.label.slice(0, 10)}T00:00:00Z`)
    const before = `Before ${day.getUTCDate()} ${day.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`
    await mkdir(dirname(worldFile), { recursive: true })
    // The items a journey publishes on the way, by their mock id: found by their title once made.
    const published = { [spainDraft.id]: spainDraft.title }
    // The review's queue, newest first: the suggestions sent today, then this morning's read.
    await writeFile(
      worldFile,
      JSON.stringify({ ids: world, queue: [...queue, ...driveCards], published, before }, null, 2),
    )
  } catch (error) {
    await drop()
    await admin.end()
    throw error
  }
  process.env.GOLDEN_ADMIN_URL = adminUrl
  process.env.GOLDEN_TEMPLATE = template
  // The stand-in Cube's token, invented for this run, for each journey's service to hold.
  process.env.GOLDEN_CUBE_TOKEN = cubeToken
  return async () => {
    await drop()
    await admin.end()
  }
}
