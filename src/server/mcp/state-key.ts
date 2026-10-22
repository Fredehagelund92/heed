import { randomBytes } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'

/*
  The key that seals `draft_context`'s question rounds (CL_MCP_STATE_KEY_FILE): an HMAC key of at
  least 32 bytes, written as hex, readable by its owner only. Every instance must hold the same
  key, because the person's agent may send the answers to another one. Outside production a
  missing file is created; in production a missing file turns the questions in the agent off,
  so the tool lists them with the draft link instead, until the key is provided. Key material
  never appears in an error or a log line.
*/

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

async function readKey(file: string): Promise<Uint8Array> {
  if (((await stat(file)).mode & 0o077) !== 0)
    throw new Error(`${file} must be readable by its owner only (chmod 600)`)
  const hex = (await readFile(file, 'utf8')).trim()
  if (!/^(?:[0-9a-f]{2}){32,}$/i.test(hex))
    throw new Error(`${file} must hold at least 32 bytes as hex (openssl rand -hex 32)`)
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

/** The state key, or null in production when its file does not exist. */
export async function loadStateKey(file: string, nodeEnv: string): Promise<Uint8Array | null> {
  try {
    return await readKey(file)
  } catch (error) {
    if (!missing(error)) throw error
    if (nodeEnv === 'production') return null
    try {
      await writeFile(file, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 })
    } catch (writeError) {
      if (!(writeError instanceof Error && 'code' in writeError && writeError.code === 'EEXIST'))
        throw writeError
    }
    return readKey(file)
  }
}
