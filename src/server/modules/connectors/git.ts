import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { BlockList, isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

/**
 * Reads one commit of a Git repository into a folder of its own, for a connector to read and
 * then forget (CON-502). Read only toward the host (CON-102): a shallow fetch, never a push.
 *
 * The token travels as an HTTP header set through the environment of the `git` process, never
 * in its arguments (which other users may list) or in the address (which git may print). Git
 * runs with no system or global configuration, no credential helper, no prompt, no redirects
 * (so the header never reaches another host), https only (plain http to this machine only),
 * and symbolic links checked out as plain files. Its own output is read for a reason code and
 * then dropped: it never reaches a log, an error or a snapshot.
 */

/** Why a fetch failed, as a source warning code (src/contract/operations.ts). */
export type GitProblem =
  | 'private_address'
  | 'unreachable'
  | 'unauthorized'
  | 'not_found'
  | 'ref_not_found'
  | 'folder_missing'
  | 'fetch_failed'

export class GitFetchError extends Error {
  override name = 'GitFetchError'
  readonly problem: GitProblem
  constructor(problem: GitProblem) {
    super(`The repository could not be read (${problem})`)
    this.problem = problem
  }
}

export interface GitFetchOptions {
  /** An https address, or http to this machine (a local test server). Never with credentials. */
  repository: string
  /** A branch, a tag or a full commit. */
  ref: string
  /** The folder in the repository to hand over, relative; empty for the top. */
  folder: string
  /** The user name sent with the token; most hosts accept any. */
  username?: string
  token?: string
  timeoutMs?: number
}

const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Addresses that are not on the public internet: this machine, private and link-local networks. */
const notPublic = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  notPublic.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  // IPv4 mapped into IPv6 (::ffff:a.b.c.d) is checked against the IPv4 ranges above.
  ['::', 127],
  // Prefixes that carry an IPv4 address or lead to one: NAT64, Teredo and 6to4.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2001::', 32],
  ['2002::', 16],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  notPublic.addSubnet(network, prefix, 'ipv6')

/** True for an IP address on the public internet. */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 0) return false
  return !notPublic.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

/**
 * Whether Heed may fetch from this machine and private networks: in development and tests only
 * (a local Git host), never in production, where an administrator could otherwise make the
 * server reach services that are not meant to be reached from outside.
 */
export const reachesLocal = () => process.env.NODE_ENV !== 'production'

/** A URL's host as an address or a name, without IPv6 brackets or a trailing dot. */
const hostOf = (url: URL) =>
  url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()

/**
 * The address as git will be given it: the WHATWG form the checks read, so git and the checks
 * cannot read two different hosts from one string. Null for one that does not parse, or holds
 * a backslash, a space or a control character, which parsers read differently.
 */
export function canonicalAddress(address: string): string | null {
  const unclear = [...address].some((char) => {
    const code = char.charCodeAt(0)
    return char === '\\' || /\s/.test(char) || code < 0x20 || code === 0x7f
  })
  if (unclear || !URL.canParse(address)) return null
  return new URL(address).href
}

/**
 * True for an address Heed may fetch: https to a public host, without credentials, query or
 * fragment. Outside production also plain http to this machine and private addresses.
 */
export function isFetchableAddress(address: string): boolean {
  const canonical = canonicalAddress(address)
  if (canonical === null) return false
  const url = new URL(canonical)
  if (url.username || url.password || url.search || url.hash) return false
  const host = hostOf(url)
  const local =
    loopback.has(url.hostname) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    (isIP(host) !== 0 && !isPublicIp(host))
  if (local && !reachesLocal()) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname))
}

/**
 * Where git is to connect: the host's name resolved here, every answer public, and the first of
 * them pinned for git (`http.curloptResolve`), so git cannot look the name up again and be told
 * another, private, address in between (DNS rebinding). Null for an address given as an IP.
 */
async function pinnedAddress(address: string): Promise<{ resolve: string } | null> {
  const url = new URL(canonicalAddress(address)!)
  const host = hostOf(url)
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new GitFetchError('private_address')
    return null
  }
  let found: { address: string; family: number }[]
  try {
    found = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new GitFetchError('unreachable')
  }
  if (!found.length || !found.every((entry) => isPublicIp(entry.address)))
    throw new GitFetchError('private_address')
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const ip = found[0]!.family === 6 ? `[${found[0]!.address}]` : found[0]!.address
  return { resolve: `${url.hostname.replace(/\.$/, '')}:${port}:${ip}` }
}

/** A ref git cannot take for an option or a range: no leading dash, no `..`, no odd marks. */
export function isSafeRef(ref: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,200}$/.test(ref) &&
    !ref.startsWith('-') &&
    !ref.startsWith('/') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.lock') &&
    !ref.includes('..') &&
    !ref.includes('//')
  )
}

/** The folder's parts, or null when it climbs out, names `.git` or has odd characters. */
export function folderParts(folder: string): string[] | null {
  const parts = folder.split('/').filter((part) => part !== '')
  return parts.every(
    (part) =>
      /^[A-Za-z0-9._ -]{1,100}$/.test(part) && part !== '.' && part !== '..' && part !== '.git',
  ) && parts.length <= 20
    ? parts
    : null
}

