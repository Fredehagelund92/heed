import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import plainWords, { webPlacesOf, webSurfaces } from '../../eslint.plain-words.js'

/**
 * heed/plain-words with glossary v2 (src/domain/words.ts, docs/design/copy.md) is the copy guard
 * rail of the new web app: the mockup's copy check (`src/lib/copy.test.ts` there), as a lint rule
 * on src/web. It reports each banned word in text people read, allows a word only on the place the
 * glossary names, and leaves code alone.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const linter = new Linter({ cwd: root })

/** What the rule says about `code`, written in `file` of the new app. */
function said(code: string, file = 'src/web/pages/inbox.tsx') {
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
          rules: { 'heed/plain-words': ['error', { glossary: 'web' }] },
        },
      ],
      { filename: join(root, file) },
    )
    .map((message) => message.message)
}

const write = (found: string, instead: string) =>
  `Instead of "${found}", write: ${instead}. See docs/design/copy.md.`

describe('heed/plain-words in the new app (glossary v2)', () => {
  it('accepts the names of glossary v2', () => {
    expect(
      said(`export const a = <p>3 context items. Invite people as an Admin or a Member.</p>`),
    ).toEqual([])
    expect(
      said(`export const b = ['Save question', 'Not found', 'Not checked', 'Try it']`),
    ).toEqual([])
    expect(
      said(`export const c = { label: 'Event', hint: 'A limit agents should know.' }`),
    ).toEqual([])
  })

  it('reports the words glossary v2 retired, with what to write', () => {
    expect(said(`export const a = <button>Add a fact</button>`)).toEqual([
      write('a fact', 'a context item'),
    ])
    expect(said(`export const b = 'Users'`)).toEqual([write('Users', 'People')])
    expect(said(`export const c = 'Ask an administrator or the steward.'`)).toEqual([
      write('administrator', 'Admin'),
      write('steward', 'owner'),
    ])
    expect(said(`export const d = <p>Connect an AI app</p>`)).toEqual([write('AI app', 'agent')])
    expect(said(`export const e = 'Try a question'`)).toEqual([write('Try a question', 'Try it')])
    expect(said(`export const f = 'Retire this proposal?'`)).toEqual([
      write('Retire', 'archive'),
      write('proposal', 'suggestion'),
    ])
  })

  it('reports the earlier answer labels and kind names as labels, not the words in a sentence', () => {
    expect(said(`export const a = <span>Based on checked context</span>`)).toEqual([
      write('Based on checked context', 'Checked'),
    ])
    expect(said(`export const b = 'Not covered'`)).toEqual([write('Not covered', 'Not found')])
    expect(said(`export const c = { label: 'Good to know' }`)).toEqual([
      write('Good to know', 'Rule'),
    ])
    expect(said(`export const d = 'Some of it may be out of date.'`)).toEqual([])
  })

  it('reports Gap and Flag as card names, and nothing that promises anonymity', () => {
    expect(said(`export const a = { group: 'Gaps' }`)).toEqual([write('Gaps', 'Not found')])
    expect(said(`export const b = 'Anonymous questions'`)).toEqual([
      write('Anonymous', 'what is kept: scopes and counts'),
    ])
    expect(said(`export const c = 'A gap in the data'`)).toEqual([])
  })

  it('leads back to the app, never to a workspace by name', () => {
    expect(said(`export const a = <a>Back to Larchwood</a>`)).toEqual([
      write('Back to Larchwood', 'Back to app'),
    ])
    expect(said(`export const b = <a>Back to app</a>`)).toEqual([])
  })

  it('reports an em dash in text people read', () => {
    expect(said(`export const a = 'Published \\u2014 agents now say it.'`)).toEqual([
      write('\u2014', 'a plain dash, a comma or a full stop'),
    ])
  })

  it('names a connected tool only on its integration, and an edition only where it belongs', () => {
    const cube = `export const a = 'Metrics come from Cube.'`
    expect(said(cube)).toEqual([
      write('Cube', 'your definitions source; the name only on its integration'),
    ])
    expect(said(cube, 'src/web/pages/integrations.tsx')).toEqual([])
    const edition = `export const b = 'Published to the live edition.'`
    expect(said(edition)).toEqual([write('edition', 'what agents get now')])
    expect(said(edition, 'src/web/pages/settings.tsx')).toEqual([])
    expect(said(edition, 'src/web/lib/agent-reply.ts')).toEqual([])
  })

  it("keeps an agent's tool out of the review's own sentences only", () => {
    const tool = `export const a = <p>An agent in Cursor suggested this.</p>`
    expect(said(tool)).toEqual([])
    expect(said(tool, 'src/web/pages/review-page.tsx')).toEqual([
      write('Cursor', 'an agent; where a suggestion came from is source data'),
    ])
  })

  it('leaves code alone: keys, classes, imports, comparisons and code samples', () => {
    expect(
      said(`
        import { fact } from './fact'
        // A fact in a comment is not read.
        export const a = <div className="fact-row" data-kind="fact" key="facts">{fact}</div>
        export const b = (k: string) => k === 'Users'
        export const c = { kind: 'issue', id: 'fact_1' }
        export const d = <code>Facts</code>
      `),
    ).toEqual([])
  })

  it('maps each place to its files', () => {
    expect(webPlacesOf('src/web/pages/settings.tsx')).toEqual(['Settings'])
    expect(webPlacesOf('src/web/components/heed/review-parts.tsx')).toEqual(['the review'])
    expect(webPlacesOf('src/web/pages/inbox.tsx')).toEqual([])
    for (const { files } of webSurfaces)
      for (const glob of files) expect(glob, 'a place of the new app').toMatch(/^src\/web\//)
  })
})
