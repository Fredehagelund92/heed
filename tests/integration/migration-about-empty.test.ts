import { copyFile, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type pg from 'pg'
import { expect, it } from 'vitest'
import { ABOUT_BUSINESS_STARTER } from '../../src/domain/about-business.ts'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { testDatabase } from './support.ts'

/*
  0010_about_starts_empty.sql: About our business starts empty. An install whose text is still the
  untouched default gets an empty version; one where a person changed the text keeps theirs. Each
  case needs a database of its own, at 0009, then migrated to 0010.
*/

const untouched = testDatabase({ unmigrated: true })
const changed = testDatabase({ unmigrated: true })

/** The migrations before 0010, then 0010 alone, so a later migration never changes the result. */
async function upTo(
  client: pg.Client,
  before: (client: pg.Client) => Promise<void> = async () => {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'heed-migration-0009-'))
  const names = (await readdir(migrationDirectory)).filter((n) => /^000[1-9]_.*\.sql$/.test(n))
  for (const name of names) await copyFile(new URL(name, migrationDirectory), join(dir, name))
  expect(await migrate(client, pathToFileURL(`${dir}/`))).toBe(9)
  await before(client)
  await copyFile(
    new URL('0010_about_starts_empty.sql', migrationDirectory),
    join(dir, '0010_about_starts_empty.sql'),
  )
  expect(await migrate(client, pathToFileURL(`${dir}/`))).toBe(1)
}

const about = async (client: pg.Client) =>
  (
    await client.query<{ value: unknown; version: number }>(
      "select value, version from settings_current where key='business.about'",
    )
  ).rows[0]

it('empties the text of an install that still has the untouched default', async () => {
  const before = await (async () => {
    let text: unknown
    await upTo(untouched.client, async (client) => {
      text = (await about(client))?.value
    })
    return text
  })()
  expect(before).toBe(ABOUT_BUSINESS_STARTER)
  expect(await about(untouched.client)).toEqual({ value: '', version: 2 })
})

it('keeps the text of an install where a person changed it', async () => {
  const theirs = 'We are a bike shop. Words: a ride is a rental.'
  await upTo(changed.client, async (client) => {
    await client.query(
      `insert into people (id, email, display_name) values ('00000000-0000-4000-8000-000000000001','admin@example.test','An admin')`,
    )
    await client.query(
      `insert into settings_versions (key, version, value, changed_by, reason)
       values ('business.about', 2, to_jsonb($1::text), '00000000-0000-4000-8000-000000000001', 'Our own words.')`,
      [theirs],
    )
  })
  expect(await about(changed.client)).toEqual({ value: theirs, version: 2 })
})
