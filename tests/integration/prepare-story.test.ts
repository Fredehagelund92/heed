import { expect, it, vi } from 'vitest'
import type * as Story from '../../db/seed/story.ts'
import { demoModelDir, migrateDatabase, PrepareError, seedDemoIfEmpty } from '../../db/prepare.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import { testDatabase } from './support.ts'

vi.mock('../../db/seed/story.ts', async (original) => ({
  ...(await original<typeof Story>()),
  loadStory: () => Promise.reject(new Error('the MCP gateway refused the call')),
}))

const { client, url } = testDatabase({ unmigrated: true })

/* A demo whose story fails after the library committed: the start says so, and so does the next. */
it('names the half loaded demo, its cause and the recovery, then reports it on the next start', async () => {
  const owner = new URL(url)
  owner.searchParams.set('options', `-c role=${localRoles.owner}`)
  await migrateDatabase({ migrateUrl: owner.href })
  await client.query('reset role')

  const options = { seedUrl: url, cubeModelDir: demoModelDir }
  const failure = await seedDemoIfEmpty(options).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(PrepareError)
  expect((failure as Error).message).toContain('half loaded')
  expect((failure as Error).message).toContain('the MCP gateway refused the call')
  expect((failure as Error).message).toContain('docker compose down --volumes')

  expect(await seedDemoIfEmpty(options)).toBe('story-missing')
}, 180_000)
