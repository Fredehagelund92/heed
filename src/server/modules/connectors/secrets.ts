import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The secret store (CON-105): where a source's secrets live, by a name (`secret_ref`) the
 * database keeps instead of the secret. A secret is written once and read only to hand it to the
 * source's reader: never to the browser, a log, an error, a snapshot or the history log.
 */
export interface SecretStore {
  /** False when the server has none: a source that needs a secret cannot be added. */
  readonly available: boolean
  /** The secrets under a name, or null when the store does not hold them. */
  read(ref: string): Promise<Readonly<Record<string, string>> | null>
  /** Keeps secrets under a new name, and returns the name. */
  write(secrets: Readonly<Record<string, string>>): Promise<string>
  /** Forgets the secrets under a name; a name it does not hold is fine. */
  remove(ref: string): Promise<void>
}

/** Says what is wrong with the store, never what it holds. */
export class SecretStoreError extends Error {
  override name = 'SecretStoreError'
}

/** A server without a secret store (`CL_SECRETS_DIR` unset). */
export const noSecretStore: SecretStore = {
  available: false,
  read: () => Promise.resolve(null),
  write: () =>
    Promise.reject(new SecretStoreError('This server has no secret store: set CL_SECRETS_DIR')),
  remove: () => Promise.resolve(),
}

const localRef = /^local:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

const isSecrets = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === 'string')

/**
 * The local secret store: a folder only the server's own user may open (mode 0700), outside the
 * repository, with one file per source (mode 0600) named by a random id. For one server; a
 * hosted service with several moves to a managed store behind the same interface. It refuses a
 * folder others may read, rather than mending it, so a mistake is seen.
 */
export async function openLocalSecretStore(dir: string): Promise<SecretStore> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
  } catch {
    throw new SecretStoreError(`${dir} could not be made a folder`)
  }
  const info = await stat(dir)
  if (!info.isDirectory()) throw new SecretStoreError(`${dir} is not a folder`)
  if (typeof process.getuid === 'function' && info.uid !== process.getuid())
    throw new SecretStoreError(`${dir} must belong to the user the server runs as`)
  if ((info.mode & 0o077) !== 0)
    throw new SecretStoreError(`${dir} must be readable by the server only: chmod 700 ${dir}`)
  const file = (ref: string) => {
    const id = localRef.exec(ref)?.[1]
    // The name comes from the database: a name that is not one of ours never becomes a path.
    if (!id) throw new SecretStoreError('Not a name in the local secret store')
    return join(dir, `${id}.json`)
  }
  return {
    available: true,
    async read(ref) {
      let text: string
      try {
        text = await readFile(file(ref), 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw new SecretStoreError('The secret store could not be read')
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        throw new SecretStoreError('The secret store holds a damaged entry')
      }
      if (!isSecrets(value)) throw new SecretStoreError('The secret store holds a damaged entry')
      return value
    },
    async write(secrets) {
      const ref = `local:${randomUUID()}`
      const path = file(ref)
      const draft = `${path}.${randomUUID()}.tmp`
      try {
        // Created 0600 so no other user can open it even for a moment; renamed into place whole.
        const handle = await open(draft, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify(secrets))
          await handle.sync()
        } finally {
          await handle.close()
        }
        await chmod(draft, 0o600)
        await rename(draft, path)
      } catch {
        await unlink(draft).catch(() => {})
        throw new SecretStoreError('The secret store could not be written')
      }
      return ref
    },
    async remove(ref) {
      try {
        await unlink(file(ref))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    },
  }
}
