import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { REPOSITORY_URL } from '@domain/brand'
import { stateLabel } from '@/model/ask'
import { ANSWER_LINES, SHORTCUTS, supportAt, WORDS } from '@/lib/help-content'
import { CONFLICT_KEYS } from '@/lib/conflict'
import { kindLabel } from '@/model/items'
import { PRODUCT } from '@/lib/brand'

// One source for the product's own words: Help, the answer line's card, Ask's labels and the docs
// all draw from these lists, so they cannot disagree.

describe('the shared help lists', () => {
  it('give Ask its answer lines, one for every state', () => {
    expect(ANSWER_LINES.map((l) => l.state).sort()).toEqual([
      'conflict',
      'failed',
      'grounded',
      'missing',
      'partial',
      'stale',
    ])
    for (const l of ANSWER_LINES) expect(stateLabel[l.state]).toBe(l.label)
    for (const l of ANSWER_LINES) expect(l.todo.length, l.state).toBeGreaterThan(0)
  })

  it('keep to ten words, each once, in plain sentences', () => {
    expect(WORDS).toHaveLength(10)
    expect(new Set(WORDS.map(([w]) => w)).size).toBe(10)
    for (const [w, d] of WORDS) {
      expect(d.split(' ').length, w).toBeLessThanOrEqual(30)
      expect(d, w).not.toMatch(new RegExp(`\\b${PRODUCT}\\b`))
    }
    // The context item word names today's four kinds.
    const item = WORDS.find(([w]) => w === 'Context item')![1].toLowerCase()
    for (const k of Object.values(kindLabel)) expect(item).toContain(k.toLowerCase())
  })

  it('go to GitHub issues on an install with no support address, never a dead one', () => {
    const support = supportAt(null)
    expect(support.supportByMail).toBe(false)
    expect(support.supportTarget).toEqual({ target: '_blank', rel: 'noreferrer' })
    expect(support.supportHref()).toBe(`${REPOSITORY_URL}/issues/new/choose`)
    const issue = new URL(
      support.reportHref('  The review jumped.  ', {
        origin: 'https://context.example.org',
        pathname: '/ask',
      }),
    )
    expect(issue.pathname).toBe(new URL(`${REPOSITORY_URL}/issues/new`).pathname)
    expect(issue.searchParams.get('template')).toBe('bug.yml')
    expect(issue.searchParams.get('title')).toBe('Report a problem')
    // An issue anyone can read says where in the app, and never where this install is.
    expect(issue.searchParams.get('what-happened')).toBe('The review jumped.\n\nPage: /ask')
  })

  it('name a real field of the issue form they fill in', async () => {
    const form = await readFile(
      new URL('../../../.github/ISSUE_TEMPLATE/bug.yml', import.meta.url),
      'utf8',
    )
    expect(form).toContain('id: what-happened')
  })

  it('write to support by mail on an install that names an address, with the page but never its query', () => {
    const support = supportAt('help@acme.example')
    expect(support.supportByMail).toBe(true)
    expect(support.supportTarget).toEqual({})
    expect(support.supportHref()).toBe('mailto:help@acme.example')
    const mail = support.reportHref('  The review jumped.  ', {
      origin: 'https://context.example.org',
      pathname: '/ask',
    })
    const url = new URL(mail)
    expect(url.protocol).toBe('mailto:')
    expect(url.searchParams.get('subject')).toBe('Report a problem')
    expect(url.searchParams.get('body')).toBe(
      'The review jumped.\n\nPage: https://context.example.org/ask',
    )
    // A space is %20, which every mail app reads; a + would stay a +.
    expect(mail).not.toContain('+')
  })

  // Thirty with every key of the conflict view, which Help's pages send people to ? for.
  it('keep the shortcut sheet to about thirty rows', () => {
    const rows = SHORTCUTS.flatMap((g) => g.rows)
    expect(rows.length).toBeGreaterThanOrEqual(12)
    expect(rows.length).toBeLessThanOrEqual(30)
  })

  it("list the conflict view's own keys, so the sheet cannot drift from them", () => {
    const rows = SHORTCUTS.find((g) => g.group === 'Conflict')!.rows
    expect(rows.slice(0, CONFLICT_KEYS.length).map((r) => r.label)).toEqual(
      CONFLICT_KEYS.map((k) => k.label),
    )
    expect(rows.map((r) => r.keys.join(' '))).toEqual(
      expect.arrayContaining(['←', '→', '1', '2', 'E', 'B', 'N', 'O', 'J', 'K', '⌘ ↵']),
    )
  })
})
