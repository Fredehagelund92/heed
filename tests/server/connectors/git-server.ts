import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const git = (cwd: string, ...args: string[]) =>
  run('git', ['-c', 'user.name=Heed test', '-c', 'user.email=test@example.test', ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1' },
  })

/**
 * A Git host on this machine for tests: `git http-backend` behind a small HTTP server that wants
 * one token (sent as Basic credentials, any user name) and records every Authorization header
 * and address it was sent, so a test can prove where the token travelled.
 */
export async function gitHost({ token }: { token: string | null }) {
  const root = await mkdtemp(join(tmpdir(), 'heed-git-host-'))
  const backend = join((await run('git', ['--exec-path'])).stdout.trim(), 'git-http-backend')
  const requests: { url: string; authorization: string | null }[] = []

  const serve = (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const authorization = request.headers.authorization ?? null
    requests.push({ url: request.url ?? '', authorization })
    if (token !== null) {
      const password = authorization?.startsWith('Basic ')
        ? Buffer.from(authorization.slice(6), 'base64').toString().split(':').slice(1).join(':')
        : null
      if (password !== token) {
        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' })
        response.end()
        return
      }
    }
    const cgi = spawn(backend, [], {
      env: {
        PATH: process.env.PATH,
        HOME: root,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? 'GET',
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
        HTTP_GIT_PROTOCOL: (request.headers['git-protocol'] as string | undefined) ?? '',
        REMOTE_USER: 'heed',
        REMOTE_ADDR: '127.0.0.1',
      },
    })
    request.pipe(cgi.stdin)
    let head = Buffer.alloc(0)
    let started = false
    cgi.stdout.on('data', (chunk: Buffer) => {
      if (started) {
        response.write(chunk)
        return
      }
      head = Buffer.concat([head, chunk])
      const end = head.indexOf('\r\n\r\n')
      if (end === -1) return
      let status = 200
      const headers: Record<string, string> = {}
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const colon = line.indexOf(':')
        const name = line.slice(0, colon).trim()
        const value = line.slice(colon + 1).trim()
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10)
        else headers[name] = value
      }
      response.writeHead(status, headers)
      started = true
      response.write(head.subarray(end + 4))
    })
    cgi.stdout.on('end', () => response.end())
  }
  const server = createServer(serve)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    /** The address of a repository on this host. */
    address: (name: string) => `http://127.0.0.1:${port}/${name}.git`,
    requests,
    /** Creates a repository with these files (path to text) in one commit; returns the commit. */
    async repository(
      name: string,
      files: Record<string, string>,
      branch = 'main',
      links: Record<string, string> = {},
    ) {
      const bare = join(root, `${name}.git`)
      await git(root, 'init', '--quiet', '--bare', bare)
      await git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
      return this.commit(name, files, branch, links)
    },
    /** One more commit on a branch of a repository, replacing its files; links are symbolic. */
    async commit(
      name: string,
      files: Record<string, string>,
      branch = 'main',
      links: Record<string, string> = {},
    ) {
      const work = await mkdtemp(join(tmpdir(), 'heed-git-work-'))
      try {
        await git(work, 'init', '--quiet', '-b', branch)
        for (const [path, text] of Object.entries(files)) {
          await mkdir(dirname(join(work, path)), { recursive: true })
          await writeFile(join(work, path), text)
        }
        for (const [path, target] of Object.entries(links)) await symlink(target, join(work, path))
        await git(work, 'add', '--all')
        await git(work, 'commit', '--quiet', '-m', 'model')
        await git(
          work,
          'push',
          '--quiet',
          '--force',
          join(root, `${name}.git`),
          `HEAD:refs/heads/${branch}`,
        )
        return (await git(work, 'rev-parse', 'HEAD')).stdout.trim()
      } finally {
        await rm(work, { recursive: true, force: true })
      }
    },
    /** Tags the newest commit of a branch. */
    async tag(name: string, tag: string, branch = 'main') {
      await git(join(root, `${name}.git`), 'tag', tag, branch)
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    },
  }
}
export type GitHost = Awaited<ReturnType<typeof gitHost>>
