import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { demoModelDir, isEmpty, migrateDatabase, seedDemoIfEmpty } from '../../db/prepare.ts'
import { migrationDirectory } from '../../src/server/db/migrate.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import { testDatabase } from './support.ts'

const { client, url } = testDatabase({ unmigrated: true })

/*
  Getting a new database ready (db/prepare.ts, `npm run db:migrate` and the container's start):
  every migration once, and the demo only into an empty database beside the demo model. The demo
  itself is seed-demo.test.ts's.
*/
it('migrates a new database once, and leaves the demo out beside another model or other data', async () => {
  const owner = new URL(url)
  owner.searchParams.set('options', `-c role=${localRoles.owner}`)
  const admin = new URL(url)
  admin.pathname = '/postgres'
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql'))

  expect(await migrateDatabase({ bootstrapUrl: admin.href, migrateUrl: owner.href })).toEqual({
    created: false,
    applied: files.length,
  })
  expect(await migrateDatabase({ migrateUrl: owner.href })).toEqual({ created: false, applied: 0 })
  await client.query('reset role')
  expect(await isEmpty(client)).toBe(true)

  const model = await mkdtemp(join(tmpdir(), 'heed-model-'))
  try {
    await cp(demoModelDir, model, { recursive: true })
    await writeFile(join(model, 'orders.yml'), '# my own model\n', { flag: 'a' })
    expect(await seedDemoIfEmpty({ seedUrl: url, cubeModelDir: model })).toBe('not-demo-model')
  } finally {
    await rm(model, { recursive: true })
  }
  await client.query(
    "insert into people (id, email, display_name) values (gen_random_uuid(), 'first@example.test', 'First')",
  )
  expect(await isEmpty(client)).toBe(false)
  expect(await seedDemoIfEmpty({ seedUrl: url, cubeModelDir: demoModelDir })).toBe('not-empty')
  const [items] = (await client.query<{ n: number }>('select count(*)::int as n from items')).rows
  expect(items!.n).toBe(0)
})
