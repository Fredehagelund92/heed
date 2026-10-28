/** Which C library a Linux machine runs: Cube's worker asks at import (src/connectors/cube/libc.ts). */
export type Libc = 'gnu' | 'musl'

/** This machine's C library: glibc names its version in the process report, musl does not. */
export function hostLibc(): Libc {
  const header = (process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
    .header
  return header?.glibcVersionRuntime ? 'gnu' : 'musl'
}
