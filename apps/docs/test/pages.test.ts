import { describe, expect, it } from 'vitest'
import { operatorPages, sidebar, siteGroups, sitePages, slugOf } from '../lib/pages.ts'

describe('the pages of the site', () => {
  const pages = sitePages()

  it('are the help pages, the operator pages and What is new', () => {
    const slugs = pages.map((page) => page.slug)
    expect(slugs).toEqual(expect.arrayContaining([...operatorPages, 'privacy', 'changelog']))
    expect(pages).toHaveLength(14 + operatorPages.length)
  })

  it('leave out what stays in the repository', () => {
    const slugs = pages.map((page) => page.slug)
    for (const slug of ['README', 'evaluations', 'development', 'connectors/packaging'])
      expect(slugs).not.toContain(slug)
  })

  it('sit in the sidebar by group and order, with What is new last', () => {
    const groups = sidebar(pages)
    expect(
      groups.slice(0, siteGroups.length).map((group) => 'label' in group && group.label),
    ).toEqual([...siteGroups])
    for (const group of groups) if ('items' in group) expect(group.items.length).toBeGreaterThan(0)
    expect(groups[0]).toMatchObject({
      items: [{ slug: 'get-started' }, { slug: 'connect-an-agent' }],
    })
    expect(groups.at(-1)).toEqual({ slug: 'changelog' })
  })

  it('keep their address from their file', () => {
    expect(slugOf('help/privacy.md')).toBe('privacy')
    expect(slugOf('connectors/cube.md')).toBe('connectors/cube')
  })
})
