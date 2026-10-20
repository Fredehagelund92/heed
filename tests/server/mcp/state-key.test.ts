import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadStateKey } from '../../../src/server/mcp/state-key.ts'

/* The key that seals draft_context's question rounds (CL_MCP_STATE_KEY_FILE). */

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'heed-state-key-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the state key', () => {
  it('is created outside production, owner-only, and read the same next time', async () => {
    const file = join(dir, 'state.key')
    const key = await loadStateKey(file, 'development')
    expect(key?.byteLength).toBe(32)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await loadStateKey(file, 'development')).toEqual(key)
    expect((await readFile(file, 'utf8')).trim()).toMatch(/^[0-9a-f]{64}$/)
  })
  it('turns the questions off in production when it is missing, rather than inventing one', async () => {
    expect(await loadStateKey(join(dir, 'missing.key'), 'production')).toBeNull()
  })
  it('refuses a key others can read, or one shorter than 32 bytes', async () => {
    const open = join(dir, 'open.key')
    await writeFile(open, 'ab'.repeat(32), { mode: 0o644 })
    await expect(loadStateKey(open, 'production')).rejects.toThrow('owner only')
    const short = join(dir, 'short.key')
    await writeFile(short, 'ab'.repeat(16), { mode: 0o600 })
    await expect(loadStateKey(short, 'production')).rejects.toThrow('at least 32 bytes')
  })
})
