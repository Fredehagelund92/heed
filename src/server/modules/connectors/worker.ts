import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SourceError } from '../../../domain/connector-runtime.ts'
import { hostLibc, type Libc } from './libc.ts'

/*
  `ctx.worker` (T1, docs/connectors/security.md "Where connector code runs"): a built-in
  connector hands its risky parsing, such as Cube's compiler, to a worker module of its own
  folder, and the core runs that module in a child process of its own for one piece of work. The
  process runs under Node's permission model: no network, no writes, no programs, and it reads
  only the service's code, its dependencies and the package file, never the repository's other
  files (its local keys and settings), the secret store or a home folder. It gets the input over
  IPC, so it reads no folder of the tool either, and no secret from the environment. Its one
  answer is untrusted data: the connector checks it, and the core checks every message again.

  Node calls its permission model a seat belt, not a sandbox: this is failure isolation for
  reviewed code. A crash, a native abort or a runaway heap ends the child, never the service.
*/

/**
 * How long a worker may take, and how much memory it may use, unless the server sets them
 * (CUBE_COMPILE_TIMEOUT_SECONDS, CUBE_COMPILE_MEMORY_MB). A Cube model of 10,000 members compiles
 * in about 45 seconds, and a busy computer takes longer, so the defaults leave room.
 */
export const WORKER_TIMEOUT_MS = 120_000
export const WORKER_MEMORY_MB = 1024

export interface WorkerLimits {
  timeoutMs: number
  memoryMb: number
}

/** The limits a worker runs with: the server's, or the defaults; refused when they make no sense. */
export function workerLimits(given: Partial<WorkerLimits> = {}): WorkerLimits {
  const limits = {
    timeoutMs: given.timeoutMs ?? WORKER_TIMEOUT_MS,
    memoryMb: given.memoryMb ?? WORKER_MEMORY_MB,
  }
  if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1)
    throw new Error('Invalid worker timeout')
  if (!Number.isSafeInteger(limits.memoryMb) || limits.memoryMb < 16)
    throw new Error('Invalid worker memory limit')
  return limits
}

/** What the machine a worker runs on is, for code that asks at import (Cube asks for the libc). */
export interface WorkerHost {
  platform: NodeJS.Platform
  libc?: Libc
}

/** The one message a worker gets: where it runs, and its input. */
export interface WorkerRequest {
  host: WorkerHost
  input: unknown
}

/**
 * What a worker process may read, and nothing else: the service's source (its own module and
 * the domain it imports), the dependencies and the project's package file.
 */
export function workerReadablePaths(): string[] {
  const source = fileURLToPath(new URL('../../../', import.meta.url))
  const dependency = createRequire(import.meta.url).resolve('zod')
  const modules = dependency.slice(0, dependency.lastIndexOf(`${sep}node_modules${sep}`) + 14)
  const project = fileURLToPath(new URL('../../../../package.json', import.meta.url))
  return [source, modules, project].map(
    (path) => (path.endsWith(sep) ? path.slice(0, -1) : path) || dirname(path),
  )
}

const failed = (code: 'timed_out' | 'invalid_output') =>
  new SourceError({
    code,
    target: 'worker',
    class: code === 'timed_out' ? 'transient' : 'source',
  })

/**
 * Runs a worker module once: forks it under the permission model, sends it the input, and
 * resolves with its one answer. It fails with `timed_out` past the time limit or when the read
 * is stopped, and with `invalid_output` when the process ends without answering. The process
 * is killed in every case before the promise settles.
 */
export function runWorker(
  module: URL,
  input: unknown,
  { signal, limits }: { signal: AbortSignal; limits: WorkerLimits },
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    if (signal.aborted) {
      reject(failed('timed_out'))
      return
    }
    // A process of its own: Cube 1.7.39's native logger aborts on a second worker_threads load in
    // one process, and a process contains native crashes and lets Node deny network and writes.
    const child = fork(module, [], {
      execArgv: [
        `--max-old-space-size=${limits.memoryMb}`,
        '--permission',
        ...workerReadablePaths().map((path) => `--allow-fs-read=${path}`),
        // A native build, which the operating system loads outside Node's file checks.
        '--allow-addons',
        // A compiler's own transpiler threads. No child processes: writes and network stay denied.
        '--allow-worker',
      ],
      silent: true,
      env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      serialization: 'advanced',
    })
    // What a worker prints may hold what it read (SQL, a document): only its answer crosses.
    child.stdout?.resume()
    child.stderr?.resume()
    let settled = false
    const finish = (outcome: { answer: unknown } | { error: Error }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      const done = () => ('answer' in outcome ? resolve(outcome.answer) : reject(outcome.error))
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) done()
      else {
        child.once('exit', done)
        child.kill('SIGKILL')
      }
    }
    const stop = () => finish({ error: failed('timed_out') })
    const timer = setTimeout(stop, limits.timeoutMs)
    signal.addEventListener('abort', stop, { once: true })
    child.once('message', (answer: unknown) => finish({ answer }))
    child.once('error', () => finish({ error: failed('invalid_output') }))
    child.once('exit', () => finish({ error: failed('invalid_output') }))
    const request: WorkerRequest = {
      host: {
        platform: process.platform,
        ...(process.platform === 'linux' ? { libc: hostLibc() } : {}),
      },
      input,
    }
    child.send(request, (error) => {
      if (error) finish({ error: failed('invalid_output') })
    })
  })
}
