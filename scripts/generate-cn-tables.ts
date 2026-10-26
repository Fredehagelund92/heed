// Writes the class merge tables each web app ships, compiled from its cn-config.ts: the old front
// end's (src/web/lib) and the new app's (src/app/lib). Every class group is kept (no subsetting to
// the scanned sources), and no stylesheet is read, so the tables merge exactly as
// `createCn(config)` from cn/config would at runtime. tests/unit/cn-tables.test.ts and
// tests/app/cn-tables.test.ts fail when a file is out of date. Run `npm run cn:generate`.
import { fileURLToPath } from 'node:url'
import { build } from 'cn/build'

/** The build options of the old front end, with paths relative to the repository root. */
export const cnTablesOptions = {
  config: 'src/web/lib/cn-config.ts',
  full: true,
  css: false,
} as const

/** The build options of the new app (src/app), with paths relative to the repository root. */
export const appCnTablesOptions = {
  ...cnTablesOptions,
  config: 'src/app/lib/cn-config.ts',
} as const

if (import.meta.main) {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  for (const [options, out] of [
    [cnTablesOptions, 'src/web/lib/cn-tables.gen.ts'],
    [appCnTablesOptions, 'src/app/lib/cn-tables.gen.ts'],
  ] as const) {
    const result = await build({ ...options, cwd, out })
    console.log(`${result.changed ? 'wrote' : 'unchanged'} ${out}`)
  }
}
