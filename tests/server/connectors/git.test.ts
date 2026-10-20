import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  folderParts,
  GitFetchError,
  isFetchableAddress,
  isSafeRef,
  withGitCheckout,
} from '../../../src/server/modules/connectors/git.ts'
import {
  createCubeGitSource,
  type CubeGitSourceOptions,
} from '../../../src/server/modules/connectors/index.ts'
import { SourceReadError } from '../../../src/server/modules/connectors/types.ts'
import { gitHost, type GitHost } from './git-server.ts'

/*
  A Cube model in a Git repository (CON-502), read from a real Git host on this machine that
  wants a token: the source fetches one commit, reads its model folder, and forgets it. Every
  failure says why with a code, and the token goes nowhere but the Authorization header.
*/

const TOKEN = 'heed-test-token-5f2c9a71'
/**
 * Each test runs real git processes against a real host, several reads apiece. On a busy machine
 * (other checkouts testing beside this one) three reads have taken longer than 30 seconds, and a
 * read that outlives its test then lands its requests in the next one.
 */
const GIT_TIMEOUT = 90_000
const fixture = fileURLToPath(new URL('../../fixtures/cube/model.yml', import.meta.url))
let host: GitHost
let model: string
let first: string

beforeAll(async () => {
  host = await gitHost({ token: TOKEN })
  model = await readFile(fixture, 'utf8')
  first = await host.repository('analytics', { 'cube/model/model.yml': model, 'README.md': '# x' })
  await host.tag('analytics', 'v1')
})
afterAll(() => host.close())

const source = (options: Partial<CubeGitSourceOptions> = {}) =>
  createCubeGitSource({
    id: 'analytics',
    name: 'Analytics',
    repository: host.address('analytics'),
    ref: 'main',
    folder: 'cube/model',
    token: TOKEN,
    ...options,
  })

async function failure(read: Promise<unknown>) {
  const error = await read.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(SourceReadError)
  // Nothing the source says when it fails holds the token.
  expect(JSON.stringify({ error, message: (error as Error).message })).not.toContain(TOKEN)
  return (error as SourceReadError).warnings
}

describe('a Cube model in a Git repository', () => {
  it(
    'reads the model folder at a branch, a tag and a commit, versioned by the commit',
    async () => {
      const snapshot = await source().read()
      expect(snapshot.complete).toBe(true)
      expect(snapshot.definitions).toHaveLength(7)
      expect(snapshot.sourceVersion).toBe(first)
      expect(snapshot.cursor).toBe(first)
      expect(new Set(snapshot.definitions.map((definition) => definition.modelFile))).toEqual(
        new Set(['model.yml']),
      )
      expect((await source({ ref: 'v1' }).read()).sourceVersion).toBe(first)
      expect((await source({ ref: first }).read()).sourceVersion).toBe(first)
    },
    GIT_TIMEOUT,
  )

  it(
    'sends the token as the Authorization header only, never in an address',
    async () => {
      host.requests.length = 0
      await source({ username: 'reader' }).read()
      expect(host.requests.length).toBeGreaterThan(0)
      for (const request of host.requests) {
        expect(request.url).not.toContain(TOKEN)
        expect(request.authorization).toBe(
          `Basic ${Buffer.from(`reader:${TOKEN}`).toString('base64')}`,
        )
      }
    },
    GIT_TIMEOUT,
  )

  it(
    'gives each domain the model names the Heed domain the domain names map to',
    async () => {
      const snapshot = await source({ domainAliases: { marketing: 'paid_media' } }).read()
      const domain = (ref: string) => snapshot.definitions.find((d) => d.ref === ref)?.areaHint
      expect(domain('cube:growth.revenue')).toBe('paid_media')
      expect(domain('cube:sales.revenue')).toBe('finance')
      // A name the map leaves out stays as the model says it.
      expect(domain('cube:sales.count')).toBe('commerce')
    },
    GIT_TIMEOUT,
  )

  it(
    'reads a newer commit after the branch moves',
    async () => {
      const second = await host.commit('analytics', {
        'cube/model/model.yml': model.replace('Total order revenue.', 'All revenue.'),
      })
      const snapshot = await source().read({ cursor: first })
      expect(snapshot.sourceVersion).toBe(second)
      expect(
        snapshot.definitions.find((d) => d.ref === 'cube:sales.revenue')?.descriptionCopy,
      ).toBe('All revenue.')
    },
    GIT_TIMEOUT,
  )

  it(
    'says the token was refused, or missing, without the token',
    async () => {
      expect(await failure(source({ token: 'not-the-token' }).read())).toEqual([
        { code: 'unauthorized', target: host.address('analytics') },
      ])
      expect(await failure(source({ token: null }).read())).toEqual([
        { code: 'unauthorized', target: host.address('analytics') },
      ])
      // The store no longer holds the source's token.
      expect(await failure(source({ token: undefined }).read())).toEqual([
        { code: 'secret_missing', target: 'token' },
      ])
    },
    GIT_TIMEOUT,
  )

  it(
    'says when the repository, the ref or the folder is not there',
    async () => {
      expect(await failure(source({ repository: host.address('nothing') }).read())).toEqual([
        { code: 'not_found', target: host.address('nothing') },
      ])
      expect(await failure(source({ ref: 'no-such-branch' }).read())).toEqual([
        { code: 'ref_not_found', target: 'no-such-branch' },
      ])
      expect(await failure(source({ folder: 'model' }).read())).toEqual([
        { code: 'folder_missing', target: 'model' },
      ])
      expect(await failure(source({ folder: '../outside' }).read())).toEqual([
        { code: 'folder_missing', target: '../outside' },
      ])
    },
    GIT_TIMEOUT,
  )

  it(
    'checks a link out as a plain file, so a folder cannot lead out of the repository',
    async () => {
      await host.repository('linked', { 'README.md': '# linked' }, 'main', { cube: '/etc' })
      expect(
        await failure(source({ repository: host.address('linked'), folder: 'cube' }).read()),
      ).toEqual([{ code: 'folder_missing', target: 'cube' }])
    },
    GIT_TIMEOUT,
  )

  it(
    'says the host could not be reached, also when it never answers',
    async () => {
      const quiet = createServer(() => {})
      await new Promise<void>((resolve) => quiet.listen(0, '127.0.0.1', resolve))
      const { port } = quiet.address() as AddressInfo
      try {
        expect(
          await failure(
            source({ repository: `http://127.0.0.1:${port}/x.git`, fetchTimeoutMs: 1_000 }).read(),
          ),
        ).toEqual([{ code: 'unreachable', target: `http://127.0.0.1:${port}/x.git` }])
      } finally {
        quiet.closeAllConnections()
        quiet.close()
      }
      expect(await failure(source({ repository: 'http://127.0.0.1:9/x.git' }).read())).toEqual([
        { code: 'unreachable', target: 'http://127.0.0.1:9/x.git' },
      ])
    },
    GIT_TIMEOUT,
  )
})

