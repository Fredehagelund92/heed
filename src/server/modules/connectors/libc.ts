import type { SpawnSyncReturns } from 'node:child_process'

/**
 * Which C library this Linux machine runs, as Cube asks at import (`getconf GNU_LIBC_VERSION`,
 * then `ldd --version`, in @cubejs-backend/shared's platform.js) to pick its native build. The
 * service answers it before the compiler process starts, so that process never starts another
 * program: a process it started would not be held by Node's permission model.
 */
export type Libc = 'gnu' | 'musl'

/** This machine's C library: glibc names its version in the process report, musl does not. */
export function hostLibc(): Libc {
  const header = (process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
    .header
  return header?.glibcVersionRuntime ? 'gnu' : 'musl'
}

/**
 * Stands in for `child_process.spawnSync` in the compiler process: it answers Cube's two libc
 * questions from what the service found, and refuses anything else without running it.
 */
export function libcAnswers(libc: Libc) {
  return (command: string, args: readonly string[] = []): SpawnSyncReturns<string> => {
    const answer = (status: number, stdout = ''): SpawnSyncReturns<string> => ({
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
