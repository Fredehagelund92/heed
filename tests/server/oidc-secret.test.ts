import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readClientSecret, safeReturnTo } from '../../src/server/modules/auth/index.ts'

// The OIDC client secret is read from a file only its owner may read, and never said back.
let folder: string
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'heed-oidc-'))
})
afterAll(() => rm(folder, { recursive: true, force: true }))

describe('the OIDC client secret file', () => {
  it('is read when only its owner may read it', async () => {
    const file = join(folder, 'owner-only')
    await writeFile(file, 'sEcReT-value\n')
    await chmod(file, 0o600)
    expect(await readClientSecret(file)).toBe('sEcReT-value')
  })

  it('is refused when others may read it, or it is empty, without saying what is in it', async () => {
    const open = join(folder, 'open')
    await writeFile(open, 'sEcReT-value')
    await chmod(open, 0o644)
    const refused = readClientSecret(open)
    await expect(refused).rejects.toThrow(/chmod 600/)
    await expect(refused).rejects.not.toThrow(/sEcReT/)
    const empty = join(folder, 'empty')
    await writeFile(empty, '  \n')
    await chmod(empty, 0o600)
    await expect(readClientSecret(empty)).rejects.toThrow(/is empty/)
    await expect(readClientSecret(folder)).rejects.toThrow(/is not a file/)
  })
})

describe('where a sign-in goes back to', () => {
  const web = 'https://heed.example'
  it.each([
    ['/#/inbox', '/#/inbox'],
    ['/settings/people?tab=invited', '/settings/people?tab=invited'],
    [undefined, '/'],
    ['', '/'],
    ['inbox', '/'],
    ['//evil.example/x', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example/', '/'],
    ['/\u0000x', '/'],
    [`/${'a'.repeat(600)}`, '/'],
  ])('%j goes to %j', (asked, path) => {
    expect(safeReturnTo(asked, web)).toBe(path)
  })
})
