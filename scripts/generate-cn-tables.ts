// Writes src/web/lib/cn-tables.gen.ts, the class merge tables compiled from src/web/lib/cn-config.ts.
// Every class group is kept (no subsetting to the scanned sources), and no stylesheet is read, so
// the tables merge exactly as `createCn(config)` from cn/config would at runtime.
// tests/unit/cn-tables.test.ts fails when the file is out of date. Run `npm run cn:generate`.
import { fileURLToPath } from 'node:url'
import { build } from 'cn/build'

/** The build options, with paths relative to the repository root. */
export const cnTablesOptions = {
  config: 'src/web/lib/cn-config.ts',
  full: true,
  css: false,
} as const

if (import.meta.main) {
  const out = 'src/web/lib/cn-tables.gen.ts'
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const result = await build({ ...cnTablesOptions, cwd, out })
  console.log(`${result.changed ? 'wrote' : 'unchanged'} ${out}`)
}
