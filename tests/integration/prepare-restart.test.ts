import { expect, it } from 'vitest'
import { demoModelDir, migrateDatabase, seedDemoIfEmpty } from '../../db/prepare.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import { testDatabase } from './support.ts'

const { client, url } = testDatabase({ unmigrated: true })

/* The second start of `docker compose up`: it prepares the database again as the owner role. */
it('prepares a database again, as the owner, after the demo and its story were loaded', async () => {
  const owner = new URL(url)
  owner.searchParams.set('options', `-c role=${localRoles.owner}`)
  await migrateDatabase({ migrateUrl: owner.href })
  await client.query('reset role')

  const loaded = await seedDemoIfEmpty({ seedUrl: url, cubeModelDir: demoModelDir })
  expect(loaded).toMatchObject({ story: { calls: expect.any(Number) } })

  await expect(migrateDatabase({ migrateUrl: owner.href })).resolves.toMatchObject({ applied: 0 })
  expect(await seedDemoIfEmpty({ seedUrl: url, cubeModelDir: demoModelDir })).toBe('not-empty')
}, 180_000)
