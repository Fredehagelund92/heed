/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CHECKS, GUIDES, liveCopy, PROMPT, WAIT_HINT, type Via } from '@/data/agents'
import { BACK_TO_APP, MCP_URL as ADDRESS, PRODUCT, SLUG } from '@/lib/brand'
import { kindHint, kindLabel } from '@/data/world'
import { LIVE_PHASES } from '@/lib/connect'
import { ANSWER_LINES } from '@/lib/help-content'
import { cardTypeLabel } from '@/data/inbox'

// The rules for the words people read, as checks rather than conventions (the real app has them as
// lint rules: eslint.product-name.js and eslint.plain-words.js). Only text a person reads is
// checked: string literals, template text and JSX text. Comments and code names are not.

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
/** Not the product's own copy: the shadcn and editorcn parts as they ship, and tests. */
const SKIP = [
  /^components\/ui\//,
  /^components\/editor\//,
  /^components\/static-renderer\//,
  /\.test\.tsx?$/,
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

type Text = { file: string; line: number; text: string }

/** Every string a person could read in a file. */
function texts(path: string): Text[] {
  const file = relative(ROOT, path)
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const out: Text[] = []
  const add = (node: ts.Node, text: string) =>
    out.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text })
  const visit = (node: ts.Node) => {
    // Module names and class lists are code.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (
      ts.isJsxAttribute(node) &&
      ['className', 'href', 'id', 'data-slot'].includes(node.name.getText())
    )
      return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text)
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      add(node, node.text)
    else if (ts.isJsxText(node) && node.text.trim()) add(node, node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

const all = files(ROOT)
  .filter((p) => !SKIP.some((re) => re.test(relative(ROOT, p))))
  .flatMap(texts)
// Words a person reads: more than one word, or a capitalised one. A lone lowercase word is a key.
const prose = all.filter((t) => /\s/.test(t.text.trim()) || /^[A-Z]/.test(t.text.trim()))
const where = (list: Text[]) => list.map((t) => `${t.file}:${t.line} ${t.text.trim().slice(0, 80)}`)

describe('the words people read', () => {
  it('never write the product name by hand', () => {
    const named = new RegExp(`\\b${PRODUCT}\\b`)
    expect(where(prose.filter((t) => named.test(t.text) && t.file !== 'lib/brand.ts'))).toEqual([])
  })

  it('name the definitions connector only through its integration', () => {
    // "Cube" is the connected tool today, not a word of the product: generic copy takes the name
    // from the integration (connectorById), so a different connector is one change.
    const own = ['data/integrations.ts', 'pages/integrations.tsx', 'data/world.ts']
    expect(where(prose.filter((t) => /\bCube\b/.test(t.text) && !own.includes(t.file)))).toEqual([])
  })

  it("use the product's own words", () => {
    // Each banned word, and where it may still show.
    const banned: { word: RegExp; allowed: string[] }[] = [
      // An edition is Advanced vocabulary: never in success copy.
      { word: /\bedition\b/i, allowed: ['pages/settings.tsx', 'lib/agent-reply.ts'] },
      // Nothing promises anonymity: what is kept is said instead.
      { word: /\banonymous\b|\bnobody sees who\b/i, allowed: [] },
      // Card kinds are named by what happened.
      { word: /\b(Gap|Flag)s?\b(?! closed)/, allowed: [] },
      // A draft is never called checked.
      { word: /\bdraft\b.*\bchecked context\b/i, allowed: [] },
    ]
    for (const { word, allowed } of banned)
      expect(where(prose.filter((t) => word.test(t.text) && !allowed.includes(t.file)))).toEqual([])
  })

  it('name the six answer states in one or two plain words, from one list', () => {
    expect(Object.fromEntries(ANSWER_LINES.map((l) => [l.state, l.label]))).toEqual({
      grounded: 'Checked',
      partial: 'Partial',
      missing: 'Not found',
      conflict: 'Conflict',
      stale: 'Outdated',
      failed: 'Not checked',
    })
    for (const l of ANSWER_LINES) {
      // For readers who are not native English speakers: short, and no contractions.
      expect(l.label.split(' ').length, l.label).toBeLessThanOrEqual(2)
      expect(l.sentence.split(' ').length, l.sentence).toBeLessThanOrEqual(8)
      for (const t of [l.label, l.sentence, l.long]) expect(t, t).not.toMatch(/\w'\w|’/)
    }
    expect(cardTypeLabel.gap).toBe('Not found')
    // The old labels stay only as the long form, in the one list.
    const old =
      /Based on checked context|Covers part of it|Nothing written down|Context disagrees|May be out of date|Couldn't check|\bNot covered\b/
    expect(
      where(prose.filter((t) => old.test(t.text) && t.file !== 'lib/help-content.ts')),
    ).toEqual([])
  })

  it("lead back from Settings to the app, never to the workspace's name", () => {
    expect(BACK_TO_APP).toBe('Back to app')
    expect(
      where(prose.filter((t) => /\bBack to (Larchwood|your workspace)/i.test(t.text))),
    ).toEqual([])
  })

  it('name the four kinds in plain, common words, from one map', () => {
    expect(kindLabel).toEqual({ event: 'Event', issue: 'Warning', note: 'Rule', guide: 'Guide' })
    // Short lines for readers who aren't native English speakers: no hint over fourteen words.
    for (const hint of Object.values(kindHint))
      expect(hint.split(' ').length, hint).toBeLessThanOrEqual(14)
    // The old names are gone from every word a person reads.
    expect(
      where(
        prose.filter((t) =>
          /Something happened|A problem with the data|Good to know|How to look into it|\bCaveat\b/i.test(
            t.text,
          ),
        ),
      ),
    ).toEqual([])
  })

  it("keep agents' names out of the review's own sentences", () => {
    // Where a suggestion came from is source data ("An agent in Cursor"); the review's own wording
    // never names a tool, and never builds a sentence around one.
    const review = ['pages/review-page.tsx', 'components/heed/review-parts.tsx']
    expect(
      where(
        prose.filter(
          (t) =>
            review.includes(t.file) &&
            /\b(Claude|Cursor|ChatGPT|Codex)\b|agent in \$?\{?/.test(t.text),
        ),
      ),
    ).toEqual([])
  })

  it('connect an agent: the name only inside commands and the address, in every state', () => {
    // What a person reads while connecting: the prompt, each agent's steps, and the live line in
    // all its states. Commands and the address carry the server's name; sentences never do.
    const vias = Object.keys(WAIT_HINT) as Via[]
    const lines = [
      PROMPT,
      ...GUIDES.flatMap((g) => g.steps.map((s) => s.what)),
      ...CHECKS,
      ...LIVE_PHASES.flatMap((p) =>
        vias.map((v) => liveCopy(p, v, 'Claude Code', 'Jon Abara')),
      ).flatMap((c) => [c.title, c.body ?? '']),
    ]
    const commands = new RegExp(
      `${ADDRESS.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}|^.*\\b(mcp add|mcp login)\\b.*$`,
      'gm',
    )
    const named = new RegExp(`\\b${SLUG}\\b|\\b${PRODUCT}\\b`, 'i')
    expect(lines.filter((l) => named.test(l.replace(commands, '')))).toEqual([])
    expect(lines.filter((l) => /\u2014/.test(l))).toEqual([])
    for (const p of LIVE_PHASES)
      expect(liveCopy(p, 'prompt', 'Claude Code', 'Jon Abara').title, p).toBeTruthy()
    // A figure or a connection is never called checked; the context is.
    expect(
      LIVE_PHASES.map((p) => liveCopy(p, 'prompt', 'Claude Code', 'Jon Abara').title).filter((t) =>
        /\bchecked\b/i.test(t),
      ),
    ).toEqual([])
  })
})
