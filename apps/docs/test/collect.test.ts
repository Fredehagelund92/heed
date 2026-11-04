import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collect } from '../scripts/collect.ts'

let scratch: string
let pages: string

function build(words: string) {
  const built = join(scratch, `built-${words}`)
  mkdirSync(join(built, '_astro'), { recursive: true })
  writeFileSync(join(built, 'index.html'), words)
  writeFileSync(join(built, '404.html'), `404 ${words}`)
  writeFileSync(join(built, '_astro/page.js'), words)
  return built
}

const versions = () => JSON.parse(readFileSync(join(pages, 'versions.json'), 'utf8')) as unknown
const read = (path: string) => readFileSync(join(pages, path), 'utf8')

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'heed-docs-collect-'))
  pages = join(scratch, 'pages')
  mkdirSync(pages)
})
afterEach(() => rmSync(scratch, { recursive: true }))

describe('collecting the versions', () => {
  it('points the root at the newest release, by number', () => {
    collect(pages, build('nine'), 'v0.9')
    collect(pages, build('ten'), 'v0.10')
    collect(pages, build('main'), 'next')
    expect(versions()).toEqual({ latest: 'v0.10', versions: ['v0.10', 'v0.9', 'next'] })
    expect(read('index.html')).toContain('url=v0.10/')
    expect(read('404.html')).toBe('404 ten')
  })

  it('points the root at /next/ until there is a release', () => {
    collect(pages, build('main'), 'next')
    expect(versions()).toEqual({ latest: 'next', versions: ['next'] })
    expect(read('index.html')).toContain('url=next/')
  })

  it('lets a patch overwrite its minor, and leaves every other folder alone', () => {
    collect(pages, build('first'), 'v0.1')
    writeFileSync(join(pages, 'v0.1/old-file.html'), 'old')
    collect(pages, build('other'), 'v0.2')
    writeFileSync(join(pages, 'v0.2/kept.html'), 'kept')
    collect(pages, build('patch'), 'v0.1')
    expect(read('v0.1/index.html')).toBe('patch')
    expect(existsSync(join(pages, 'v0.1/old-file.html'))).toBe(false)
    expect(read('v0.2/kept.html')).toBe('kept')
    expect(versions()).toEqual({ latest: 'v0.2', versions: ['v0.2', 'v0.1'] })
  })

  it('keeps GitHub Pages from running Jekyll, which would drop _astro', () => {
    collect(pages, build('first'), 'v0.1')
    expect(existsSync(join(pages, '.nojekyll'))).toBe(true)
    expect(read('v0.1/_astro/page.js')).toBe('first')
  })

  it('refuses any other folder', () => {
    expect(() => collect(pages, build('first'), '../v0.1')).toThrow('no version folder')
  })
})
