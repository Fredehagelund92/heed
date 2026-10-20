import fc from 'fast-check'
import type { Mark, Node } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import { parseMentions } from '@domain/mentions'
import { bodySchema, docText, docToMarkdown, markdownToDoc } from '@/components/editor/body-doc'
import { parseMarkdown } from '@/lib/markdown'
import { corpus } from './body-corpus'

const roundTrip = (markdown: string) => docToMarkdown(markdownToDoc(markdown))
const drawn = (markdown: string) => JSON.stringify(parseMarkdown(markdown))

describe('the body round trip on the corpus', () => {
  it.each(corpus.filter(([, kind]) => kind === 'canonical'))(
    'writes %s back byte for byte',
    (_, __, markdown) => {
      expect(roundTrip(markdown)).toBe(markdown)
    },
  )

  it.each(corpus.filter(([, kind]) => kind !== 'canonical'))(
    'draws %s the same after a round trip, and the second pass is stable',
    (_, __, markdown) => {
      const once = roundTrip(markdown)
      expect(drawn(once)).toBe(drawn(markdown))
      expect(roundTrip(once)).toBe(once)
    },
  )

  it('keeps every mention token', () => {
    for (const [, , markdown] of corpus) {
      const tokens = (text: string) => parseMentions(text).mentions.map((m) => m.target)
      const kept = tokens(roundTrip(markdown))
      for (const target of tokens(markdown).filter((t) => /^(metric|dim|val|item|area):/.test(t)))
        expect(kept).toContain(target)
    }
  })

  it('leaves empty list items out, so an unfilled template stores nothing', () => {
    const { nodes } = bodySchema
    const item = (text: string) =>
      nodes.list_item.create(
        null,
        nodes.paragraph.create(null, text ? bodySchema.text(text) : null),
      )
    const doc = nodes.doc.create(null, [
      nodes.ordered_list.create(null, [item(''), item('Check the period'), item('')]),
      nodes.bullet_list.create(null, [item('')]),
    ])
    expect(docToMarkdown(doc)).toBe('1. Check the period')
  })

  it('reads an empty body as one empty paragraph and writes it back empty', () => {
    expect(markdownToDoc('').childCount).toBe(1)
    expect(roundTrip('')).toBe('')
  })

  it('counts what a reader sees, a mention as its words', () => {
    expect(docText(markdownToDoc('## Steps\n\n1. Check @[Orders](metric:orders)'))).toBe(
      'Steps\n\nCheck Orders',
    )
  })
})

describe('the writer escapes only what the reader would take as syntax', () => {
  const { nodes, marks } = bodySchema
  const paragraph = (...content: Node[]) =>
    nodes.doc.create(null, nodes.paragraph.create(null, content))
  const text = (value: string, ...on: Mark[]) => bodySchema.text(value, on)

  it.each([
    ['Compute 2 * 3 and a*b*c.', 'Compute 2 * 3 and a\\*b*c.'],
    ['1. not a list', '1\\. not a list'],
    ['- not a list', '\\- not a list'],
    ['+ not a list', '\\+ not a list'],
    ['## not a heading', '\\## not a heading'],
    ['> not a quote', '\\> not a quote'],
    ['~~~ not a fence', '\\~~~ not a fence'],
    ['a `tick`', 'a \\`tick\\`'],
    ['[x](https://example.com) stays text', '\\[x](https://example.com) stays text'],
    ['mail anna@example.com', 'mail anna@example.com'],
    ['C:\\path and \\*', 'C:\\path and \\\\*'],
  ])('writes the text %j as %j', (value, expected) => {
    const written = docToMarkdown(paragraph(text(value)))
    expect(written).toBe(expected)
    expect(docToMarkdown(markdownToDoc(written))).toBe(written)
    expect(markdownToDoc(written).textContent).toBe(value)
  })

  it('moves spaces at the edges of a mark outside it', () => {
    const doc = paragraph(text('say '), text('might be ', marks.em.create()), text('related'))
    expect(docToMarkdown(doc)).toBe('say *might be* related')
  })

  it('writes italic around an asterisk with underscores', () => {
    const doc = paragraph(text('2*3', marks.em.create()))
    expect(docToMarkdown(doc)).toBe('_2*3_')
    expect(markdownToDoc('_2*3_').eq(doc)).toBe(true)
  })

  it('writes bold around italic so the reader nests them', () => {
    const doc = paragraph(text('both', marks.strong.create(), marks.em.create()))
    const written = docToMarkdown(doc)
    expect(markdownToDoc(written).eq(doc)).toBe(true)
  })

  it('writes a code span with a fence longer than the ticks inside it', () => {
    const doc = paragraph(text('a `b` c', marks.code.create()))
    expect(docToMarkdown(doc)).toBe('``a `b` c``')
    expect(markdownToDoc(docToMarkdown(doc)).eq(doc)).toBe(true)
  })

  it('writes a code block with a fence longer than any run of ticks inside it', () => {
    const doc = nodes.doc.create(
      null,
      nodes.code_block.create(null, bodySchema.text('```\n~~~\n````')),
    )
    const written = docToMarkdown(doc)
    expect(written).toBe('`````\n```\n~~~\n````\n`````')
    expect(markdownToDoc(written).eq(doc)).toBe(true)
  })

  it('writes a line break inside a paragraph, escaping a list sign after it', () => {
    const doc = paragraph(text('one'), nodes.hard_break.create(), text('2. two'))
    expect(docToMarkdown(doc)).toBe('one\n2\\. two')
    expect(markdownToDoc(docToMarkdown(doc)).eq(doc)).toBe(true)
  })

  it('keeps a heading that ends in a hash', () => {
    const doc = nodes.doc.create(null, nodes.heading.create({ level: 2 }, text('Use C#')))
    expect(docToMarkdown(doc)).toBe('## Use C#')
    expect(markdownToDoc('## Use C#').eq(doc)).toBe(true)
  })
})

