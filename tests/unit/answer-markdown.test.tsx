import { readFileSync } from 'node:fs'
import type * as Router from '@tanstack/react-router'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { removedNotice } from '../../src/contract/assistant.ts'
import { AnswerMarkdown } from '@/components/assistant/answer-markdown'
import type { MentionRenderer } from '@/components/form/markdown'
import {
  answerHref,
  internalPath,
  nextArrivals,
  parseAnswer,
  readStreaming,
  tidyAnswer,
  type StreamingReading,
} from '@/lib/answer-markdown'
import { answerAsMarkdown, answerMarkup, readAnswer, REMOVED_TARGET } from '@/lib/assistant'
import { answerFixtures, FIXTURE_FACT } from '@/mocks/answers'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useRouter: () => ({ navigate }),
}))

/*
  The assistant's answers as people read them: GitHub-flavoured Markdown from a standard parser,
  tolerant of the ways a model writes a table, safe (no HTML, no image, no unsafe link), and
  steady while it streams. The fixtures are realistic answers (mocks/answers.ts), the first one
  word for word from a real one.
*/

const mention: MentionRenderer = ({ label, target }) => <span data-mention={target}>{label}</span>

function view(source: string, props: Partial<ComponentProps<typeof AnswerMarkdown>> = {}) {
  return render(<AnswerMarkdown source={source} renderMention={mention} {...props} />).container
}

const rowsOf = (table: Element | null) =>
  [...(table?.querySelectorAll('tr') ?? [])].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim()),
  )

describe('a real answer: the five domains', () => {
  const answer = answerFixtures.domains.text

  it('draws the table that follows its sentence, with no blank line between them', () => {
    const page = view(answer)
    const tables = page.querySelectorAll('table')
    expect(tables).toHaveLength(1)
    expect(rowsOf(tables[0]!)).toEqual([
      ['Domain', 'What it is', 'Facts', 'Owners', 'Needs checking', 'Open gaps'],
      ['Sales', 'Orders, revenue and the basket', '323', 'Jon Abara, Sofia Brandt', '26', '4'],
      ['Marketing', 'Acquisition and discounts', '342', 'Tomas Eriksen', '31', '1'],
      ['Sandbox', 'The demo domain', '82', 'Jon Abara', '9', '0'],
      [
        'Customer value',
        'Customers over their lifetime',
        '290',
        'Noor Haddad (Alex Moreau)',
        '18',
        '1',
      ],
      ['Paid media', 'Buying ads', '263', 'Priya Nair', '12', '1'],
    ])
    expect(page.textContent).not.toContain('|')
  })

  it('ends the table at the first line without a cell, where GFM would add a row', () => {
    const page = view(answer)
    const after = [...page.querySelectorAll('p')].map((p) => p.textContent)
    expect(after[0]).toBe('Heed has five domains, as of edition 2026-10-07.2.')
    expect(after[1]).toContain('Marketing and Sales hold the most items')
    expect(after[1]).toContain("Do you want a closer look at one domain? If you don't say")
    // Each line the model wrote stays its own line.
    expect(page.querySelectorAll('p br')).toHaveLength(2)
  })

  it('links the page path to the page in the app, without a new tab', () => {
    const link = view(answer).querySelector('a')
    expect(link?.getAttribute('href')).toBe('/library?view=attention')
    expect(link?.textContent).toBe('/library?view=attention')
    expect(link?.getAttribute('target')).toBeNull()
    expect(link?.closest('p')?.textContent).toContain('in Needs a look (/library?view=attention).')
  })

  it('right-aligns the columns of numbers, in tabular numerals, and keeps the first in view', () => {
    const [table] = parseAnswer(answer).filter((block) => block.type === 'table')
    expect(table?.type === 'table' && table.align).toEqual([
      null,
      null,
      'right',
      null,
      'right',
      'right',
    ])
    const cells = view(answer).querySelectorAll('tbody tr:first-child > *')
    expect(cells[0]?.tagName).toBe('TH')
    expect(cells[0]?.getAttribute('scope')).toBe('row')
    expect(cells[0]?.className).toContain('sticky')
    expect(cells[2]?.className).toContain('tabular-nums')
  })
})

