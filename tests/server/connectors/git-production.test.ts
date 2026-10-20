import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitHost } from './git-server.ts'

/*
  In production the service reads repositories on public addresses only, so an administrator
  cannot make it reach this machine or a private network (server-side request forgery): an
  address that names one is refused with the settings, and a name that resolves to one is
  refused before git runs. Development and tests keep this machine for a local Git host.
*/

vi.mock('node:dns/promises', () => ({
  lookup: (host: string) =>
    host === 'git.public.example'
      ? Promise.resolve([{ address: '93.184.216.34', family: 4 }])
      : host === 'git.internal.example'
        ? Promise.resolve([{ address: '10.0.0.5', family: 4 }])
        : host === 'git.mixed.example'
          ? Promise.resolve([
              { address: '93.184.216.34', family: 4 },
              { address: 'fd00::1', family: 6 },
            ])
          : Promise.reject(new Error('ENOTFOUND')),
}))

const { GitFetchError, isFetchableAddress, isPublicIp, withGitCheckout } =
  await import('../../../src/server/modules/connectors/git.ts')

const problem = (repository: string) =>
  withGitCheckout({ repository, ref: 'main', folder: '' }, () => Promise.resolve(null)).then(
    () => null,
    (error: unknown) => (error instanceof GitFetchError ? error.problem : error),
  )

const nodeEnv = process.env.NODE_ENV
beforeEach(() => {
  process.env.NODE_ENV = 'production'
})
afterEach(() => {
  process.env.NODE_ENV = nodeEnv
})

describe('fetching in production', () => {
  it('knows the addresses that are not on the public internet', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd12::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      expect(isPublicIp(ip), ip).toBe(false)
    for (const ip of ['93.184.216.34', '140.82.121.3', '2606:4700::1111'])
      expect(isPublicIp(ip), ip).toBe(true)
  })

  it('refuses this machine, private networks and plain http in the settings', () => {
    for (const address of [
      'http://127.0.0.1:8080/a.git',
      'http://localhost/a.git',
      'https://localhost/a.git',
      'https://127.0.0.1/a.git',
      'https://10.0.0.5/a.git',
      'https://169.254.169.254/latest',
      'https://[::1]/a.git',
      'https://git.localhost/a.git',
    ])
      expect(isFetchableAddress(address), address).toBe(false)
    expect(isFetchableAddress('https://git.example.com/a.git')).toBe(true)
    expect(isFetchableAddress('https://93.184.216.34/a.git')).toBe(true)
  })

  it('refuses a name that leads to a private network before git runs', async () => {
    expect(await problem('https://127.0.0.1/a.git')).toBe('private_address')
    expect(await problem('https://git.internal.example/a.git')).toBe('private_address')
    // One private answer among public ones is enough to refuse.
    expect(await problem('https://git.mixed.example/a.git')).toBe('private_address')
    expect(await problem('https://git.nowhere.example/a.git')).toBe('unreachable')
  })

  it('lets development and tests reach this machine', () => {
    process.env.NODE_ENV = 'test'
    expect(isFetchableAddress('http://127.0.0.1:8080/a.git')).toBe(true)
    expect(isFetchableAddress('https://10.0.0.5/a.git')).toBe(true)
    expect(isFetchableAddress('http://10.0.0.5/a.git')).toBe(false)
  })
})

describe('addresses that lead somewhere else', () => {
  it('knows the prefixes that carry an IPv4 address, and the documentation networks', () => {
    for (const ip of [
      '2002:7f00:1::1',
      '2001:0:4136:e378::1',
      '64:ff9b::7f00:1',
      '2001:db8::1',
      '192.0.2.1',
      '198.51.100.7',
      '203.0.113.9',
    ])
      expect(isPublicIp(ip), ip).toBe(false)
  })

  it('reads one host from an address, as git does: no backslash, space or control character', () => {
    for (const address of [
      'https://git.example.com\\@127.0.0.1/a.git',
      'https://git.example.com /a.git',
      'https://git.example.com/a.git\n',
      'https://localhost./a.git',
      'https://LOCALHOST/a.git',
      'https://2130706433/a.git',
      'https://0x7f.1/a.git',
    ])
      expect(isFetchableAddress(address), JSON.stringify(address)).toBe(false)
  })
})

describe('git connects to the address that was checked', () => {
  it('pins the name to the public address it resolved to, so git cannot be told another', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'heed-fake-git-'))
    const log = join(bin, 'calls.jsonl')
    await writeFile(
      join(bin, 'git'),
      `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.env) + '\\n')\nprocess.stderr.write('fatal: Authentication failed\\n'); process.exit(128)\n`,
    )
    await chmod(join(bin, 'git'), 0o755)
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path}`
    try {
      expect(await problem('https://git.public.example/a.git')).toBe('unauthorized')
      const env = JSON.parse((await readFile(log, 'utf8')).split('\n')[0]!) as Record<
        string,
        string
      >
      const pinned = Object.entries(env).find(([, value]) => value === 'http.curloptResolve')
      expect(pinned).toBeDefined()
      expect(env[pinned![0].replace('KEY', 'VALUE')]).toBe('git.public.example:443:93.184.216.34')
    } finally {
      process.env.PATH = path
      await rm(bin, { recursive: true, force: true })
    }
  })

  it('relies on a git that takes the pinned address over its own lookup', async () => {
    // A name nothing resolves, pinned to this machine's Git host: git reaches it only by the pin.
    process.env.NODE_ENV = 'test'
    const host = await gitHost({ token: null })
    try {
      await host.repository('pinned', { 'README.md': '# pinned' })
      const port = new URL(host.address('pinned')).port
      const { stdout } = await promisify(execFile)(
        'git',
        [
          '-c',
          `http.curloptResolve=git.pinned.invalid:${port}:127.0.0.1`,
          'ls-remote',
          `http://git.pinned.invalid:${port}/pinned.git`,
        ],
        { env: { PATH: process.env.PATH, HOME: tmpdir(), GIT_TERMINAL_PROMPT: '0' } },
      )
      expect(stdout).toMatch(/refs\/heads\/main/)
    } finally {
      await host.close()
    }
  }, 30_000)
})
