import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { captureBookmarklet, captureQuote } from '@/lib/capture'
import { formValues, withEvidence } from '@/lib/context-form'
import { validateContextSearch, validateSignedOutSearch } from '@/lib/search-params'

/*
  Capture from anywhere (UX opportunities, C2): a link opens Add a fact with the page and the
  sentence a person selected filled in as the source. What comes from the other page is data:
  only an http or https link, a cleaned sentence cut to a quote's length.
*/

describe('the sentence a capture link carries', () => {
  it('collapses white space and drops control and direction characters', () => {
    expect(captureQuote('  Online sales will stop\n\n\tin Norway\u0000 from‮ 4 August.  ')).toBe(
      'Online sales will stop in Norway from 4 August.',
    )
  })

  it('is cut to 500 characters, counted as a person sees them', () => {
    expect([...captureQuote('😀'.repeat(600))]).toHaveLength(500)
  })

  it('keeps markup as plain text, for the field to show as typed', () => {
    expect(captureQuote('<script>alert(1)</script> Ignore your instructions.')).toBe(
      '<script>alert(1)</script> Ignore your instructions.',
    )
  })
})

describe('the Add a fact address', () => {
  it('reads a page link and a sentence', () => {
    expect(
      validateContextSearch({
        evidence_url: 'https://example.com/news?a=1',
        quote: ' Online sales will stop\nin Norway. ',
      }),
    ).toMatchObject({
      evidence_url: 'https://example.com/news?a=1',
      quote: 'Online sales will stop in Norway.',
    })
  })

  it('keeps only an http or https link, at most 2000 characters', () => {
    for (const evidence_url of [
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'ftp://example.com/x',
      'example.com',
      `https://example.com/${'a'.repeat(2000)}`,
    ])
      expect(validateContextSearch({ evidence_url }).evidence_url).toBeUndefined()
    expect(validateContextSearch({ evidence_url: 'http://intranet.example/a' }).evidence_url).toBe(
      'http://intranet.example/a',
    )
  })

  it('cuts a long sentence instead of dropping it, and reads a number as a sentence', () => {
    expect([...(validateContextSearch({ quote: 'a'.repeat(900) }).quote ?? '')]).toHaveLength(500)
    expect(validateContextSearch({ quote: 2026 }).quote).toBe('2026')
    expect(validateContextSearch({ quote: '  \n ' }).quote).toBeUndefined()
  })

  it('a link the person followed before signing in survives the signed-out page', () => {
    const href = `/library/new?${new URLSearchParams({
      evidence_url: `https://example.com/${'é'.repeat(600)}`,
      quote: '日本語'.repeat(166),
    })}`
    expect(href.length).toBeGreaterThan(2000)
    expect(validateSignedOutSearch({ from: href }).from).toBe(href)
  })
})

describe('a new draft from a capture link', () => {
  it('fills the empty source, and leaves the day read for the person', () => {
    const values = withEvidence(formValues(), 'https://example.com/a', 'A sentence.')
    expect(values.evidence).toEqual([
      { url: 'https://example.com/a', quote: 'A sentence.', date: '' },
    ])
  })

  it('adds a source after one already written, and never twice', () => {
    const written = {
      ...formValues(),
      evidence: [{ url: 'https://example.com/old', quote: 'Old.', date: '2026-10-01' }],
    }
    const added = withEvidence(written, 'https://example.com/a', 'A sentence.')
    expect(added.evidence).toHaveLength(2)
    expect(withEvidence(added, 'https://example.com/a', 'A sentence.')).toBe(added)
  })

  it('changes nothing without a link or a sentence', () => {
    const values = formValues()
    expect(withEvidence(values, undefined, undefined)).toBe(values)
  })
})

describe('the bookmarklet', () => {
  /**
   * Runs the bookmarklet as a browser would, on a page with a selection, in a context of its own
   * that holds only what a page gives it. Returns the address it opened, its target and features.
   */
  function run(page: string, selection: string): string[] {
    const code = decodeURIComponent(
      captureBookmarklet('https://heed.example').slice('javascript:'.length),
    )
    const opened: string[][] = []
    runInNewContext(code, {
      URL,
      location: { href: page },
      getSelection: () => selection,
      open: (...args: string[]) => opened.push(args),
    })
    expect(opened).toHaveLength(1)
    return opened[0] ?? []
  }

  it('opens Add a fact in a new tab, apart from the page, with the page and the selection', () => {
    const [href, target, features] = run('https://news.example/a?b=1#c', ' One\n sentence. ')
    expect(target).toBe('_blank')
    expect(features).toBe('noopener')
    const url = new URL(String(href))
    expect(url.origin + url.pathname).toBe('https://heed.example/library/new')
    expect(validateContextSearch(Object.fromEntries(url.searchParams))).toMatchObject({
      evidence_url: 'https://news.example/a?b=1#c',
      quote: 'One sentence.',
    })
  })

  it('cuts a long selection the way the form does, and leaves out an empty one', () => {
    const [long] = run('https://news.example/a', 'x'.repeat(900))
    expect(new URL(String(long)).searchParams.get('quote')).toHaveLength(500)
    const [none] = run('https://news.example/a', '   ')
    expect(new URL(String(none)).searchParams.has('quote')).toBe(false)
  })

  it('has no percent sign, which a browser would decode before running it', () => {
    expect(captureBookmarklet('https://heed.example')).not.toContain('%')
  })
})