describe('tidying a model’s tables before they are read', () => {
  it('puts a blank line before a table and after it', () => {
    expect(tidyAnswer('Intro.\n| a | b |\n|---|---|\n| 1 | 2 |\nAfter.')).toBe(
      'Intro.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter.',
    )
  })

  it('leaves a table that is already apart, and anything in a code block, as it is', () => {
    const apart = 'Intro.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.'
    expect(tidyAnswer(apart)).toBe(apart)
    const fenced = '```\nIntro.\n| a | b |\n|---|---|\nAfter.\n```'
    expect(tidyAnswer(fenced)).toBe(fenced)
  })

  it('does not start a table where the delimiter line has another number of cells', () => {
    const source = 'Intro.\n| a | b |\n|---|\nAfter.'
    expect(tidyAnswer(source)).toBe(source)
    expect(view(source).querySelector('table')).toBeNull()
  })

  it('keeps an escaped pipe in its cell, and a table without outer pipes', () => {
    const page = view('Value | Meaning\n--- | ---\n`a \\| b` | either one')
    expect(rowsOf(page.querySelector('table'))).toEqual([
      ['Value', 'Meaning'],
      ['a | b', 'either one'],
    ])
  })
})

describe('while the answer streams', () => {
  const table = '| Domain | Items |\n|---|---|\n| Sales | 323 |'

  it('holds back a header until its delimiter line comes, so no line of pipes shows first', () => {
    for (const partial of ['Intro.\n| Domain | Items |', 'Intro.\n| Domain | Items |\n|---']) {
      const page = view(partial, { streaming: true })
      expect(page.textContent).toBe('Intro.')
      expect(page.querySelector('table')).toBeNull()
    }
  })

  it('shows the table, row by row, once its delimiter line has come', () => {
    const page = view(`Intro.\n${table}`, { streaming: true })
    expect(rowsOf(page.querySelector('table'))).toEqual([
      ['Domain', 'Items'],
      ['Sales', '323'],
    ])
  })

  it('shows every word once it has finished, table or not', () => {
    expect(view('Intro.\n| not | a table', { streaming: false }).textContent).toBe(
      'Intro.| not | a table',
    )
    expect(view('```\n| a | b |', { streaming: true }).querySelector('code')?.textContent).toBe(
      '| a | b |',
    )
  })
})

/** Reads an answer update by update, as it streams, and returns the last reading. */
function streamed(...updates: string[]): StreamingReading {
  let reading: StreamingReading | null = null
  for (const source of updates)
    reading = readStreaming(source, { streaming: true, before: reading })
  return reading!
}

