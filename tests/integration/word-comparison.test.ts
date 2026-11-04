import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { termWord } from '../../src/domain/terms.ts'
import { migrate, migrationDirectory } from '../../src/server/db/migrate.ts'
import { foundation, people } from './fixtures.ts'
import { testDatabase } from './support.ts'

const { client } = testDatabase({ unmigrated: true })

/*
  0039_word_comparison.sql: one way to compare a word, in the write check, the database rule and
  the reader (FR-138). A database at 0038 can hold Sales and Salés as two words. The migration
  keeps both, each as it was written, and holds a word to one meaning from then on. Its function
  gives the service's own answer for every script a word is written in. (A test file shares one
  database, so the whole change is one test.)
*/

/** The letters a word is written in: Latin with its accents, and the scripts people write words in. */
const scripts = [
  [0x20, 0x24f],
  [0x370, 0x3ff],
  [0x400, 0x52f],
  [0x591, 0x5ea],
  [0x620, 0x65f],
  [0x900, 0x97f],
  [0xe01, 0xe3a],
  [0x1e00, 0x1fff],
  [0x2000, 0x206f],
  [0x3000, 0x30ff],
  [0xac00, 0xac20],
  [0xff00, 0xffef],
]
const letter = fc
  .constantFrom(...scripts)
  .chain(([from, to]) => fc.integer({ min: from!, max: to! }))
  .map((code) => String.fromCodePoint(code))

it('keeps the words there are, and compares a word one way from then on', async () => {
  const before = await mkdtemp(join(tmpdir(), 'heed-migration-0038-'))
  try {
    const names = (await readdir(new URL('.', migrationDirectory))).filter((n) =>
      n.endsWith('.sql'),
    )
    const earlier = names.filter((name) => name < '0039').sort()
    for (const name of earlier)
      await copyFile(new URL(name, migrationDirectory), join(before, name))
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(earlier.length)
    await foundation(client)
    const write = (name: string, meaning = 'A meaning.') =>
      client.query<{ id: string }>(
        `insert into terms (name, meaning, area_id, created_by, updated_by)
         values ($1, $2, 'finance', $3, $3) returning id::text`,
        [name, meaning, people.owner],
      )
    const sales = (await write('Sales')).rows[0]!.id
    const accented = (await write('Salés', 'Another meaning.')).rows[0]!.id
    const versions = await client.query('select count(*)::int as n from term_versions')

    await copyFile(
      new URL('0039_word_comparison.sql', migrationDirectory),
      join(before, '0039_word_comparison.sql'),
    )
    expect(await migrate(client, pathToFileURL(`${before}/`))).toBe(1)

    // Both words stay, as written, and being marked is no new version.
    const kept = await client.query<{
      id: string
      name: string
      word: string
      word_clash: boolean
    }>('select id::text, name, word, word_clash from terms order by id')
    expect(kept.rows).toEqual([
      { id: sales, name: 'Sales', word: 'sales', word_clash: false },
      { id: accented, name: 'Salés', word: 'sales', word_clash: true },
    ])
    expect((await client.query('select count(*)::int as n from term_versions')).rows).toEqual(
      versions.rows,
    )

    // The earlier one still holds the word, however it is written.
    for (const name of ['sales', ' SALÉS ', 'Sàles'])
      await expect(write(name)).rejects.toMatchObject({ code: '23505' })
    await expect(write('Peak Séason')).resolves.toBeTruthy()
    await expect(write('Péak  season')).rejects.toMatchObject({ code: '23505' })

    // Editing a marked term is open, so its owner can settle it; a new word ends the mark.
    await client.query(`update terms set meaning = 'Changed.' where id = $1::uuid`, [accented])
    const renamed = await client.query<{ word: string; word_clash: boolean }>(
      `update terms set name = 'Sale value' where id = $1::uuid returning word, word_clash`,
      [accented],
    )
    expect(renamed.rows).toEqual([{ word: 'sale value', word_clash: false }])

    // The database and the service give one answer. Characters newer than the database's Unicode
    // version are outside this list: they read as written until PostgreSQL knows them.
    const samples = fc.sample(fc.array(letter, { minLength: 1, maxLength: 12 }), 2000)
    const words = [
      ...samples.map((letters) => letters.join('')),
      'Salés',
      'ΑΣ',
      'Øre Æble Straße',
      'Net Revenue',
      '  Peak   Season ',
      'Net-revenue',
      'ﬁnance',
    ]
    const compared = await client.query<{ w: string; word: string }>(
      'select w, cl_term_word(w) as word from unnest($1::text[]) w',
      [words],
    )
    for (const { w, word } of compared.rows) expect(word, JSON.stringify(w)).toBe(termWord(w))
  } finally {
    await rm(before, { recursive: true, force: true })
  }
})
