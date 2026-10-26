import { describe, expect, it } from 'vitest'
import { stateLabel } from '@/data/ask'
import { ANSWER_LINES, DOC_PAGES, llmsTxt, SHORTCUTS, WORDS } from '@/lib/help-content'
import { kindLabel } from '@/data/world'
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

  it('list every docs page once, and an index agents can read', () => {
    expect(DOC_PAGES).toHaveLength(11)
    expect(new Set(DOC_PAGES.map((p) => p.slug)).size).toBe(11)
    const index = llmsTxt()
    for (const p of DOC_PAGES) expect(index).toContain(`- [${p.title}](/docs/${p.slug}): ${p.line}`)
  })

  it('keep the shortcut sheet to about fifteen rows', () => {
    const rows = SHORTCUTS.flatMap((g) => g.rows)
    expect(rows.length).toBeGreaterThanOrEqual(12)
    expect(rows.length).toBeLessThanOrEqual(16)
  })
})