describe('each checked sentence settles in as it arrives', () => {
  it('marks the whole of an answer first read while it streams, and nothing of a finished one', () => {
    expect(streamed('First sentence.').blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'First sentence.' }], arrive: 0 },
    ])
    expect(readStreaming('First sentence.', { streaming: false, before: null }).blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'First sentence.' }] },
    ])
  })

  it('marks only the words a sentence adds to a paragraph, where its update starts', () => {
    const reading = streamed('One. ', 'One. Two. ', 'One. Two. Three.')
    expect(reading.arrivals).toEqual([0, 5, 10])
    expect(reading.blocks).toEqual([
      {
        type: 'paragraph',
        arrive: 0,
        children: [
          { type: 'text', text: 'One. ' },
          { type: 'arrive', at: 5, children: [{ type: 'text', text: 'Two. ' }] },
          { type: 'arrive', at: 10, children: [{ type: 'text', text: 'Three.' }] },
        ],
      },
    ])
  })

  it('marks a new paragraph, list item or table row as a whole, not what it holds', () => {
    const paragraphs = streamed('One.\n\n', 'One.\n\nTwo, with **bold** words.').blocks
    expect(paragraphs.map((block) => block.arrive)).toEqual([0, 6])
    const second = paragraphs[1]
    expect(second?.type === 'paragraph' && JSON.stringify(second.children)).not.toContain('arrive')

    const [list] = streamed('- One\n', '- One\n- Two\n').blocks
    expect(list?.type === 'list' && list.items.map((item) => item.arrive)).toEqual([undefined, 6])

    const first = '| Domain | Items |\n|---|---|\n| Sales | 323 |\n'
    const [table] = streamed(first, `${first}| Sandbox | 82 |\n`).blocks
    expect(table?.type === 'table' && table.rows.map((row) => row.arrive)).toEqual([
      undefined,
      first.length,
    ])
  })

  it('keeps a cited fact and a page path whole in the words that bring them', () => {
    const fact = '@[Payment provider switched](item:itm_wsd3duw0)'
    const [paragraph] = streamed(
      'One. ',
      `One. It names ${fact} and /library?view=attention.`,
    ).blocks
    const added = paragraph?.type === 'paragraph' ? paragraph.children[1] : null
    expect(added).toEqual({
      type: 'arrive',
      at: 5,
      children: [
        { type: 'text', text: 'It names ' },
        { type: 'mention', label: 'Payment provider switched', target: 'item:itm_wsd3duw0' },
        { type: 'text', text: ' and ' },
        {
          type: 'link',
          href: '/library?view=attention',
          internal: true,
          children: [{ type: 'text', text: '/library?view=attention' }],
        },
        { type: 'text', text: '.' },
      ],
    })
  })

  it('counts an update from the first character tidying changed, dropping later starts', () => {
    expect(nextArrivals([0, 10], 'One. Two. Three.', 'One. Two. Three. Four.')).toEqual([0, 10, 16])
    expect(nextArrivals([0, 10, 16], 'One. Two. Three.x', 'One. Two. Thr and more')).toEqual([
      0, 10, 13,
    ])
    expect(nextArrivals([0, 10], 'One. Two.', 'One. Two.')).toEqual([0, 10])
  })

  it('settles new words in on screen, and leaves what was there and a finished answer still', () => {
    const { container, rerender } = render(
      <AnswerMarkdown source="One. " streaming renderMention={mention} />,
    )
    const paragraph = container.querySelector('p')!
    expect(paragraph.className).toContain('animate-arrive')
    rerender(<AnswerMarkdown source="One. Two. " streaming renderMention={mention} />)
    const two = container.querySelector('p > span.animate-arrive')!
    expect(two.textContent).toBe('Two.')
    rerender(<AnswerMarkdown source="One. Two. Three." streaming renderMention={mention} />)
    const spans = container.querySelectorAll('p > span.animate-arrive')
    expect([...spans].map((span) => span.textContent)).toEqual(['Two. ', 'Three.'])
    // The words that came before are the same element: they do not settle in again.
    expect(spans[0]).toBe(two)
    expect(container.querySelector('p')).toBe(paragraph)
    rerender(<AnswerMarkdown source="One. Two. Three." renderMention={mention} />)
    expect(container.querySelectorAll('p > span.animate-arrive')[1]).toBe(spans[1])

    expect(view('One. Two.').querySelector('.animate-arrive')).toBeNull()
  })
})

