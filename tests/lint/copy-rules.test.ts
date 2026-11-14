import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import copyRules from '../../eslint.copy-rules.js'
import plainWords from '../../eslint.plain-words.js'

/**
 * The ratchets on copy (eslint.copy-rules.js, and the wide and v2 forms of heed/plain-words,
 * counted by scripts/check-plain-words.ts). Each must report the break it names, in text people
 * read, and nothing in code.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const linter = new Linter({ cwd: root })

/** The messages a rule gives for `code` written in `file`. */
function said(
  plugin: object,
  rule: string,
  code: string,
  file = 'src/web/pages/example.tsx',
  options: object[] = [],
) {
  return linter
    .verify(
      code,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          plugins: { x: plugin },
          rules: { [`x/${rule}`]: ['warn', ...options] },
        },
      ],
      { filename: join(root, file) },
    )
    .map((message) => message.messageId)
}
const copy = (rule: string, code: string, file?: string) => said(copyRules, rule, code, file)

describe('heed/plain-words-wide reads what the narrow reading takes for code', () => {
  const wide = (code: string) =>
    said(plainWords, 'plain-words-wide', code, undefined, [{ glossary: 'web' }])
  const narrow = (code: string) =>
    said(plainWords, 'plain-words', code, undefined, [{ glossary: 'web' }])

  it('reads the body of a switch case, and not its test', () => {
    const code = `export const a = (k: string) => { switch (k) { case 'fact': return 'This fact is live' } }`
    expect(narrow(code)).toEqual([])
    expect(wide(code)).toEqual(['webGlossary'])
  })

  it('reads a value under action, value or name when it has a space or a capital', () => {
    expect(narrow(`export const a = { action: 'Undo this fact' }`)).toEqual([])
    expect(wide(`export const a = { action: 'Undo this fact' }`)).toEqual(['webGlossary'])
    expect(wide(`export const c = { value: 'fact' }`)).toEqual([])
  })

  it('reads one word that ends in an ellipsis', () => {
    expect(narrow(`export const a = 'Flagging…'`)).toEqual([])
    expect(wide(`export const a = 'Flagging…'`)).toEqual([])
    expect(wide(`export const b = { label: 'Archiving…' }`)).toEqual([])
  })

  it('reports nothing that the narrow reading already reports', () => {
    expect(wide(`export const a = 'This fact is live'`)).toEqual([])
    expect(narrow(`export const a = 'This fact is live'`)).toEqual(['webGlossary'])
  })
})

describe('heed/plain-words-v2 holds what people read outside the web app to glossary v2', () => {
  const v2 = (code: string, file: string, errorsOnly = false) =>
    said(plainWords, 'plain-words-v2', code, file, [{ errorsOnly }])

  it('reports a fact in a domain sentence and a contract message', () => {
    expect(v2(`export const a = 'Add a fact first.'`, 'src/domain/example.ts')).toEqual([
      'webGlossary',
    ])
    expect(v2(`export const a = 'Add a context item first.'`, 'src/contract/example.ts')).toEqual(
      [],
    )
  })

  it('reads only the message of a server error', () => {
    const code = `throw new ORPCError('CONFLICT', { message: 'The proposal changed' }); const x = 'proposal'`
    expect(v2(code, 'src/server/modules/example.ts', true)).toEqual(['webGlossary'])
  })

  it('lets a connector name its own tool', () => {
    expect(
      v2(`export const a = 'Reads the Cube model'`, 'src/connectors/cube/manifest.ts'),
    ).toEqual([])
    expect(v2(`export const a = 'Reads the Cube model'`, 'src/domain/example.ts')).toEqual([
      'webGlossary',
    ])
  })
})

describe('copy/whole-sentences', () => {
  it('reports a label lower-cased into a sentence', () => {
    expect(
      copy('whole-sentences', 'export const a = (l: string) => `Could not ${l.toLowerCase()}.`'),
    ).toEqual(['lowercased'])
    expect(copy('whole-sentences', 'export const a = (l: string) => `${l.toLowerCase()}`')).toEqual(
      [],
    )
  })

  it('reports "a" or "an" before a value', () => {
    expect(copy('whole-sentences', 'export const a = (k: string) => `Now a ${k}.`')).toEqual([
      'article',
    ])
    expect(copy('whole-sentences', 'export const a = (k: string) => `Now ${k}.`')).toEqual([])
  })

  it('reports a plural made by adding "s"', () => {
    expect(
      copy('whole-sentences', "export const a = (n: number) => `${n} item${n === 1 ? '' : 's'}`"),
    ).toEqual(['plural'])
    expect(copy('whole-sentences', "export const a = (n: number) => plural(n, 'item')")).toEqual([
      'plural',
    ])
    expect(
      copy('whole-sentences', "export const a = (n: number) => n === 1 ? 'one' : 'many'"),
    ).toEqual([])
  })

  it('reports a word cut in two parts', () => {
    expect(copy('whole-sentences', "export const a = 'One more week: a' + 'gents get it'")).toEqual(
      ['split'],
    )
    expect(copy('whole-sentences', 'export const a = (n: string) => `Other${n}ish`')).toEqual([
      'split',
    ])
  })
})

