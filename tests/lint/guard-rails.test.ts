import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

/**
 * The guard rails are only worth having if they fail loudly. These tests lint deliberately wrong
 * code and CSS, and expect clear messages; tests/lint/app-guard-rails.test.ts does the same for the
 * web app's components. If you loosen a rule in eslint.config.js or stylelint.config.js, a test
 * here fails first.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
// The fixtures are ignored by `npm run lint`; `ignore: false` lints them on purpose here.
const eslint = new ESLint({ cwd: root, ignore: false })

async function messagesFor(file: string) {
  const [result] = await eslint.lintFiles([file])
  return result?.messages ?? []
}

describe('ESLint guard rail for model calls', () => {
  it('refuses a string model, which would route through an AI gateway', async () => {
    const messages = await messagesFor('tests/lint/fixtures/string-model.ts')
    expect(messages.map((message) => message.message)).toContainEqual(
      expect.stringContaining('explicit model object from the model port'),
    )
  })
})

describe('Stylelint guard rails (hand written CSS)', () => {
  const lint = async (code: string, codeFilename = 'src/app/styles/example.css') => {
    const result = await stylelint.lint({
      code,
      codeFilename: `${root}${codeFilename}`,
      configBasedir: root,
    })
    return (
      result.results[0]?.warnings
        .filter((warning) => warning.rule === 'scale-unlimited/declaration-strict-value')
        .map((warning) => warning.text) ?? []
    )
  }

  it('rejects hard-coded colour, spacing and radius', async () => {
    const warnings = await lint(
      '.card {\n  padding: 13px;\n  color: #ff0000;\n  border-radius: 7px;\n}\n',
    )
    expect(warnings.some((text) => text.includes('padding'))).toBe(true)
    expect(warnings.some((text) => text.includes('color'))).toBe(true)
    expect(warnings.some((text) => text.includes('border-radius'))).toBe(true)
    expect(warnings.every((text) => text.includes('Use a token'))).toBe(true)
  })

  it('accepts values that come from tokens', async () => {
    expect(
      await lint(
        '.card {\n  padding: var(--spacing-4);\n  color: var(--foreground);\n  margin: 0;\n}\n',
      ),
    ).toEqual([])
  })
})
