import { existsSync, globSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import { bannedWords } from '../../src/domain/words.ts'
import plainWords, { allowedIn, surfaces } from '../../eslint.plain-words.js'

/**
 * heed/plain-words (eslint.plain-words.js) keeps the old voice out of the words people read
 * (docs/design/voice.md). It is only worth having if it is precise: it reports every banned word,
 * spelled-out negative and unclear contraction in text, and nothing in code.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const linter = new Linter({ cwd: root })

/** What the rule says about `code`, written in `file`, with the options a file there gets. */
function said(code: string, file = 'src/web/components/library/example.tsx', errorsOnly = false) {
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
          plugins: { heed: plainWords },
          rules: { 'heed/plain-words': ['warn', { errorsOnly }] },
        },
      ],
      { filename: join(root, file) },
    )
    .map((message) => message.message)
}

const write = (found: string, instead: string) =>
  `Instead of "${found}", write: ${instead}. See docs/design/voice.md.`
const sayShort = (found: string, short: string) =>
  `Instead of "${found}", write "${short}", as people say it. Keep "not" in full only where it carries the sentence (fullNegatives in src/domain/words.ts).`

describe('heed/plain-words reports the old voice in text people read', () => {
  it('names the five renames: fact, owner, archive, admin, and edition only on the Editions page', () => {
    expect(said(`export const a = <p>Add an item</p>`)).toEqual([write('item', 'fact')])
    expect(said(`export const b = 'The steward of Commercial accepts it.'`)).toEqual([
      write('steward', 'owner'),
    ])
    expect(said(`export const c = 'Retire this fact?'`)).toEqual([write('Retire', 'archive')])
    expect(said(`export const d = 'Ask an administrator.'`)).toEqual([
      write('administrator', 'admin'),
    ])
    expect(said(`export const e = 'Open the edition.'`)).toEqual([
      write('edition', 'what AI apps get today'),
    ])
  })

  it('tells a longer phrase once, not each word in it', () => {
    expect(said(`export const a = 'In the live edition today'`)).toEqual([
      write('live edition', 'what AI apps get today'),
    ])
    expect(said(`export const b = 'Every context item'`)).toEqual([write('context item', 'fact')])
  })

  it('reads strings, template text, JSX text and the attributes people read', () => {
    expect(said('export const a = (n: number) => `${n} items in scope`')).toEqual([
      write('items', 'facts'),
      write('scope', 'where it applies'),
    ])
    expect(said(`export const b = <input placeholder="Search items" />`)).toEqual([
      write('items', 'facts'),
    ])
    expect(said(`export const c = <button aria-label="Retire item" />`)).toEqual([
      write('Retire', 'archive'),
      write('item', 'fact'),
    ])
    expect(said(`export const d = { label: 'Stewards', title: 'Scope' }`)).toEqual([
      write('Stewards', 'owners'),
      write('Scope', 'where it applies'),
    ])
  })

  it('says a negative short, as people say it, keeping its capital', () => {
    expect(said(`export const a = 'We could not load the library.'`)).toEqual([
      sayShort('could not', "couldn't"),
    ])
    expect(said(`export const b = <p>Do not share your access key.</p>`)).toEqual([
      sayShort('Do not', "Don't"),
    ])
    expect(said(`export const c = 'You cannot sign in. It is not ready.'`)).toEqual([
      sayShort('cannot', "can't"),
      sayShort('is not', "isn't"),
    ])
  })

  it('keeps "not" in full where it carries the sentence', () => {
    expect(said(`export const a = 'Archive this fact? This cannot be undone.'`)).toEqual([])
    expect(said(`export const b = <h2>What it is not</h2>`)).toEqual([])
    expect(
      said(`export const c = "You can't undo it. We didn't send it. What not to conclude"`),
    ).toEqual([])
  })

  it('asks for an unclear or stacked contraction in full', () => {
    expect(said(`export const a = "You'd see it here."`)).toEqual([
      `Instead of "You'd", write it in full: You would, or You had. See docs/design/voice.md, principle 5.`,
    ])
    expect(said(`export const b = "It wouldn’t’ve helped."`)).toEqual([
      `Instead of "wouldn’t’ve", write it in full: wouldn’t have. See docs/design/voice.md, principle 5.`,
    ])
  })

  it('reports a code word written into a sentence, where it is wrong too', () => {
    expect(said(`export const a = 'The answer is no_match for now.'`)).toEqual([
      write('no_match', 'nothing is written down for this'),
    ])
  })

  it('reads the server where people read it: say, notifications and error messages', () => {
    expect(
      said(`export const a = 'That does not prove there is no caveat'`, 'src/server/mcp/say.ts'),
    ).toEqual([sayShort('does not', "doesn't"), write('caveat', 'fact')])
    expect(
      said(
        `throw new ORPCError('FORBIDDEN', { message: 'An active steward is required' })`,
        'src/server/modules/proposals/service.ts',
        true,
      ),
    ).toEqual([write('steward', 'owner')])
    expect(
      said(
        `const m = (n: number) => new ORPCError('CONFLICT', { message: n > 1 ? \`\${n} items changed\` : 'It changed' })`,
        'src/server/modules/proposals/service.ts',
        true,
      ),
    ).toEqual([write('items', 'facts')])
  })
})

