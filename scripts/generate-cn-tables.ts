// Writes the class merge tables the web app ships, compiled from its cn-config.ts (src/app/lib).
// Every class group is kept (no subsetting to the scanned sources), and no stylesheet is read, so
// the tables merge exactly as `createCn(config)` from cn/config would at runtime.
// tests/app/cn-tables.test.ts fails when the file is out of date. Run `npm run cn:generate`.
import { fileURLToPath } from 'node:url'
import { build } from 'cn/build'

/** The build options of the web app (src/app), with paths relative to the repository root. */
export const appCnTablesOptions = {
  config: 'src/app/lib/cn-config.ts',
  full: true,
  css: false,
} as const

if (import.meta.main) {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const out = 'src/app/lib/cn-tables.gen.ts'
  const result = await build({ ...appCnTablesOptions, cwd, out })
  console.log(`${result.changed ? 'wrote' : 'unchanged'} ${out}`)
}