describe('every kind of Markdown an answer uses', () => {
  it('draws headings under the answer’s place in the page, bold, italic and strikethrough', () => {
    const page = view(answerFixtures.prose.text)
    expect(page.querySelector('h3')?.textContent).toBe('What changed')
    expect(page.querySelector('h4')?.textContent).toBe('What to do')
    expect(page.querySelector('strong')?.textContent).toBe('Mostly, with one caveat.')
    expect([...page.querySelectorAll('em')].map((node) => node.textContent)).toEqual([
      'except',
      'not',
    ])
    expect(page.querySelector('del')?.textContent).toBe('The weekly pack already says so.')
  })

  it('draws ordered, nested and task lists', () => {
    const page = view(answerFixtures.lists.text)
    const ordered = page.querySelector('ol')
    expect(ordered?.children).toHaveLength(4)
    expect(ordered?.querySelector('ul li')?.textContent).toContain('Orders and Net revenue')
    expect(ordered?.querySelector('ul ul li')?.textContent).toBe(
      'and a product, if only one is affected',
    )
    const tasks = [...page.querySelectorAll('ul.list-none > li')].map((li) => li.textContent)
    expect(tasks).toEqual([
      'Done: What happened',
      'Done: Where it applies',
      'Not done: From when',
      'Not done: How you know',
    ])
    expect(page.querySelector('input')).toBeNull()
  })

  it('draws a table with its alignment, links, code and an escaped pipe in cells', () => {
    const page = view(answerFixtures.tables.text)
    const rows = rowsOf(page.querySelector('table'))
    expect(rows[3]).toEqual([
      'Field order_amount counts fees (gross | net)',
      'Guide',
      '1 Jan 2026',
      'open',
      'All',
    ])
    expect(page.querySelector('thead th:nth-child(2)')?.className).toContain('text-center')
    expect(page.querySelector('table a')?.getAttribute('href')).toBe(
      'https://regulator.example/notices/2026-08',
    )
    expect(page.querySelector('tbody code')?.textContent).toBe('order_amount')
  })

  it('keeps short values on one line, and pins the first column only when it holds names', () => {
    const facts = view(answerFixtures.tables.text)
    const [fact, kind, from] = facts.querySelectorAll('tbody tr:first-child > *')
    // A column of sentences wraps, and is not pinned: it would leave no room to scroll.
    expect(fact?.className).not.toContain('whitespace-nowrap')
    expect(fact?.className).not.toContain('sticky')
    expect(kind?.className).toContain('whitespace-nowrap')
    expect(from?.className).toContain('whitespace-nowrap')
    const domains = view(answerFixtures.domains.text)
    const [name, , , owner] = domains.querySelectorAll('tbody tr:first-child > *')
    expect(name?.className).toContain('sticky')
    expect(name?.className).toContain('whitespace-nowrap')
    expect(owner?.className).not.toContain('whitespace-nowrap')
  })

  it('lets a wide table scroll sideways in its own frame, which the keyboard can reach', () => {
    const frame = view(answerFixtures.wide.text).querySelector('[data-slot="answer-table"]')
    expect(frame?.className).toContain('overflow-x-auto')
    expect(frame?.getAttribute('tabindex')).toBe('0')
    expect(frame?.querySelectorAll('thead th')).toHaveLength(10)
  })

  it('draws code spans and blocks as typed', () => {
    const page = view(answerFixtures.code.text)
    expect(page.querySelector('p code')?.textContent).toBe('metric:net_revenue')
    expect(page.querySelector('pre code')?.textContent).toContain('"dimension_filters"')
  })

  it('draws a quote, hard line breaks and lines without a blank between them', () => {
    expect(view(answerFixtures.quote.text).querySelector('blockquote')?.textContent).toContain(
      'counted when settled',
    )
    const lines = view(answerFixtures.breaks.text).querySelector('p')
    expect(lines?.querySelectorAll('br')).toHaveLength(4)
  })

  it('keeps long words and emoji as written', () => {
    const page = view(answerFixtures.long.text)
    expect(page.textContent).toContain('👍')
    expect(page.textContent).toContain('daily_net_revenue_by_market_and_product_v2_snapshot')
    expect(page.querySelector('a')?.getAttribute('href')).toContain('wiki.example/display/FIN')
  })
})

