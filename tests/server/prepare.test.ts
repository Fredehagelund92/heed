import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  databaseName,
  demoModelDir,
  isDemoModel,
  onDatabase,
  PrepareError,
  prepareSettings,
} from '../../db/prepare.ts'

/* Getting the database ready (db/prepare.ts): its settings, and what counts as the demo model. */

const bootstrap = 'postgres://postgres@db:5432/postgres'

describe('the settings', () => {
  it('migrate the local development database by default, with the demo off', () => {
    expect(prepareSettings({})).toEqual({
      bootstrapUrl: undefined,
      migrateUrl: 'postgres://context_layer_owner@localhost:5432/context_layer_dev',
      seedDemo: false,
      cubeModelDir: undefined,
    })
    expect(prepareSettings({ SEED_DEMO: '' }).seedDemo).toBe(false)
  })

  it('load the demo only when asked, with a superuser, and never in production', () => {
    expect(prepareSettings({ SEED_DEMO: 'on', DATABASE_URL_BOOTSTRAP: bootstrap }).seedDemo).toBe(
      true,
    )
    expect(() => prepareSettings({ SEED_DEMO: 'on' })).toThrow(
      'SEED_DEMO: loading the demo needs a superuser in DATABASE_URL_BOOTSTRAP',
    )
    expect(() =>
      prepareSettings({
        SEED_DEMO: 'on',
        DATABASE_URL_BOOTSTRAP: bootstrap,
        NODE_ENV: 'production',
      }),
    ).toThrow('SEED_DEMO: the demo data is refused when NODE_ENV=production')
    expect(() => prepareSettings({ SEED_DEMO: 'yes' })).toThrow(PrepareError)
  })

  it('name every bad address by its variable', () => {
    expect(() =>
      prepareSettings({ DATABASE_URL_MIGRATE: 'mysql://x/y', DATABASE_URL_BOOTSTRAP: 'nope' }),
    ).toThrow(
      'DATABASE_URL_BOOTSTRAP: expected a PostgreSQL URL\n  DATABASE_URL_MIGRATE: expected a PostgreSQL URL',
    )
  })
})

describe('addresses', () => {
  it('read the database and point the superuser at it', () => {
    expect(databaseName('postgres://context_layer_owner@db:5432/heed')).toBe('heed')
    expect(onDatabase(bootstrap, 'heed')).toBe('postgres://postgres@db:5432/heed')
  })
})

describe('the demo model', () => {
  const folders: string[] = []
  afterAll(() => Promise.all(folders.map((folder) => rm(folder, { recursive: true }))))
  const copy = async () => {
    const folder = await mkdtemp(join(tmpdir(), 'heed-model-'))
    folders.push(folder)
    await cp(demoModelDir, folder, { recursive: true })
    return folder
  }

  it('is the folder that comes with Heed, or an exact copy of it', async () => {
    expect(await isDemoModel(demoModelDir)).toBe(true)
    expect(await isDemoModel(await copy())).toBe(true)
  })

  it('is not another model, a changed copy, a missing folder or none', async () => {
    const changed = await copy()
    await writeFile(join(changed, 'orders.yml'), '# my own model\n', { flag: 'a' })
    const added = await copy()
    await writeFile(join(added, 'more.yml'), 'cubes: []\n')
    expect(await isDemoModel(changed)).toBe(false)
    expect(await isDemoModel(added)).toBe(false)
    expect(await isDemoModel(join(tmpdir(), 'heed-no-such-model'))).toBe(false)
    expect(await isDemoModel(undefined)).toBe(false)
  })
})