describe('heed/plain-words leaves code alone', () => {
  it.each([
    ['an import', `import { item } from './item card'; export * from 'the steward'`],
    ['a key', `export const a = { item: 1, 'context item': 2, ['the scope']: 3 }`],
    ['a type', `type Role = 'Steward' | 'the steward'; type T = \`\${string} item\``],
    ['a comparison', `export const a = (k: string) => k === 'Steward' || k !== 'Context item'`],
    [
      'a switch case',
      `export function a(k: string) { switch (k) { case 'Retired item': return 1 } }`,
    ],
    ['a member', `export const a = (o: Record<string, number>) => o['the scope']`],
    ['a single lowercase word, a key', `export const a = ['item', 'steward', 'scope', 'retired']`],
    [
      'a word made of code marks',
      `export const a = 'Use item_id, getItem or --scope with /items.'`,
    ],
    ['an address', `export const a = 'Open https://example.com/items or /library/items'`],
    ['a code span', 'export const a = "Run `heed item list` first."'],
    ['class names', `export const a = <p className="items-center gap-2 group/item">x</p>`],
    ['a class list', `export const a = cn('items-start', true && 'the scope bar')`],
    ['test ids and ids', `export const a = <li data-testid="the item" id="scope" key="steward" />`],
    ['a link target', `export const a = <a href="/library/items" rel="item">Open</a>`],
    ['a code element', `export const a = <code>scope: item</code>`],
    ['a code sample', `export const a = '{"type": "item", "scope": "all"}'`],
    ['a command line', `export const a = 'npx heed item list --steward me'`],
    ['a log', `console.warn('steward missing for the item')`],
    ['an error for developers', `throw new Error('The item has no scope')`],
    ['a directive', `'use client'`],
    [
      'a longer word that holds a banned one',
      `export const a = 'Stewardship of a telescope, context-item'`,
    ],
  ])('%s', (_what, code) => {
    expect(said(code)).toEqual([])
  })

  it('reads the text in a call used as a statement, but not a directive', () => {
    expect(said(`showToast('Item retired')`)).toEqual([
      write('Item', 'fact'),
      write('retired', 'archived'),
    ])
    expect(said(`setFailure('Ask the steward.')`)).toEqual([write('steward', 'owner')])
    expect(said(`'use client'`)).toEqual([])
  })

  it('reads only error messages in the rest of the server', () => {
    const file = 'src/server/modules/proposals/service.ts'
    expect(said(`log.info('The steward changed the item')`, file, true)).toEqual([])
    expect(
      said(`export const sql = 'select item from items where scope = $1'`, file, true),
    ).toEqual([])
    expect(
      said(`throw new ORPCError('NOT_FOUND', { data: { why: 'no item' } })`, file, true),
    ).toEqual([])
  })
})

describe('where a banned word may show', () => {
  it('allows "edition" on the Editions page and its help page, and nowhere else', () => {
    expect(
      said(`export const a = 'Compare two editions'`, 'src/web/components/editions/x.tsx'),
    ).toEqual([])
    expect(allowedIn('docs/help/editions.md')).toContain('edition')
    expect(allowedIn('src/web/components/library/x.tsx')).toEqual([])
    // "live edition" stays banned there too.
    expect(
      said(`export const b = 'The live edition'`, 'src/web/components/editions/x.tsx'),
    ).toEqual([write('live edition', 'what AI apps get today')])
  })

  it('allows "dimension" on the Catalogue and in Administration, and "token" and "model" only in Administration', () => {
    expect(allowedIn('src/web/components/catalogue/x.tsx')).toEqual(['dimension'])
    expect(allowedIn('src/web/components/settings/sources-section.tsx').sort()).toEqual(
      ['MCP gateway', 'dimension', 'model', 'token'].sort(),
    )
    expect(allowedIn('src/web/lib/sources.ts').sort()).toEqual(
      ['MCP gateway', 'dimension', 'model', 'token'].sort(),
    )
    expect(allowedIn('src/web/components/settings/profile-section.tsx')).toEqual([])
  })

  it('gives every place the glossary allows a word on its files, and every file glob a match', () => {
    for (const banned of bannedWords.filter((b) => b.allowedOn))
      expect(
        surfaces.filter((surface) => banned.allowedOn!.includes(surface.place)),
        banned.word,
      ).not.toEqual([])
    for (const surface of surfaces)
      for (const glob of [...surface.files, ...(surface.except ?? [])])
        expect(globSync(glob, { cwd: root }).length > 0 || existsSync(join(root, glob)), glob).toBe(
          true,
        )
  })
})
