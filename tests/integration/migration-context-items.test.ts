import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { accept, foundation, version } from './fixtures.ts'
import { testDatabase, transaction } from './support.ts'

const { client } = testDatabase({ unmigrated: true })

/*
  0007_context_items.sql: what Context keeps. A database at 0006 holds an accepted item. After the
  migration its version carries the kind its item was created with, what agents get reads it
  there, a draft records who deleted it, and the new tables are there with their row security.
  (A test file shares one database, so the whole change is one test.)
*/

async function atVersion6() {
  const before = await mkdtemp(join(tmpdir(), 'heed-migration-0006-'))
  for (const name of [
    '0001_baseline.sql',
    '0002_edition_digest_byte_order.sql',
    '0003_agent_wording.sql',
    '0004_agent_contract.sql',
    '0005_review_path.sql',
    '0006_inbox_and_undo.sql',
  ])
    await copyFile(new URL(name, migrationDirectory), join(before, name))
  expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(6)
  return before
}

it("keeps each version's kind, and adds what Context keeps", async () => {
  const before = await atVersion6()
  try {
    await foundation(client)
    const v = await transaction(client, async () => {
      const made = await version(client)
      await accept(client, made.id)
      return made
    })
    const digest = await client.query<{ d: string }>(
      "select encode(content_digest,'hex') as d from item_versions where id=$1",
      [v.id],
    )

    // Up to 0007 only: later migrations have their own tests.
    await copyFile(
      new URL('0007_context_items.sql', migrationDirectory),
      join(before, '0007_context_items.sql'),
    )
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(1)

    const kinds = await client.query<{ kind: string; d: string }>(
      "select v.kind::text as kind, encode(v.content_digest,'hex') as d from item_versions v where v.id=$1",
      [v.id],
    )
    expect(kinds.rows).toEqual([{ kind: 'note', d: digest.rows[0]!.d }])
    const nullable = await client.query<{ nullable: string }>(
      `select is_nullable as nullable from information_schema.columns
        where table_name='item_versions' and column_name='kind'`,
    )
    expect(nullable.rows).toEqual([{ nullable: 'NO' }])
    const tables = await client.query<{ name: string; rls: boolean }>(
      `select relname as name, relrowsecurity as rls from pg_class
        where relname in ('item_owners','item_reads','item_changes') order by relname`,
    )
    expect(tables.rows).toEqual([
      { name: 'item_changes', rls: true },
      { name: 'item_owners', rls: true },
      { name: 'item_reads', rls: true },
    ])
    const column = await client.query(
      "select 1 from information_schema.columns where table_name='proposals' and column_name='discarded_by'",
    )
    expect(column.rowCount).toBe(1)
    // A version written without a kind takes the one before it.
    const next = await transaction(client, () => version(client))
    expect(
      (
        await client.query<{ kind: string }>(
          'select kind::text as kind from item_versions where id=$1',
          [next.id],
        )
      ).rows,
    ).toEqual([{ kind: 'note' }])
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(0)
  } finally {
    await rm(before, { recursive: true })
  }
})
