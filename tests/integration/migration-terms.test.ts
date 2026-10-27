import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { foundation, people } from './fixtures.ts'
import { testDatabase } from './support.ts'

const { client } = testDatabase({ unmigrated: true })

/*
  0009_terms.sql: the terms and synonyms written in Definitions. A database at 0008 holds the
  vocabulary as before. After the migration it keeps terms with row security, one word once, a
  version for every write that is never changed, and changes to many terms for their Undo; the
  vocabulary and the definitions are untouched. (A test file shares one database, so the whole
  change is one test.)
*/

it('adds the terms, their versions and their changes, and leaves the vocabulary as it was', async () => {
  const before = await mkdtemp(join(tmpdir(), 'heed-migration-0008-'))
  try {
    const earlier = (await readdir(new URL('.', migrationDirectory)))
      .filter((name) => /^000[1-8]_.*\.sql$/.test(name))
      .sort()
    for (const name of earlier)
      await copyFile(new URL(name, migrationDirectory), join(before, name))
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(8)
    await foundation(client)
    const vocabulary = async () =>
      (
        await client.query<{ key: string; kind: string }>(
          'select key, kind::text from vocab_terms order by key',
        )
      ).rows

    const held = await vocabulary()
    // Up to 0009 only: later migrations have their own tests.
    await copyFile(new URL('0009_terms.sql', migrationDirectory), join(before, '0009_terms.sql'))
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(1)
    expect(await vocabulary()).toEqual(held)

    const security = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relname in ('terms', 'term_versions', 'term_changes') order by relname`,
    )
    expect(security.rows).toEqual([
      { relname: 'term_changes', relrowsecurity: true },
      { relname: 'term_versions', relrowsecurity: true },
      { relname: 'terms', relrowsecurity: true },
    ])

    const [made] = (
      await client.query<{ id: string; word: string; revision: number }>(
        `insert into terms (name, meaning, area_id, created_by, updated_by)
         values ('  Peak   Season ', 'The weeks before Christmas.', 'finance', $1, $1)
         returning id::text, word, revision`,
        [people.owner],
      )
    ).rows
    expect(made).toMatchObject({ word: 'peak season', revision: 1 })
    await expect(
      client.query(
        `insert into terms (name, meaning, area_id, created_by, updated_by)
         values ('peak season', 'Again.', 'finance', $1, $1)`,
        [people.owner],
      ),
    ).rejects.toMatchObject({ code: '23505' })
    await client.query("update terms set meaning = 'No campaign runs.' where id = $1::uuid", [
      made!.id,
    ])
    const versions = await client.query<{ revision: number; change: string; meaning: string }>(
      `select v.revision, v.change, v.meaning from term_versions v join terms t on t.id = v.term_id
        where t.id = $1::uuid order by v.revision`,
      [made!.id],
    )
    expect(versions.rows).toEqual([
      { revision: 1, change: 'created', meaning: 'The weeks before Christmas.' },
      { revision: 2, change: 'edited', meaning: 'No campaign runs.' },
    ])
    await expect(client.query("update term_versions set meaning = 'x'")).rejects.toMatchObject({
      code: '23001',
    })
    await expect(
      client.query(
        `insert into term_changes (action, made_by, summary, terms) values ('renamed', $1, 'x', '[{}]')`,
        [people.owner],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  } finally {
    await rm(before, { recursive: true, force: true })
  }
})
