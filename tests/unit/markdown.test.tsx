import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from '@/components/form/markdown'
import { parseInline, parseMarkdown, safeHref } from '@/lib/markdown'

function html(source: string) {
  const { container } = render(<Markdown source={source} />)
  return container
}

describe('the Markdown renderer refuses what is unsafe', () => {
  it('never makes a script, and shows the tag as text', () => {
    const view = html('Hello <script>alert(1)</script> there')
    expect(view.querySelector('script')).toBeNull()
    expect(view.textContent).toContain('<script>alert(1)</script>')
  })

  it('never makes an image, with or without a link around it', () => {
    const view = html(
      '![a cat](https://example.com/cat.png)\n\n[![x](https://e.com/i.png)](https://e.com)',
    )
    expect(view.querySelector('img')).toBeNull()
    expect(view.textContent).toContain('![a cat](https://example.com/cat.png)')
  })

  it('never makes a table', () => {
    const view = html('| Market | Share |\n| --- | --- |\n| Norway | 40% |')
    expect(view.querySelector('table')).toBeNull()
    expect(view.textContent).toContain('| Norway | 40% |')
  })

  it('never passes raw HTML through', () => {
    const view = html(
      '<b>bold</b> <img src=x onerror="alert(1)"> <iframe src="https://e.com"></iframe> <a href="https://e.com">x</a>',
    )
    for (const tag of ['b', 'img', 'iframe', 'a']) expect(view.querySelector(tag)).toBeNull()
    expect(view.querySelectorAll('[onerror]')).toHaveLength(0)
    expect(view.textContent).toContain('<b>bold</b>')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '/relative/path',
    '//evil.example.com',
    '#top',
  ])('never links to %j', (href) => {
    const view = html(`[click me](${href})`)
    expect(view.querySelector('a')).toBeNull()
    expect(safeHref(href)).toBeNull()
  })

  it('opens allowed links in a new tab, without an opener, with an external icon', () => {
    const view = html('Read [the notice](https://regulator.example/notices/2026-08).')
    const link = view.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://regulator.example/notices/2026-08')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link?.querySelector('svg')).not.toBeNull()
    expect(link?.textContent).toContain('(opens in a new tab)')
    expect(safeHref('mailto:owner@example.test')).toBe('mailto:owner@example.test')
  })
})

describe('the Markdown renderer shows the allowed subset', () => {
  it('draws headings 2 and 3, and leaves other headings as text', () => {
    const view = html('## How to check\n\n### Step one\n\n# Not a heading\n\n#### Nor this')
    expect(view.querySelector('h2')?.textContent).toBe('How to check')
    expect(view.querySelector('h3')?.textContent).toBe('Step one')
    expect(view.querySelector('h1')).toBeNull()
    expect(view.querySelector('h4')).toBeNull()
    expect(view.textContent).toContain('# Not a heading')
  })

  it('moves heading levels under the page outline', () => {
    const { container } = render(<Markdown source={'## A\n\n### B'} headingOffset={1} />)
    expect(container.querySelector('h3')?.textContent).toBe('A')
    expect(container.querySelector('h4')?.textContent).toBe('B')
  })

  it('closes a code block only on a fence of the same sign, at least as long, with nothing after it', () => {
    const source = '````\n```\n~~~\n```` x\n  ````  \nafter'
    expect(parseMarkdown(source)).toEqual([
      { type: 'code', text: '```\n~~~\n```` x' },
      { type: 'paragraph', children: [{ type: 'text', text: 'after' }] },
    ])
    expect(parseMarkdown('~~~~\n~~~\n~~~~')).toEqual([{ type: 'code', text: '~~~' }])
  })

  it('draws bold, italic, inline code, lists, quotes and code blocks', () => {
    const view = html(
      [
        'Some **bold**, *italic*, _also_ and `code` here, but not snake_case_words.',
        '',
        '1. Compare the two',
        '2. Use the new tool',
        '',
        '- one',
        '- two',
        '',
        '> The regulator paused advertising from 15 June.',
        '',
        '```',
        '<b>kept as text</b>',
        '```',
      ].join('\n'),
    )
    expect(view.querySelector('strong')?.textContent).toBe('bold')
    expect([...view.querySelectorAll('em')].map((node) => node.textContent)).toEqual([
      'italic',
      'also',
    ])
    expect(view.querySelector('p code')?.textContent).toBe('code')
    expect(view.textContent).toContain('snake_case_words')
    expect(view.querySelectorAll('ol li')).toHaveLength(2)
    expect(view.querySelectorAll('ul li')).toHaveLength(2)
    expect(view.querySelector('blockquote')?.textContent).toContain('15 June')
    expect(view.querySelector('pre code')?.textContent).toBe('<b>kept as text</b>')
    expect(view.querySelector('pre b')).toBeNull()
  })

  it('reads a mention token as a mention, and shows its words', () => {
    expect(parseInline('Compare @[Norway](val:market/norway) now')).toEqual([
      { type: 'text', text: 'Compare ' },
      { type: 'mention', label: 'Norway', target: 'val:market/norway' },
      { type: 'text', text: ' now' },
    ])
    const view = html('Use @[Orders](metric:orders), not @[Old](metric:BAD).')
    // The chip prints the name; screen readers also hear its type (the chip's hidden suffix).
    expect(view.querySelector('[data-slot="mention-chip"]')?.textContent).toBe('Orders, metric')
    expect(view.textContent).toContain('@[Old](metric:BAD)')
  })

  it('keeps every typed character of text it refuses', () => {
    const source = 'A | b\n---|---\n<div>x</div> ![i](https://e.com/i.png) [j](javascript:x)'
    const text = parseMarkdown(source)
      .flatMap((block) => (block.type === 'paragraph' ? block.children : []))
      .map((node) => (node.type === 'text' ? node.text : ''))
      .join('')
    expect(text.replace(/\s/g, '')).toBe(source.replace(/\s/g, ''))
  })
})
