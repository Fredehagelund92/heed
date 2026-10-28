import type { spawnSync as SpawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { libcAnswers } from '../../../src/connectors/cube/libc.ts'

/*
  The compiler process may not start programs, so Cube's libc probe (@cubejs-backend/shared,
  platform.js) is answered in the process. This runs Cube's own probe, as on Linux, against the
  answers: it finds the C library the service found, and anything else is refused unrun.
*/

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process') as { spawnSync: typeof SpawnSync }
const { detectLibc } = require('@cubejs-backend/shared/dist/src/platform.js') as {
  detectLibc: () => string
}
const spawnSync = childProcess.spawnSync
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  childProcess.spawnSync = spawnSync
  Object.defineProperty(process, 'platform', platform)
})

describe("answering Cube's libc question", () => {
  it.each(['gnu', 'musl'] as const)('says %s when the service found it', (libc) => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    childProcess.spawnSync = libcAnswers(libc) as unknown as typeof SpawnSync
    expect(detectLibc()).toBe(libc)
  })

  it('runs nothing else', () => {
    const result = libcAnswers('gnu')('cat', ['/etc/passwd'])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.error?.message).toMatch(/starts no other program/)
  })
})
