import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

/**
 * The guard rails are only worth having if they fail loudly. These tests lint a deliberately
 * wrong component and deliberately wrong CSS, and expect clear messages. If you loosen a rule
 * in eslint.config.js or stylelint.config.js, a test here fails first.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
// The fixtures are ignored by `npm run lint`; `ignore: false` lints them on purpose here.
const eslint = new ESLint({ cwd: root, ignore: false })

async function messagesFor(file: string) {
  const [result] = await eslint.lintFiles([file])
  return result?.messages ?? []
}

describe('ESLint guard rails (Tailwind and imports)', () => {
  it('reports a component that breaks the rules, with a message that says what to do', async () => {
    const messages = await messagesFor('tests/lint/fixtures/bad-classes.tsx')
    const text = messages.map((message) => message.message)

    // off-scale spacing and margins (contract 3.3)
    expect(text).toContainEqual(expect.stringContaining('Off-scale spacing "p-7"'))
    expect(text).toContainEqual(expect.stringContaining('Margin "mt-2.5"'))
    // arbitrary values
    expect(text).toContainEqual(expect.stringContaining('Arbitrary value "w-[13px]"'))
    expect(text).toContainEqual(expect.stringContaining('Arbitrary value "text-[#fff]"'))
    // raw colour and important
    expect(text).toContainEqual(expect.stringContaining('Raw palette colour "bg-red-500"'))
    expect(text).toContainEqual(expect.stringContaining('Do not use !important'))
    // type roles, layers, container variants and the gutter
    expect(text).toContainEqual(expect.stringContaining('Default text size "text-sm"'))
    expect(text).toContainEqual(expect.stringContaining('Numeric layer "z-50"'))
    expect(text).toContainEqual(expect.stringContaining('Viewport variant "md:"'))
    expect(text).toContainEqual(expect.stringContaining('The page gutter "px-gutter"'))
    // classes tokens.css does not define are unknown (Tailwind's text-sm is removed)
    expect(
      messages.some((message) => message.ruleId === 'better-tailwindcss/no-unknown-classes'),
    ).toBe(true)
    // inline style for spacing, a second icon entry point and a second component base
    expect(text).toContainEqual(expect.stringContaining('Spacing and colour come from tokens'))
    expect(text).toContainEqual(expect.stringContaining('Import icons from "@/components/icons"'))
    expect(text).toContainEqual(expect.stringContaining('Base UI'))
  })

  it('lets shared controls own phone targets while features keep container rules', async () => {
    const source =
      'export function Sample() { return <button className="max-md:min-h-control-touch">Save</button> }'
    const [control] = await eslint.lintText(source, {
      filePath: 'src/web/components/ui/button.tsx',
    })
    const [feature] = await eslint.lintText(source, {
      filePath: 'src/web/components/library/item-list.tsx',
    })
    if (!control || !feature) throw new Error('ESLint did not return both results')
    const viewport = (messages: typeof control.messages) =>
      messages.filter((message) => message.message.includes('Viewport variant'))
    expect(viewport(control.messages)).toEqual([])
    expect(viewport(feature.messages)).toHaveLength(1)
  })

  it('accepts a component built from tokens only', async () => {
    const messages = await messagesFor('tests/lint/fixtures/good-classes.tsx')
    expect(messages.map((message) => `${message.ruleId}: ${message.message}`)).toEqual([])
  })
})

describe('ESLint guard rail for model calls', () => {
  it('refuses a string model, which would route through an AI gateway', async () => {
    const messages = await messagesFor('tests/lint/fixtures/string-model.ts')
    expect(messages.map((message) => message.message)).toContainEqual(
      expect.stringContaining('explicit model object from the model port'),
    )
  })
})

describe('Stylelint guard rails (hand written CSS)', () => {
  const lint = async (code: string, codeFilename = 'src/web/styles/example.css') => {
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

  it('lets tokens.css define raw values', async () => {
    expect(
      await lint(
        ':root {\n  --brand: #123456;\n  color: #123456;\n}\n',
        'src/web/styles/tokens.css',
      ),
    ).toEqual([])
  })
})
