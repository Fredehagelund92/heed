import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { restoreSnapshot } from '../../db/snapshot.ts'
import { pgTool } from '../../src/server/db/restore-drill.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import { testDatabase } from './support.ts'

/**
 * The demo snapshot restored as the database's owner alone, as on Neon (db/snapshot.ts). The
 * demo seed takes a minute, so the file here is a migrated database marked as the demo.
 */

const source = testDatabase()
const target = testDatabase({ unmigrated: true })
const as = (url: string, role: string) => `${url}?options=${encodeURIComponent(`-c role=${role}`)}`
let folder: string
let file: string

beforeAll(async () => {
  await source.client.query(
    "insert into areas (id, name, is_demo) values ('area_sandbox', 'Sandbox', true)",
  )
  folder = await mkdtemp(join(tmpdir(), 'heed-snapshot-'))
  file = join(folder, 'demo.dump')
  await pgTool('pg_dump', undefined, [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    `--file=${file}`,
    `--dbname=${source.url}`,
  ])
})
afterAll(() => rm(folder, { recursive: true, force: true }))

const owner = () => as(target.url, localRoles.owner)

describe('the demo snapshot', () => {
  it('is refused by a role that does not own the database', async () => {
    await expect(
      restoreSnapshot({ migrateUrl: as(target.url, localRoles.api), file, reset: false }),
    ).rejects.toThrow('DATABASE_URL_MIGRATE: expected the owner of the database')
  })

  it('restores as the owner, with the grants the runtime roles read by', async () => {
    await restoreSnapshot({ migrateUrl: owner(), file, reset: false })
    await target.client.query(`set role ${localRoles.api}`)
    try {
      const { rows } = await target.client.query<{ name: string }>(
        "select name from areas where id = 'area_sandbox'",
      )
      expect(rows).toEqual([{ name: 'Sandbox' }])
    } finally {
      await target.client.query(`set role ${localRoles.owner}`)
    }
  }, 60_000)

  it('restores over the demo only when told to reset it', async () => {
    await expect(restoreSnapshot({ migrateUrl: owner(), file, reset: false })).rejects.toThrow(
      'holds the demo already. To replace it with the snapshot, run reset',
    )
    await target.client.query("update areas set name = 'Changed' where id = 'area_sandbox'")
    await restoreSnapshot({ migrateUrl: owner(), file, reset: true })
    const { rows } = await target.client.query<{ name: string }>(
      "select name from areas where id = 'area_sandbox'",
    )
    expect(rows).toEqual([{ name: 'Sandbox' }])
  }, 60_000)

  it('never resets a database that holds anything but the demo', async () => {
    await target.client.query("delete from areas where id = 'area_sandbox'")
    await expect(restoreSnapshot({ migrateUrl: owner(), file, reset: true })).rejects.toThrow(
      'holds something other than the demo',
    )
  })
})
