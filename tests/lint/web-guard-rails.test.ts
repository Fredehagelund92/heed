import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

/**
 * The guard rails of the new web app (src/web), run through the repository's own eslint.config.js
 * on sample components placed at src/web paths: the class rules, the Tailwind classes the new
 * tokens define, the motion rules, the import rules, the product name and the words. The mockup's
 * copy and motion checks become these lint rules (design contract v2, section 9).
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
// src/web holds no TypeScript project yet, so the rules that read types are left out here; every
// guard rail of the new app reads the syntax alone.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
  ruleFilter: ({ ruleId }) =>
    /^(better-tailwindcss|motion|heed|brand|react-hooks)\/|^no-restricted-(imports|syntax)$/.test(
      ruleId,
    ),
})

async function lintAs(path: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath: `${root}${path}` })
  return result?.messages ?? []
}
const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/web/${name}`, import.meta.url), 'utf8')

describe('ESLint guard rails of the new app', () => {
  it('reports a component that breaks them, with a message that says what to do', async () => {
    const messages = await lintAs('src/web/pages/bad.tsx', fixture('bad-component.tsx'))
    const text = messages.map((message) => message.message)
    const expected = [
      // class rules (contract 2)
      'Numeric layer "z-50"',
      'Raw palette colour "bg-red-500"',
      'Arbitrary value "text-[13px]"',
      'Font weight "font-light"',
      // motion (docs/design/motion.md)
      '"transition-all" moves everything',
      'Raw time "duration-300"',
      'Easing "ease-in"',
      '"scale-0" grows from nothing',
      '"motion-reduce:transition-none" overrides reduced motion',
      'Keyframes of its own "animate-[wiggle_1s]"',
      '"motion-reduce:animate-none" overrides reduced motion',
      // tokens, imports and inline style
      'Unknown class detected: not-a-real-class',
      'Import icons from "@/components/icons"',
      'Base UI',
      'Spacing and colour come from tokens',
      // words (docs/design/copy.md)
      'The product name is written by hand',
      'Instead of "a fact", write: a context item',
    ]
    for (const words of expected) expect(text).toContainEqual(expect.stringContaining(words))
    expect(messages.every((message) => message.severity === 2)).toBe(true)
  })

  it('accepts a component built from the mockup scales and the new tokens', async () => {
    const messages = await lintAs('src/web/pages/good.tsx', fixture('good-component.tsx'))
    expect(messages.map((message) => `${message.ruleId}: ${message.message}`)).toEqual([])
  })

  it('lets a page switch on the viewport, and makes a part of the dock read its container', async () => {
    const source = 'export const A = () => <div className="flex md:hidden @md:flex" />'
    const viewport = (messages: Awaited<ReturnType<typeof lintAs>>) =>
      messages.filter((message) => message.message.startsWith('Viewport variant'))
    expect(viewport(await lintAs('src/web/pages/context.tsx', source))).toEqual([])
    expect(viewport(await lintAs('src/web/components/heed/fact-peek.tsx', source))).toHaveLength(1)
  })

  it('lets the icon module, and only it, import the icon library', async () => {
    const source = "export { CheckIcon } from 'lucide-react'"
    expect(await lintAs('src/web/components/icons.ts', source)).toEqual([])
    expect(await lintAs('src/web/components/other.ts', source)).toHaveLength(1)
  })
})

describe('Stylelint on the new token file', () => {
  it('lets src/web/styles/tokens.css define raw values, and no other stylesheet of the app', async () => {
    const lint = async (codeFilename: string) => {
      const result = await stylelint.lint({
        code: ':root {\n  --brand: #123456;\n  color: #123456;\n}\n',
        codeFilename: `${root}${codeFilename}`,
        configBasedir: root,
      })
      return result.results[0]?.warnings.filter(
        (warning) => warning.rule === 'scale-unlimited/declaration-strict-value',
      )
    }
    expect(await lint('src/web/styles/tokens.css')).toEqual([])
    expect(await lint('src/web/styles/example.css')).toHaveLength(1)
  })
})
