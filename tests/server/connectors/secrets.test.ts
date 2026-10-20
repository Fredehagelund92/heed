import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  noSecretStore,
  openLocalSecretStore,
  SecretStoreError,
} from '../../../src/server/modules/connectors/index.ts'

/*
  The local secret store (CON-105): a folder only the server's user may open, one file per
  source that only that user may read, named by a random id the database keeps instead of the
  secret.
*/

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'heed-secrets-'))
  temporary.push(dir)
  return dir
}

describe('the local secret store', () => {
  it('keeps secrets in a file only the server may read, under a random name', async () => {
    const dir = join(await folder(), 'store')
    const store = await openLocalSecretStore(dir)
    expect(store.available).toBe(true)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    const ref = await store.write({ token: 'secret-value-1' })
    expect(ref).toMatch(/^local:[0-9a-f-]{36}$/)
    const files = await readdir(dir)
    expect(files).toEqual([`${ref.slice('local:'.length)}.json`])
    expect((await stat(join(dir, files[0]!))).mode & 0o777).toBe(0o600)
    expect(await store.read(ref)).toEqual({ token: 'secret-value-1' })
    // Each write is a new name: a replaced secret never overwrites the one in use.
    expect(await store.write({ token: 'secret-value-1' })).not.toBe(ref)
    await store.remove(ref)
    expect(await store.read(ref)).toBeNull()
    await store.remove(ref)
  })

  it('refuses a folder others may open, rather than mending it', async () => {
    const dir = await folder()
    await chmod(dir, 0o755)
    await expect(openLocalSecretStore(dir)).rejects.toThrow(/readable by the server only/)
    const file = join(await folder(), 'file')
    await writeFile(file, '')
    await expect(openLocalSecretStore(file)).rejects.toThrow(SecretStoreError)
  })

  it('never makes a path of a name that is not its own', async () => {
    const store = await openLocalSecretStore(await folder())
    for (const ref of ['local:../../etc/passwd', 'local:', 'vault:abc', '../x', 'local:ABC'])
      await expect(store.read(ref)).rejects.toThrow(SecretStoreError)
  })

  it('says an entry is damaged without saying what it holds', async () => {
    const dir = await folder()
    await mkdir(dir, { recursive: true })
    const store = await openLocalSecretStore(dir)
    const ref = await store.write({ token: 'kept' })
    await writeFile(join(dir, `${ref.slice(6)}.json`), '{"token": "half-written')
    const error = await store.read(ref).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SecretStoreError)
    expect((error as Error).message).not.toContain('half-written')
  })

  it('without a store, keeps nothing and says how to get one', async () => {
    expect(noSecretStore.available).toBe(false)
    expect(await noSecretStore.read('local:00000000-0000-0000-0000-000000000000')).toBeNull()
    await expect(noSecretStore.write({ token: 'x' })).rejects.toThrow(/CL_SECRETS_DIR/)
  })
})
