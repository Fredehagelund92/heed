import { glob, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, extractTokens } from 'cn/build'
import { createCn } from 'cn/config'
import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import config from '@/lib/cn-config'
import { cnTablesOptions } from '../../scripts/generate-cn-tables.ts'

// The repository root: vitest runs from it, and jsdom's import.meta.url is not a file URL.
const root = process.cwd()

describe('the compiled class merge tables', () => {
  it('are up to date (run `npm run cn:generate` after changing src/web/lib/cn-config.ts)', async () => {
    const out = await mkdtemp(join(tmpdir(), 'cn-tables-'))
    try {
      const { source } = await build({
        ...cnTablesOptions,
        cwd: root,
        out: join(out, 'cn-tables.gen.ts'),
      })
      expect(await readFile(join(root, 'src/web/lib/cn-tables.gen.ts'), 'utf8')).toBe(source)
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })

  it('merge every class the app writes as the config compiled at runtime does', async () => {
    const tokens = new Set<string>()
    for await (const file of glob('src/web/**/*.{ts,tsx}', { cwd: root }))
      extractTokens(await readFile(join(root, file), 'utf8'), tokens)
    const runtime = createCn(config)
    // Sorted, a utility sits beside the others of its family, so each pair puts likely conflicts
    // side by side; the whole list in both orders covers the rest.
    const sorted = [...tokens].sort()
    expect(sorted.length).toBeGreaterThan(500)
    for (let i = 1; i < sorted.length; i++)
      expect(cn(sorted[i - 1], sorted[i])).toBe(runtime(sorted[i - 1], sorted[i]))
    expect(cn(...sorted)).toBe(runtime(...sorted))
    expect(cn(...sorted.toReversed())).toBe(runtime(...sorted.toReversed()))
    // It reads every source file and merges thousands of pairs: on a busy machine that takes
    // longer than the default five seconds.
  }, 60_000)
})