describe('links in an answer', () => {
  it('open a page of Heed in the app, and any other safe address in a new tab', () => {
    const page = view(answerFixtures.links.text)
    const links = [...page.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    }))
    expect(links).toEqual([
      { href: '/try-it', target: null, rel: null },
      {
        href: 'https://regulator.example/notices/2026-08',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      { href: 'mailto:owner@example.test', target: '_blank', rel: 'noopener noreferrer' },
      { href: '/proposals?view=mine', target: null, rel: null },
      { href: '/settings?section=connect', target: null, rel: null },
    ])
    expect(page.textContent).toContain('like /etc/passwd or //evil.example, stays text')
    expect(page.textContent).toContain('[a script](javascript:alert(1))')
  })

  it('close the phone’s full-screen panel when they open a page of Heed', async () => {
    const onLeave = vi.fn()
    const page = view('Open [Health](/health).', { onLeave })
    await userEvent.click(page.querySelector('a')!)
    expect(onLeave).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith({ href: '/health' })
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    '//evil.example.com/library',
    '/\\evil.example.com',
    '/signed-out',
    '/connect/approve',
    '/design-preview',
    '/library\tx',
    'library',
  ])('never link to %j as a page of Heed', (href) => {
    expect(internalPath(href)).toBeNull()
    expect(answerHref(href)?.internal ?? false).toBe(false)
  })

  it('reach every page the assistant is told about, and only pages the app has', () => {
    const told = [
      '/library',
      '/catalogue',
      '/library/new',
      '/proposals',
      '/proposals?view=mine',
      '/proposals?view=review',
      '/try-it',
      '/settings?section=connect',
      '/gaps',
      '/library?view=attention',
      '/health',
      '/editions',
      '/editions/compare',
    ]
    for (const path of told) expect(internalPath(path)).toBe(path)
    // Every page of the app is reachable but the sign-in, the agent consent and the previews.
    const routes = readFileSync('src/web/routeTree.gen.ts', 'utf8')
    const paths = new Set(
      [...routes.matchAll(/fullPath: '(\/[^']*)'/g)].map((match) => match[1]!.replace(/\/$/, '')),
    )
    const never = /^\/(signed-out|connect|design-preview)\b|^$/
    for (const path of paths) {
      const concrete = path.replace(/\$\w+/g, 'x')
      expect(internalPath(concrete), path).toBe(never.test(path) ? null : concrete)
    }
  })
})

describe('an answer never runs what it holds', () => {
  it('shows raw HTML and an image as the text written', () => {
    const page = view(answerFixtures.unsafe.text)
    for (const tag of ['script', 'b', 'div[onclick]', 'img'])
      expect(page.querySelector(tag)).toBeNull()
    expect(page.textContent).toContain('<script>alert(1)</script>')
    expect(page.textContent).toContain('<div onclick="alert(1)">a block of HTML</div>')
    expect(page.textContent).toContain('![a chart](https://example.com/chart.png)')
  })
})

describe('the citation check’s marks in an answer', () => {
  const titleOf = () => FIXTURE_FACT.title

  it('draws a cited fact as its chip, in a table cell too', () => {
    const page = view(answerMarkup(answerFixtures.tables.text, titleOf))
    const chip = page.querySelector(
      `td [data-mention="item:${FIXTURE_FACT.id}"], th [data-mention="item:${FIXTURE_FACT.id}"]`,
    )
    expect(chip?.textContent).toBe(FIXTURE_FACT.title)
  })

  it('keeps a removed row a row of the table, across it, and the rows after it', () => {
    const page = view(answerMarkup(answerFixtures.removed.text, titleOf))
    const rows = page.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    const removed = rows[1]!.querySelector('td')
    expect(removed?.getAttribute('colspan')).toBe('2')
    expect(removed?.querySelector('[data-mention]')?.getAttribute('data-mention')).toBe(
      `${REMOVED_TARGET}unknown-item`,
    )
    expect(rows[2]?.textContent).toContain('Discount rules changed')
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/library?view=attention')
  })

  it('keeps a pipe in a title from splitting the cell its chip is in', () => {
    const page = view(
      answerMarkup(
        `| Fact | Applies |\n|---|---|\n| [${FIXTURE_FACT.id}] | Yes |`,
        () => 'Gross | net',
      ),
    )
    expect(rowsOf(page.querySelector('table'))[1]).toEqual(['Gross | net', 'Yes'])
  })

  it('copies the answer as Markdown other readers draw the same way', () => {
    const answer = readAnswer({
      id: 'a',
      role: 'assistant',
      parts: [{ type: 'text', text: answerFixtures.removed.text, state: 'done' }],
    })
    const copied = answerAsMarkdown(answer, {
      origin: 'https://heed.example',
      titleOf,
      scopeWords: null,
    })
    expect(copied).toContain('The facts about the United Kingdom in June:\n\n| Fact | Applies |')
    expect(copied).toContain(`| (I removed a sentence that named a fact I hadn’t read.) |`)
    expect(copied).toContain('| Discount rules changed | No: it is about Poland |\n\nOne more fact')
    expect(copied).not.toContain(removedNotice.unknown_item)
  })
})