function problemOf(output: string): GitProblem {
  const text = output.toLowerCase()
  if (
    /couldn't find remote ref|could not find remote ref|no such ref|not our ref|unadvertised object|invalid refspec|bad object|reference is not a tree/.test(
      text,
    )
  )
    return 'ref_not_found'
  if (
    /authentication failed|could not read username|could not read password|terminal prompts disabled|invalid username or (password|token)|returned error: 40[13]|http 40[13]|access denied|permission denied/.test(
      text,
    )
  )
    return 'unauthorized'
  if (
    /repository .*not found|not found|returned error: 404|does not appear to be a git repository/.test(
      text,
    )
  )
    return 'not_found'
  if (
    /could not resolve|failed to connect|connection refused|connection timed out|timed out|network is unreachable|ssl|tls|certificate|empty reply|connection reset|recv failure/.test(
      text,
    )
  )
    return 'unreachable'
  return 'fetch_failed'
}

/** The environment of every `git` call: nothing of the server's own, the token as a header. */
function gitEnvironment(
  home: string,
  options: GitFetchOptions,
  pinned: { resolve: string } | null,
): NodeJS.ProcessEnv {
  const http = new URL(options.repository).protocol === 'http:'
  const config: [string, string][] = [
    ...(pinned ? ([['http.curloptResolve', pinned.resolve]] as [string, string][]) : []),
    ['protocol.allow', 'never'],
    ['protocol.https.allow', 'always'],
    ...(http ? ([['protocol.http.allow', 'always']] as [string, string][]) : []),
    ['credential.helper', ''],
    ['core.symlinks', 'false'],
    ['core.hooksPath', '/dev/null'],
    ['core.askPass', ''],
    ['http.followRedirects', 'false'],
    ['init.defaultBranch', 'main'],
    ['advice.detachedHead', 'false'],
    ['gc.auto', '0'],
  ]
  if (options.token) {
    const user = options.username || 'x-access-token'
    const basic = Buffer.from(`${user}:${options.token}`).toString('base64')
    config.push(['http.extraHeader', `Authorization: Basic ${basic}`])
  }
  return {
    PATH: process.env.PATH,
    HOME: home,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: String(config.length),
    ...Object.fromEntries(
      config.flatMap(([key, value], index) => [
        [`GIT_CONFIG_KEY_${index}`, key],
        [`GIT_CONFIG_VALUE_${index}`, value],
      ]),
    ),
  }
}

/**
 * Fetches the commit `ref` names, hands `work` its folder and the commit's id, and removes it
 * all afterwards, whatever happens. A failure is a `GitFetchError` with a reason code only.
 */
export async function withGitCheckout<T>(
  options: GitFetchOptions,
  work: (folder: string, commit: string) => Promise<T>,
): Promise<T> {
  if (!isFetchableAddress(options.repository))
    throw new GitFetchError(reachesLocal() ? 'fetch_failed' : 'private_address')
  // A name that leads to a private network is refused before git runs, and git connects to the
  // very address that was checked.
  const pinned = reachesLocal() ? null : await pinnedAddress(options.repository)
  if (!isSafeRef(options.ref)) throw new GitFetchError('ref_not_found')
  const parts = folderParts(options.folder)
  if (!parts) throw new GitFetchError('folder_missing')
  const deadline = Date.now() + (options.timeoutMs ?? 60_000)
  const home = await mkdtemp(join(tmpdir(), 'heed-git-'))
  const repo = join(home, 'repo')
  const env = gitEnvironment(home, options, pinned)
  const git = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      const timeout = deadline - Date.now()
      if (timeout <= 0) {
        reject(new GitFetchError('unreachable'))
        return
      }
      execFile(
        'git',
        args,
        { cwd: home, env, timeout, killSignal: 'SIGKILL', maxBuffer: 1_000_000, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) resolve(stdout)
          else if ((error as { killed?: boolean }).killed) reject(new GitFetchError('unreachable'))
          else reject(new GitFetchError(problemOf(`${stderr}\n${error.message}`)))
        },
      )
    })
  try {
    await git(['init', '--quiet', repo])
    await git([
      '-C',
      repo,
      'fetch',
      '--quiet',
      '--depth=1',
      '--no-tags',
      '--no-recurse-submodules',
      canonicalAddress(options.repository)!,
      options.ref,
    ])
    await git(['-C', repo, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'])
    const commit = (await git(['-C', repo, 'rev-parse', 'HEAD'])).trim()
    if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new GitFetchError('fetch_failed')
    const folder = join(repo, ...parts)
    let real: string
    try {
      real = await realpath(folder)
      if (!(await stat(real)).isDirectory()) throw new Error('not a folder')
    } catch {
      throw new GitFetchError('folder_missing')
    }
    // Links are plain files here, but the folder must still be inside what was fetched.
    const root = await realpath(repo)
    if (real !== root && !real.startsWith(`${root}${sep}`))
      throw new GitFetchError('folder_missing')
    return await work(real, commit)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
