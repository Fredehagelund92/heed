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
  0006_inbox_and_undo.sql: what the Inbox and the review's undo keep. A database at 0005 holds an
  owner's accept. After the migration that decision is the first round of its kind, the undo
  window is a setting, and the new tables are there with their row security. (A test file shares
  one database, so the whole change is one test.)
*/

async function atVersion5() {
  const before = await mkdtemp(join(tmpdir(), 'heed-migration-0005-'))
  for (const name of [
    '0001_baseline.sql',
    '0002_edition_digest_byte_order.sql',
    '0003_agent_wording.sql',
    '0004_agent_contract.sql',
    '0005_review_path.sql',
  ])
    await copyFile(new URL(name, migrationDirectory), join(before, name))
  expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(5)
  return before
}

it('keeps every decision as its first round, and adds what the Inbox and undo keep', async () => {
  const before = await atVersion5()
  try {
    await foundation(client)
    const decided = await transaction(client, async () => {
      const v = await version(client)
      await accept(client, v.id)
      return v.id
    })

    // Up to 0006 only: later migrations have their own tests.
    await copyFile(
      new URL('0006_inbox_and_undo.sql', migrationDirectory),
      join(before, '0006_inbox_and_undo.sql'),
    )
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(1)

    expect(
      (
        await client.query<{ round: number }>(
          'select round from decisions where item_version_id=$1',
          [decided],
        )
      ).rows,
    ).toEqual([{ round: 0 }])
    expect(
      (
        await client.query(
          "select value #>> '{}' as seconds from settings_current where key='limits.undo_seconds'",
        )
      ).rows,
    ).toEqual([{ seconds: '15' }])
    const reasons = await client.query<{ value: string }>(
      'select unnest(enum_range(null::edition_reason))::text as value',
    )
    expect(reasons.rows.map((r) => r.value)).toContain('decision_undone')
    const tables = await client.query<{ name: string; rls: boolean }>(
      `select relname as name, relrowsecurity as rls from pg_class
        where relname in ('decision_undos','card_reads','card_states','setup_marks') order by relname`,
    )
    expect(tables.rows).toEqual([
      { name: 'card_reads', rls: true },
      { name: 'card_states', rls: true },
      { name: 'decision_undos', rls: true },
      { name: 'setup_marks', rls: false },
    ])
    const transitions = await client.query(
      "select 1 from proposal_transitions where from_state='accepted' and to_state='submitted'",
    )
    expect(transitions.rowCount).toBe(1)
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(0)
  } finally {
    await rm(before, { recursive: true })
  }
})
