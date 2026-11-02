import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renamedSettings } from '../../src/domain/renamed-settings.ts'

/*
  The settings were named CL_ before 0.1.0 and are HEED_ since. The fallback table
  (src/domain/renamed-settings.ts) is the one place that names an old setting, so a new setting
  cannot be added under the old prefix and an old name cannot creep back into the code, the
  configuration or the docs. The guard is shown failing on each, then run on the repository.
*/

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The files that may name an old setting: the table, and the tests of the fallback. */
const allowedFiles = new Set([
  'src/domain/renamed-settings.ts',
  'tests/server/renamed-settings.test.ts',
  'tests/lint/renamed-settings.test.ts',
])
/** An applied migration is never changed (db/README.md), so its comments keep the old names. */
const migration = /^db\/migrations\/.+\.sql$/
/** The upgrade note in docs/operations.md lists the old names. */
const upgradeNote = { file: 'docs/operations.md', heading: '## Settings named CL_ before 0.1.0' }
/** Retired before the rename and read by nothing: named only to say it no longer works. */
const retired = new Set(['CL_DEV_PERSON'])

/** The upgrade note's section of docs/operations.md, up to the next heading of its level. */
function noteSection(text: string): string {
  const start = text.indexOf(`${upgradeNote.heading}\n`)
  if (start < 0) return ''
  const end = text.indexOf('\n## ', start + upgradeNote.heading.length)
  return text.slice(start, end < 0 ? undefined : end)
}

/** The old setting names a file may not name. */
function oldSettingNames(path: string, text: string): string[] {
  if (allowedFiles.has(path)) return []
  const checked = path === upgradeNote.file ? text.replace(noteSection(text), '') : text
  return (checked.match(/\bCL_[A-Z][A-Z0-9_]*/g) ?? []).filter(
    (name) => !retired.has(name) && !(migration.test(path) && name in renamedSettings),
  )
}

/** Every file git tracks or would track, with its text; binary files are left out. */
function repositoryFiles(): { path: string; text: string }[] {
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  return [...new Set(listed.stdout.split('\0').filter(Boolean))]
    .filter((path) => existsSync(`${root}${path}`))
    .map((path) => ({ path, text: readFileSync(`${root}${path}`, 'utf8') }))
    .filter(({ text }) => !text.includes('\0'))
}

describe('the old CL_ setting names', () => {
  it('fails a new setting with the old prefix, in code, configuration or docs', () => {
    expect(oldSettingNames('src/server/config/env.ts', 'CL_NEW_THING: z.string()')).toEqual([
      'CL_NEW_THING',
    ])
    expect(oldSettingNames('compose.yaml', '      CL_NEW_THING: on')).toEqual(['CL_NEW_THING'])
    expect(oldSettingNames('docs/self-hosting.md', 'Set `CL_NEW_THING`.')).toEqual(['CL_NEW_THING'])
    expect(oldSettingNames('db/migrations/0099_new.sql', '-- see CL_NEW_THING')).toEqual([
      'CL_NEW_THING',
    ])
  })

  it('fails an old name outside the table, even one the table pairs', () => {
    expect(oldSettingNames('src/server/brand.ts', 'process.env.CL_PRODUCT_NAME')).toEqual([
      'CL_PRODUCT_NAME',
    ])
    expect(oldSettingNames('.env.example', 'CL_AUTH=dev')).toEqual(['CL_AUTH'])
    const doc = `# Run\n\nSet \`CL_AUTH\`.\n\n${upgradeNote.heading}\n\n\`CL_AUTH\` is now \`HEED_AUTH\`.\n\n## Next\n\n\`CL_WEB_ORIGINS\`\n`
    expect(oldSettingNames(upgradeNote.file, doc)).toEqual(['CL_AUTH', 'CL_WEB_ORIGINS'])
  })

  it('passes the table, an applied migration and the upgrade note', () => {
    expect(oldSettingNames('src/domain/renamed-settings.ts', "CL_AUTH: 'HEED_AUTH'")).toEqual([])
    expect(
      oldSettingNames('db/migrations/0014_oidc_sign_in.sql', '-- CL_OIDC_ADMIN_GROUPS'),
    ).toEqual([])
    expect(
      oldSettingNames(
        upgradeNote.file,
        `${upgradeNote.heading}\n\n\`CL_AUTH\` is now \`HEED_AUTH\`.\n`,
      ),
    ).toEqual([])
  })

  it('names no old setting anywhere in the repository but those places', () => {
    const found = repositoryFiles().flatMap(({ path, text }) =>
      oldSettingNames(path, text).map((name) => `${path}: ${name}`),
    )
    expect(found).toEqual([])
  })

  it('lists every old name in the upgrade note', () => {
    const note = noteSection(readFileSync(`${root}${upgradeNote.file}`, 'utf8'))
    expect(note).not.toBe('')
    for (const oldName of Object.keys(renamedSettings)) expect(note).toContain(`\`${oldName}\``)
  })
})
