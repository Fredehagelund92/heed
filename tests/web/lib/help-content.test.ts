import { describe, expect, it } from 'vitest'
import { stateLabel } from '@/model/ask'
import { ANSWER_LINES, reportMail, SHORTCUTS, supportMail, WORDS } from '@/lib/help-content'
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

  it('write to support by mail, and send a problem with its page but never its query', () => {
    expect(supportMail()).toMatch(/^mailto:support@[a-z]+\.example$/)
    const mail = reportMail('  The review jumped.  ', {
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

  // Seventeen with the Conflict scope's row: its other keys are in the view's own hints and Help.
  it('keep the shortcut sheet to about fifteen rows', () => {
    const rows = SHORTCUTS.flatMap((g) => g.rows)
    expect(rows.length).toBeGreaterThanOrEqual(12)
    expect(rows.length).toBeLessThanOrEqual(17)
  })
})
