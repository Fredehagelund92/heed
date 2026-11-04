import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SitePage } from '../lib/pages.ts'
import { checkSite } from '../scripts/check-site.ts'

let dist: string
const pages = [{ slug: 'privacy', title: 'Privacy' }] as SitePage[]

function write(path: string, text: string) {
  mkdirSync(dirname(join(dist, path)), { recursive: true })
  writeFileSync(join(dist, path), text)
}

const body = (html: string) =>
  `<html><body><div class="sl-markdown-content">${html}</div></body></html>`

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'heed-docs-check-'))
  write('privacy/index.html', body('<h2 id="kept">Kept</h2>'))
  write('llms.txt', '- [Privacy](/v0.1/privacy/): what is kept')
  write('llms-full.txt', 'Privacy')
  write('pagefind/pagefind.js', '')
})
afterEach(() => rmSync(dist, { recursive: true }))

describe('the built site', () => {
  it('passes when every link goes somewhere', () => {
    write(
      'index.html',
      body('<a href="/v0.1/privacy/#kept">Kept</a> <a href="https://example.com">Out</a>'),
    )
    expect(checkSite(dist, '/v0.1', pages)).toEqual([])
  })

  it('fails on a page that is not there', () => {
    write('index.html', body('<a href="/v0.1/gone/">Gone</a>'))
    expect(checkSite(dist, '/v0.1', pages)).toEqual(['index.html: "/v0.1/gone/" opens nothing'])
  })

  it('fails on a heading that is not there', () => {
    write('index.html', body('<a href="/v0.1/privacy/#gone">Gone</a>'))
    expect(checkSite(dist, '/v0.1', pages)[0]).toContain('names no heading there')
  })

  it("fails on a link outside the version's path", () => {
    write('index.html', body('<a href="/privacy/">Wrong</a>'))
    expect(checkSite(dist, '/v0.1', pages)[0]).toContain("outside the site's path")
  })

  it('fails on anything loaded from another host', () => {
    write('index.html', body('<script src="https://cdn.example.com/a.js"></script>'))
    expect(checkSite(dist, '/v0.1', pages)[0]).toContain('from another host')
  })

  it('fails on a <title> tag in the body of a page', () => {
    write('index.html', body('<p>Open in Heed -</p><title>: <url></title>'))
    expect(checkSite(dist, '/v0.1', pages)[0]).toContain('<title> tag')
  })

  it('fails on a page missing from the site or from llms.txt', () => {
    rmSync(join(dist, 'privacy'), { recursive: true })
    write('llms.txt', 'nothing')
    expect(checkSite(dist, '/v0.1', pages)).toEqual([
      'privacy: the page was not built',
      'privacy: llms.txt does not list Privacy',
    ])
  })
})
