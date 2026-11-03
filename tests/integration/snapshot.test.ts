import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { modelSetting, restoreSnapshot } from '../../db/snapshot.ts'
import { pgTool } from '../../src/server/db/restore-drill.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
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

describe('what the database holds before a restore', () => {
  const bare = testDatabase({ unmigrated: true })
  const bareOwner = () => as(bare.url, localRoles.owner)
  const refused = 'holds something other than the demo'

  it.each([
    ['a schema', 'create schema extra', 'drop schema extra'],
    [
      'a function',
      'create function public.extra() returns int language sql as $$ select 1 $$',
      'drop function public.extra()',
    ],
    ['a sequence', 'create sequence public.extra', 'drop sequence public.extra'],
    ['a type', "create type public.extra as enum ('a')", 'drop type public.extra'],
  ])('is refused when it holds %s', async (_name, create, drop) => {
    await bare.client.query(create)
    try {
      await expect(
        restoreSnapshot({ migrateUrl: bareOwner(), file, reset: false }),
      ).rejects.toThrow(refused)
    } finally {
      await bare.client.query(drop)
    }
  })

  it('restores into a database with only an extension installed, not one with a user-made object', async () => {
    await bare.client.query('create extension if not exists pg_trgm with schema public')
    await bare.client.query('create table public.extra (id int)')
    await expect(restoreSnapshot({ migrateUrl: bareOwner(), file, reset: false })).rejects.toThrow(
      refused,
    )
    await bare.client.query('drop table public.extra')
    await restoreSnapshot({ migrateUrl: bareOwner(), file, reset: false })
    const { rows } = await bare.client.query<{ name: string }>(
      "select name from areas where id = 'area_sandbox'",
    )
    expect(rows).toEqual([{ name: 'Sandbox' }])
  }, 60_000)

  it('is refused when a runtime role is missing or may do more than serve', async () => {
    const suffix = randomBytes(4).toString('hex')
    const roles = {
      owner: localRoles.owner,
      api: `heed_snap_api_${suffix}`,
      serve: `heed_snap_serve_${suffix}`,
      readonly: `heed_snap_ro_${suffix}`,
    }
    const adminUrl = new URL(inject('databaseTemplate'))
    adminUrl.pathname = '/postgres'
    const admin = new pg.Client({ connectionString: adminUrl.href })
    await admin.connect()
    const restore = () => restoreSnapshot({ migrateUrl: bareOwner(), file, reset: false, roles })
    try {
      await expect(restore()).rejects.toThrow(
        `Create the roles ${roles.api}, ${roles.serve}, ${roles.readonly} first`,
      )
      await admin.query(`create role ${identifier(roles.api)} nologin`)
      await admin.query(`create role ${identifier(roles.serve)} nologin bypassrls`)
      await admin.query(`create role ${identifier(roles.readonly)} nologin`)
      await expect(restore()).rejects.toThrow(
        new RegExp(`roles ${roles.serve} may bypass row security`),
      )
      await admin.query(`alter role ${identifier(roles.serve)} nobypassrls`)
      await admin.query(`grant ${identifier(roles.api)} to ${identifier(roles.readonly)}`)
      await expect(restore()).rejects.toThrow(
        new RegExp(`roles ${roles.readonly} may bypass row security`),
      )
    } finally {
      for (const role of [roles.readonly, roles.serve, roles.api])
        await admin.query(`drop role if exists ${identifier(role)}`)
      await admin.end()
    }
  })
})

describe('modelSetting', () => {
  it('accepts a provider and model it knows', () => {
    expect(modelSetting('vercel-gateway:anthropic/claude-haiku-5.5')).toEqual({
      provider: 'vercel-gateway',
      model: 'anthropic/claude-haiku-5.5',
    })
  })

  it('refuses a missing colon, and an unknown provider or model', () => {
    expect(() => modelSetting('claude-haiku-5.5')).toThrow('expected <provider>:<model>')
    expect(() => modelSetting('nowhere:anthropic/claude-haiku-5.5')).toThrow('--model:')
    expect(() => modelSetting('vercel-gateway:no-such-model')).toThrow('--model:')
  })
})
