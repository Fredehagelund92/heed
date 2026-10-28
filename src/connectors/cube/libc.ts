/**
 * Which C library a Linux machine runs, as Cube asks at import (`getconf GNU_LIBC_VERSION`, then
 * `ldd --version`, in @cubejs-backend/shared's platform.js) to pick its native build. The service
 * finds it out before the worker starts (`ctx.worker`), so the worker never starts a program: a
 * process it started would not be held by Node's permission model.
 */
export type Libc = 'gnu' | 'musl'

/** What `child_process.spawnSync` returns, as far as Cube reads it. */
interface Answer {
  pid: number
  output: [null, string, string]
  stdout: string
  stderr: string
  status: number
  signal: null
  error?: Error
}

/**
 * Stands in for `child_process.spawnSync` in the worker: it answers Cube's two libc questions from
 * what the service found, and refuses anything else without running it.
 */
export function libcAnswers(libc: Libc) {
  return (command: string, args: readonly string[] = []): Answer => {
    const answer = (status: number, stdout = ''): Answer => ({
      pid: 0,
      output: [null, stdout, ''],
      stdout,
      stderr: '',
      status,
      signal: null,
    })
    if (command === 'getconf' && args[0] === 'GNU_LIBC_VERSION')
      return libc === 'gnu' ? answer(0, 'glibc\n') : answer(1)
    if (command === 'ldd' && args[0] === '--version')
      return answer(0, libc === 'musl' ? 'musl libc\n' : 'ldd (GNU libc)\n')
    return { ...answer(1), error: new Error('The compiler process starts no other program') }
  }
}