describe('copy/sentence-length', () => {
  const words = (n: number) => `${Array.from({ length: n }, () => 'word').join(' ')}.`

  it('fails a sentence over 25 words and notes one over 20', () => {
    expect(copy('sentence-length', `export const a = '${words(26)}'`)).toEqual(['over25'])
    expect(copy('sentence-length', `export const a = '${words(21)}'`)).toEqual(['over20'])
    expect(copy('sentence-length', `export const a = '${words(20)}'`)).toEqual([])
  })

  it('counts each sentence of a string on its own', () => {
    expect(copy('sentence-length', `export const a = '${words(15)} ${words(15)}'`)).toEqual([])
  })
})

describe('copy/one-word-one-thing', () => {
  it('names the glossary word for a second name', () => {
    expect(copy('one-word-one-thing', "export const a = 'Retry'")).toEqual(['second'])
    expect(copy('one-word-one-thing', "export const a = 'Reply to the thread'")).toEqual(['second'])
    expect(copy('one-word-one-thing', "export const a = 'Try again'")).toEqual([])
  })

  it('reads the lower case of gap and flag, which the capital check misses', () => {
    expect(copy('one-word-one-thing', "export const a = 'flag and suggest'")).toEqual(['second'])
  })

  it('keeps engineer words to their pages', () => {
    expect(copy('one-word-one-thing', "export const a = 'Is the queue empty'")).toEqual([
      'engineer',
    ])
    expect(
      copy(
        'one-word-one-thing',
        "export const a = 'Is the queue empty'",
        'src/web/pages/settings.tsx',
      ),
    ).toEqual([])
  })
})

describe('copy/errors-say-three-things', () => {
  it('reports an error with no message', () => {
    expect(
      copy('errors-say-three-things', "throw new ORPCError('NOT_FOUND')", 'src/server/a.ts'),
    ).toEqual(['noMessage'])
    expect(
      copy(
        'errors-say-three-things',
        "throw new ORPCError('NOT_FOUND', { data: 1 })",
        'src/server/a.ts',
      ),
    ).toEqual(['noMessage'])
    expect(
      copy(
        'errors-say-three-things',
        "throw new ORPCError('NOT_FOUND', { message: 'It is gone. Reload.' })",
        'src/server/a.ts',
      ),
    ).toEqual([])
  })

  it('reports an error toast with no description and no action', () => {
    expect(copy('errors-say-three-things', "toast.error('Could not save')")).toEqual(['noNextStep'])
    expect(copy('errors-say-three-things', "toast.error('Could not save', { id: 'a' })")).toEqual([
      'noNextStep',
    ])
    expect(
      copy(
        'errors-say-three-things',
        "toast.error('Could not save', { description: 'Try again.' })",
      ),
    ).toEqual([])
  })
})

describe('copy/no-fixed-locale', () => {
  it('reports a literal locale and typed month names', () => {
    expect(
      copy('no-fixed-locale', "export const a = (n: number) => n.toLocaleString('en-GB')"),
    ).toEqual(['locale'])
    expect(copy('no-fixed-locale', "export const a = new Intl.DateTimeFormat('en')")).toEqual([
      'locale',
    ])
    expect(copy('no-fixed-locale', 'export const a = (n: number) => n.toLocaleString()')).toEqual(
      [],
    )
    expect(
      copy(
        'no-fixed-locale',
        "export const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']",
      ),
    ).toEqual(['months'])
  })
})

describe('copy/no-demo-in-shared-code', () => {
  it('reports the demo in a text, a name and a typed date', () => {
    expect(copy('no-demo-in-shared-code', "export const a = 'Start the demo again'")).toEqual([
      'demo',
    ])
    expect(copy('no-demo-in-shared-code', "export const a = 'Ask Jon Abara'")).toEqual(['name'])
    expect(copy('no-demo-in-shared-code', "export const a = 'Due on 20 Jan 2027.'")).toEqual([
      'date',
    ])
    expect(copy('no-demo-in-shared-code', "export const a = 'Ask the owner'")).toEqual([])
  })
})