// ---------------------------------------------------------------- generated documents

const { nodes, marks } = bodySchema
const word = fc.stringMatching(/^[a-z0-9*_`[\]()!@#\\+.>~-]{1,5}$/)
type Token = { word: string; strong: boolean; em: boolean; code: boolean; link: boolean }
const token = fc.record({
  word,
  strong: fc.boolean(),
  em: fc.boolean(),
  code: fc.boolean(),
  link: fc.boolean(),
})
const mention = fc.constantFrom(
  nodes.mention.create({ target: 'metric:orders', label: 'Orders' }),
  nodes.mention.create({ target: 'val:market/norway', label: 'Norway' }),
)

/**
 * A line of words with marks. The reader's own limits are left out: a `]` cannot sit in a link's
 * words, and a bold or italic word cannot hold `_` as well as `*`.
 */
function inline(tokens: readonly Token[], mentions: readonly Node[], breaks: boolean): Node[] {
  const out: Node[] = []
  tokens.forEach((t, index) => {
    const on: Mark[] = []
    let value = t.word
    if (t.link) {
      on.push(marks.link.create({ href: 'https://example.com/a' }))
      value = value.replace(/]/g, 'x')
    }
    if (t.strong) on.push(marks.strong.create())
    if (t.em) on.push(marks.em.create())
    if (t.strong || t.em) value = value.replace(/_/g, 'u')
    // The reader finds the end of bold by the next `**` even inside a code span, so code in bold
    // italic cannot hold an asterisk.
    if (t.strong && t.em && t.code) value = value.replace(/\*/g, 's')
    // A code span around two backticks needs a fence of three, which starts a code block when
    // it opens a line.
    if (t.code && !t.link) {
      on.push(marks.code.create())
      value = value.replace(/``+/g, '`')
    }
    if (index > 0) {
      const gap = breaks && index % 4 === 0 ? nodes.hard_break.create() : bodySchema.text(' ')
      out.push(gap)
    }
    out.push(bodySchema.text(value, on))
    const chip = mentions[index]
    if (chip && index % 3 === 1) out.push(bodySchema.text(' '), chip)
  })
  return out
}

const line = (breaks: boolean) =>
  fc
    .tuple(fc.array(token, { minLength: 1, maxLength: 6 }), fc.array(mention, { maxLength: 6 }))
    .map(([tokens, mentions]) => inline(tokens, mentions, breaks))

const block = fc.oneof(
  line(true).map((content) => nodes.paragraph.create(null, content)),
  fc
    .tuple(fc.constantFrom(2, 3), line(false))
    .map(([level, content]) => nodes.heading.create({ level }, content)),
  fc
    .tuple(fc.boolean(), fc.array(line(false), { minLength: 1, maxLength: 3 }))
    .map(([ordered, items]) =>
      (ordered ? nodes.ordered_list : nodes.bullet_list).create(
        null,
        items.map((item) => nodes.list_item.create(null, nodes.paragraph.create(null, item))),
      ),
    ),
  line(true).map((content) => nodes.blockquote.create(null, nodes.paragraph.create(null, content))),
  fc
    .stringMatching(/^[a-z*_`~ ]{1,12}(\n[a-z*_`~ ]{1,12}){0,2}$/)
    .map((code) => nodes.code_block.create(null, bodySchema.text(code))),
)

describe('generated bodies', () => {
  it('come back as the same document, and the writing is stable', () => {
    fc.assert(
      fc.property(fc.array(block, { minLength: 1, maxLength: 4 }), (blocks) => {
        const doc = nodes.doc.createChecked(null, blocks)
        const written = docToMarkdown(doc)
        const back = markdownToDoc(written)
        expect(back.toJSON()).toEqual(doc.toJSON())
        expect(docToMarkdown(back)).toBe(written)
      }),
      { numRuns: 500 },
    )
  })
})
