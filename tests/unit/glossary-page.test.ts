import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { headingSlug } from '@domain/heading-anchors'
import { bannedWords, concepts, usesWord, type Concept, type ConceptKey } from '@domain/words'
import { splitPage } from '@/lib/docs'

/*
  The help glossary (docs/help/glossary.md) against the words people read (src/domain/words.ts):
  every concept has its entry, under the name on screen; the entries say it in those words; and
  the old words keep their entries at the end, so every link and search that names one still
  lands on a heading that says what we call it now.
*/

const OLD_WORDS = 'Words you may have seen'

const split = splitPage(readFileSync('docs/help/glossary.md', 'utf8'))
if (!split.ok) throw new Error(`glossary.md: ${split.reason}`)

type Entry = { group: string; title: string; text: string }
/** Each `###` entry with the `##` group it sits in and its words, the heading's included. */
const entries: Entry[] = []
let group = ''
for (const line of split.body.split('\n')) {
  if (line.startsWith('## ')) group = line.slice(3).trim()
  else if (line.startsWith('### '))
    entries.push({ group, title: line.slice(4).trim(), text: line.slice(4) })
  else if (entries.length) entries.at(-1)!.text += `\n${line}`
}
const current = entries.filter((entry) => entry.group !== OLD_WORDS)
const old = entries.filter((entry) => entry.group === OLD_WORDS)

/** The concept an entry names: its heading is the concept's name, or the name without its "s". */
function conceptOf(title: string): ConceptKey | null {
  const named = (Object.entries(concepts) as [ConceptKey, Concept][]).find(
    ([, concept]) =>
      concept.name.toLowerCase() === title.toLowerCase() ||
      concept.name.toLowerCase() === `${title.toLowerCase()}s`,
  )
  return named?.[0] ?? null
}

/**
 * The anchors other pages, screens and tests link to (`glossary.md#...`, `glossary#...`): each
 * must stay a heading, whatever the entry now says.
 */
const linkedAnchors = [
  'assistant',
  'check',
  'domain',
  'edition',
  'gap',
  'mcp',
  're-check-due',
  'owner',
  'test-question',
  'tool',
]

describe('the help glossary', () => {
  it('has an entry for every concept, under the name people read', () => {
    const titles = new Set(current.map((entry) => conceptOf(entry.title)))
    const missing = (Object.entries(concepts) as [ConceptKey, Concept][])
      .filter(([key]) => !titles.has(key))
      .map(([, concept]) => concept.name)
    expect(missing).toEqual([])
  })

  it('says its entries in the words people read, outside the old words', () => {
    const found = current.flatMap((entry) => {
      const own = conceptOf(entry.title)
      return (
        bannedWords
          // A word allowed somewhere, such as edition, stays in its own concept's entry.
          .filter((banned) => !(banned.allowedOn && banned.concept === own))
          .filter((banned) => usesWord(entry.text, banned.word))
          .map((banned) => `${entry.title}: "${banned.word}", write ${banned.write}`)
      )
    })
    expect(found).toEqual([])
  })

  it('points each old word at the entry that replaced it', () => {
    expect(old.length).toBeGreaterThan(0)
    const anchors = new Set(entries.map((entry) => headingSlug(entry.title)))
    for (const entry of old) {
      const links = [...entry.text.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((match) => match[1]!)
      expect(links.length, entry.title).toBeGreaterThan(0)
      for (const link of links) expect(anchors.has(link), `${entry.title}: #${link}`).toBe(true)
    }
  })

  it('keeps every anchor that is linked to', () => {
    const anchors = new Set(entries.map((entry) => headingSlug(entry.title)))
    expect(linkedAnchors.filter((anchor) => !anchors.has(anchor))).toEqual([])
  })
})
