import { describe, expect, it } from 'vitest'
import { slugAt } from '@/docs/place'
import { headOf, render, slugs } from '@/docs/render'
import { DOC_PAGES } from '@/lib/docs'

// The static docs site (npm run docs:build): which page an address opens, and every page drawn
// ahead of time, so it reads with no script.

describe('the docs site', () => {
  it('opens the page an address names, however the host writes it', () => {
    expect(slugAt('/docs', '/docs')).toBeUndefined()
    expect(slugAt('/docs/', '/docs')).toBeUndefined()
    expect(slugAt('/docs/index.html', '/docs')).toBeUndefined()
    expect(slugAt('/docs/privacy', '/docs')).toBe('privacy')
    expect(slugAt('/docs/privacy/', '/docs')).toBe('privacy')
    expect(slugAt('/docs/privacy.html', '/docs')).toBe('privacy')
    expect(slugAt('/privacy', '')).toBe('privacy')
    expect(slugAt('/elsewhere', '/docs')).toBeUndefined()
  })

  it('draws every page, with its title, its words and the lists it includes', () => {
    expect(slugs).toEqual([undefined, ...DOC_PAGES.map((p) => p.slug), 'changelog'])
    for (const slug of slugs) {
      const html = render(slug)
      expect(html, slug).toContain(`>${headOf(slug).title.replace("'", '&#x27;')}</h1>`)
    }
    expect(render('connect-an-agent')).toContain('claude mcp add --transport http')
    expect(render('answer-lines')).toContain('Nothing is written about this yet.')
    expect(render('tools')).toContain('suggest_context')
    expect(render('changelog')).toContain('<time dateTime="2026-10-23"')
    expect(render(undefined)).toContain('Documentation')
  })
})