describe('fetching from Git', () => {
  it('takes https, or plain http to this machine only, and never credentials in the address', () => {
    expect(isFetchableAddress('https://git.example.com/a/b.git')).toBe(true)
    expect(isFetchableAddress('http://127.0.0.1:8080/a.git')).toBe(true)
    expect(isFetchableAddress('http://localhost/a.git')).toBe(true)
    expect(isFetchableAddress('http://git.example.com/a.git')).toBe(false)
    expect(isFetchableAddress('https://user:secret@git.example.com/a.git')).toBe(false)
    expect(isFetchableAddress('https://git.example.com/a.git?token=x')).toBe(false)
    expect(isFetchableAddress('ssh://git@git.example.com/a.git')).toBe(false)
    expect(isFetchableAddress('file:///srv/repo')).toBe(false)
    expect(isFetchableAddress('ext::sh -c touch% /tmp/x')).toBe(false)
  })

  it('takes a ref git cannot read as an option or a range', () => {
    expect(isSafeRef('main')).toBe(true)
    expect(isSafeRef('release/2026-10')).toBe(true)
    expect(isSafeRef('v1.2.3')).toBe(true)
    expect(isSafeRef('-c')).toBe(false)
    expect(isSafeRef('--upload-pack=touch')).toBe(false)
    expect(isSafeRef('main..dev')).toBe(false)
    expect(isSafeRef('a b')).toBe(false)
    expect(isSafeRef('refs/heads/x.lock')).toBe(false)
  })

  it('takes a folder inside the repository only', () => {
    expect(folderParts('')).toEqual([])
    expect(folderParts('cube/model')).toEqual(['cube', 'model'])
    expect(folderParts('/cube/model/')).toEqual(['cube', 'model'])
    expect(folderParts('../etc')).toBeNull()
    expect(folderParts('a/../../b')).toBeNull()
    expect(folderParts('.git/hooks')).toBeNull()
  })

  it('passes the token to git in its environment, never in its arguments', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'heed-fake-git-'))
    const log = join(bin, 'calls.jsonl')
    await writeFile(
      join(bin, 'git'),
      `#!/usr/bin/env node\nconst fs = require('node:fs')\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }) + '\\n')\nif (process.argv.includes('fetch')) { process.stderr.write('fatal: Authentication failed\\n'); process.exit(128) }\n`,
    )
    await chmod(join(bin, 'git'), 0o755)
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path}`
    try {
      const error = await withGitCheckout(
        { repository: 'https://git.example.com/a.git', ref: 'main', folder: '', token: TOKEN },
        () => Promise.resolve(null),
      ).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(GitFetchError)
      expect((error as GitFetchError).problem).toBe('unauthorized')
      const calls = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { argv: string[]; env: Record<string, string> })
      expect(calls.length).toBeGreaterThanOrEqual(2)
      for (const call of calls) {
        expect(call.argv.join(' ')).not.toContain(TOKEN)
        expect(call.argv.join(' ')).not.toContain(
          Buffer.from(`x-access-token:${TOKEN}`).toString('base64'),
        )
        // Nothing of the server's own environment reaches git.
        expect(Object.keys(call.env).filter((key) => /DATABASE|SECRET|KEY_FILE/.test(key))).toEqual(
          [],
        )
      }
      const fetch = calls.find((call) => call.argv.includes('fetch'))!
      const values = Object.entries(fetch.env)
        .filter(([key]) => key.startsWith('GIT_CONFIG_VALUE_'))
        .map(([, value]) => value)
      expect(values).toContain(
        `Authorization: Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`,
      )
      expect(fetch.env.GIT_TERMINAL_PROMPT).toBe('0')
    } finally {
      process.env.PATH = path
      await rm(bin, { recursive: true, force: true })
    }
  })
})
