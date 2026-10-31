import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { expect, it } from 'vitest'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { testDatabase } from './support.ts'
const { client, url } = testDatabase()
it('applies the full baseline once and then does nothing', async () => {
  expect(await migrate(client)).toBe(0)
  const rows = await client.query('select name from schema_migrations')
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql'))
  expect(rows.rowCount).toBe(files.length)
})
it('serializes concurrent migrations, rolls back failures and refuses altered history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'heed-migration-'))
  const other = new pg.Client({ connectionString: url })
  await other.connect()
  await other.query(`set role ${identifier(localRoles.owner)}`)
  await client.query('create schema migration_test; set search_path=migration_test')
  await other.query('set search_path=migration_test')
  const source = pathToFileURL(directory + '/')
  try {
    await writeFile(
      join(directory, '0001_test.sql'),
      'create table proof (id int primary key); insert into proof values (1);',
    )
    const applied = await Promise.all([migrate(client, source), migrate(other, source)])
    expect(applied.sort()).toEqual([0, 1])
    await writeFile(
      join(directory, '0002_fail.sql'),
      'insert into proof values (2); select no_such_function();',
    )
    await expect(migrate(client, source)).rejects.toThrow('0002_fail.sql failed')
    expect((await client.query('select * from proof')).rows).toEqual([{ id: 1 }])
    await writeFile(join(directory, '0002_fail.sql'), 'insert into proof values (2);')
    expect(await migrate(client, source)).toBe(1)
    await writeFile(join(directory, '0003-bad.sql'), 'select 1;')
    await expect(migrate(client, source)).rejects.toThrow('0003-bad.sql must be named')
    await rm(join(directory, '0003-bad.sql'))
    await writeFile(join(directory, '0001_test.sql'), 'select 1;')
    await expect(migrate(client, source)).rejects.toThrow('history differs')
    // One applied from its branch and then renumbered after another took its number is refused.
    await writeFile(
      join(directory, '0001_test.sql'),
      'create table proof (id int primary key); insert into proof values (1);',
    )
    await rm(join(directory, '0002_fail.sql'))
    await writeFile(join(directory, '0002_other.sql'), 'select 1;')
    await writeFile(join(directory, '0003_fail.sql'), 'insert into proof values (2);')
    await expect(migrate(client, source)).rejects.toThrow(
      'Migration 0002_fail.sql is now 0003_fail.sql: the database applied it under its old number',
    )
    await rm(join(directory, '0002_other.sql'))
    await rm(join(directory, '0003_fail.sql'))
    await writeFile(join(directory, '0002_fail.sql'), 'insert into proof values (2);')
    // A database made by other migrations, such as those the baseline replaced, is refused.
    await writeFile(join(directory, '0001_other.sql'), 'select 1;')
    await rm(join(directory, '0001_test.sql'))
    await rm(join(directory, '0002_fail.sql'))
    await expect(migrate(client, source)).rejects.toThrow(
      'Migration history starts at 0001_test.sql, not 0001_other.sql',
    )
  } finally {
    await other.end()
    await client.query('set search_path=public; drop schema migration_test cascade')
    await rm(directory, { recursive: true, force: true })
  }
})
