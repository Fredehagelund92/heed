import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * The product's name is written once (docs/rename-checklist.md). The rule brand/no-product-name
 * (eslint.product-name.js) is the guard, so it has to fail loudly. The fixtures under
 * tests/lint/fixtures are ordinary files the rule is enabled for.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const eslint = new ESLint({ cwd: root, ignore: false })

async function reported(fixture: string) {
  const [result] = await eslint.lintFiles([`tests/lint/fixtures/${fixture}`])
  return (result?.messages ?? []).map((m) => `${m.line}: ${m.ruleId}`)
}

describe('brand/no-product-name', () => {
  it('reports a name written by hand in a string and in template text, and accepts the rest', async () => {
    expect(await reported('product-name.ts')).toEqual([
      '1: brand/no-product-name',
      '2: brand/no-product-name',
    ])
  })

  it('reports a name written by hand in JSX text', async () => {
    expect(await reported('product-name-jsx.tsx')).toEqual(['1: brand/no-product-name'])
  })
})
