import { glob, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, extractTokens } from 'cn/build'
import { createCn } from 'cn/config'
import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import config from '@/lib/cn-config'
import { appCnTablesOptions } from '../../scripts/generate-cn-tables.ts'

// The repository root: vitest runs from it.
const root = process.cwd()

describe("the app's compiled class merge tables", () => {
  it('are up to date (run `npm run cn:generate` after changing src/app/lib/cn-config.ts)', async () => {
    const out = await mkdtemp(join(tmpdir(), 'cn-tables-app-'))
    try {
      const { source } = await build({
        ...appCnTablesOptions,
        cwd: root,
        out: join(out, 'cn-tables.gen.ts'),
      })
      expect(await readFile(join(root, 'src/app/lib/cn-tables.gen.ts'), 'utf8')).toBe(source)
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })

  it('merge every class the app writes as the config compiled at runtime does', async () => {
    const tokens = new Set<string>()
    for await (const file of glob('src/app/**/*.{ts,tsx}', { cwd: root }))
      extractTokens(await readFile(join(root, file), 'utf8'), tokens)
    const runtime = createCn(config)
    const sorted = [...tokens].sort()
    expect(sorted.length).toBeGreaterThan(500)
    for (let i = 1; i < sorted.length; i++)
      expect(cn(sorted[i - 1], sorted[i])).toBe(runtime(sorted[i - 1], sorted[i]))
    expect(cn(...sorted)).toBe(runtime(...sorted))
    expect(cn(...sorted.toReversed())).toBe(runtime(...sorted.toReversed()))
  }, 60_000)

  it("know the app's named tokens: one of a kind gives way, a size and a colour stay together", () => {
    expect(cn('z-raised', 'z-overlay')).toBe('z-overlay')
    expect(cn('text-sm', 'text-dense')).toBe('text-dense')
    expect(cn('text-muted-foreground', 'text-dense')).toBe('text-muted-foreground text-dense')
    expect(cn('rounded-md', 'rounded-tile')).toBe('rounded-tile')
    expect(cn('shadow-sm', 'shadow-hairline')).toBe('shadow-hairline')
    expect(cn('max-h-96', 'max-h-bottom-sheet')).toBe('max-h-bottom-sheet')
  })
})
