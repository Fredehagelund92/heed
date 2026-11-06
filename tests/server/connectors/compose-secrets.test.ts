import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { openLocalSecretStore } from '../../../src/server/modules/connectors/index.ts'

/*
  The secret store of `docker compose up`: compose.yaml names a folder in the keys volume, so a
  connector's secret outlives the container. The folder is one of its own, since the service
  refuses a folder others may read and the volume's top is such a folder. The images form
  (compose.images.yaml) only changes the images, so it gets the same store. A connector's token
  saved through the service in this configuration is in tests/integration/compose-secrets.test.ts,
  and tests/image/compose-secrets.sh does it on the real containers.
*/

type Service = { environment?: Record<string, string>; volumes?: string[]; image?: string }
type Compose = { services: Record<string, Service>; volumes: Record<string, unknown> }
const read = async (file: string) =>
  parse(await readFile(new URL(`../../../${file}`, import.meta.url), 'utf8')) as Compose

const compose = await read('compose.yaml')
const heed = compose.services['heed']!
const secretsDir = heed.environment!['HEED_SECRETS_DIR']!
const keysVolume = heed.volumes!.find((volume) => volume.startsWith('keys:'))!.split(':')[1]!

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
/** The keys volume as the image makes it: its top belongs to the service, and anyone may read it. */
async function volume() {
  const dir = await mkdtemp(join(tmpdir(), 'heed-keys-'))
  temporary.push(dir)
  await chmod(dir, 0o755)
  return dir
}

describe('the secret store in compose', () => {
  it('is a folder of its own in the keys volume, which outlives the container', () => {
    expect(Object.keys(compose.volumes)).toContain('keys')
    expect(posix.isAbsolute(secretsDir)).toBe(true)
    const inside = posix.relative(keysVolume, secretsDir)
    expect(inside).not.toBe('')
    expect(inside.startsWith('..')).toBe(false)
  })

  it('comes with the images form, which sets no environment of its own', async () => {
    const images = await read('compose.images.yaml')
    expect(images.services['heed']).toEqual({ image: expect.any(String) })
  })

  it('saves a secret and reads it back after the service starts again', async () => {
    const keys = await volume()
    const dir = join(keys, relative(keysVolume, secretsDir))
    const ref = await (await openLocalSecretStore(dir)).write({ fileAddress: 'https://a.example' })
    const again = await openLocalSecretStore(dir)
    expect(await again.read(ref)).toEqual({ fileAddress: 'https://a.example' })
  })

  it('could not be the top of the volume: the service would refuse to start', async () => {
    await expect(openLocalSecretStore(await volume())).rejects.toThrow(
      /readable by the server only/,
    )
  })

  it('keeps working on a volume from before the setting, which already holds the keys', async () => {
    const keys = await volume()
    await writeFile(join(keys, 'mcp-state.key'), 'a key')
    const dir = join(keys, relative(keysVolume, secretsDir))
    expect((await openLocalSecretStore(dir)).available).toBe(true)
  })
})
