import { describe, expect, it } from 'vitest'
import {
  charsetOf,
  decodeEntities,
  decodePage,
  pageText,
} from '../../../src/server/modules/web/index.ts'

/*
  A page's words as Heed reads them for a draft: decoded in the page's own character set (an old
  official page serves Windows-1252 and says so nowhere), its markup and scripts dropped, one
  paragraph per block.
*/

const latin1 = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'))
const utf8 = (text: string) => new TextEncoder().encode(text)

describe('the character set of a page', () => {
  it('reads the header, then a byte order mark, then the meta tag', () => {
    expect(charsetOf(utf8('x'), 'text/html; charset=ISO-8859-1')).toBe('windows-1252')
    expect(charsetOf(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), 'text/html')).toBe('utf-8')
    expect(charsetOf(utf8('<meta charset="windows-1252"><p>x'), 'text/html')).toBe('windows-1252')
    expect(
      charsetOf(
        utf8('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">'),
        'text/html',
      ),
    ).toBe('windows-1252')
  })

  it('reads bytes that name no set as UTF-8 when they are, else as Windows-1252', () => {
    expect(charsetOf(utf8('devolução'), 'text/html')).toBe('utf-8')
    // An old official page: "Art. 1º" and "devolução" in single bytes, no charset anywhere.
    const page = latin1('<p>Art. 1º&nbsp;Ficam os comerciantes obrigados a aceitar a devolução</p>')
    expect(charsetOf(page, 'text/html')).toBe('windows-1252')
    expect(decodePage(page, 'text/html')).toContain('devolução')
  })

  it('ignores a set it does not know', () => {
    expect(charsetOf(utf8('ok'), 'text/html; charset=klingon')).toBe('utf-8')
  })
})

describe('the words of a page', () => {
  it('decodes named and numbered references, and leaves unknown ones as written', () => {
    expect(decodeEntities('Art. 1&ordm;&nbsp;a&ccedil;&atilde;o &#231;&#xE7; &amp; &bogus;')).toBe(
      `Art. 1º${String.fromCharCode(0xa0)}ação çç & &bogus;`,
    )
    expect(decodeEntities('&#0; &#xD800; &#x110000;')).toBe('&#0; &#xD800; &#x110000;')
  })

  it('drops scripts, styles, navigation and comments, and starts a paragraph at each block', () => {
    const { title, paragraphs } = pageText(
      `<html><head><title>Regras de devolução &ndash; Consumidor</title><style>p{}</style></head>
       <body><nav>Menu</nav><script>alert("x")</script><!-- a comment -->
       <h1>Regras de devolução</h1><p>Art. 1º Ficam
       obrigados,<br>no prazo de 14 dias.</p><table><tr><td>a</td><td>b</td></tr></table></body></html>`,
      'html',
    )
    expect(title).toBe('Regras de devolução – Consumidor')
    // A line break in the markup is a space: the sentence stays whole.
    expect(paragraphs).toEqual([
      'Regras de devolução',
      'Art. 1º Ficam obrigados,',
      'no prazo de 14 dias.',
      'a b',
    ])
  })

  it('reads plain text by its lines', () => {
    expect(pageText('One.\r\n\r\nTwo  words.\n', 'text')).toEqual({
      title: null,
      paragraphs: ['One.', 'Two words.'],
    })
  })
})

describe('a hostile page', () => {
  it('is read in one pass: open elements, open comments and stray marks cost no second look', () => {
    const big = (piece: string) => piece.repeat(Math.ceil((2 * 1024 * 1024) / piece.length))
    for (const body of [big('<script>'), big('<!--'), big('<a '), big('<p>x<'), big('< ')]) {
      const started = performance.now()
      pageText(body, 'html')
      // About a second on a busy machine; scanning the rest again at each mark took minutes.
      expect(performance.now() - started, body.slice(0, 8)).toBeLessThan(10_000)
    }
  }, 60_000)

  it('keeps a stray "<" as text, and drops an element or a tag left open to the end', () => {
    expect(pageText('<p>a < b and 3<4</p><script>never', 'html').paragraphs).toEqual([
      'a < b and 3<4',
    ])
    expect(pageText('<p>Kept.</p><!-- never closed <p>Gone.', 'html').paragraphs).toEqual(['Kept.'])
    expect(pageText('<p>Kept.</p><a href="x', 'html').paragraphs).toEqual(['Kept.'])
  })
})
