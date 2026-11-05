import { describe, expect, it } from 'vitest'
import { linkContext, resolveLink } from '../lib/links.ts'
import {
  publishedPages,
  shownGroups,
  sidebar,
  siteGroups,
  sitePages,
  slugOf,
  unlistedHelpPages,
} from '../lib/pages.ts'

describe('the pages of the site', () => {
  const pages = sitePages()

  it('are the published list and no other', () => {
    expect(pages.map((page) => page.file).sort()).toEqual(
      publishedPages.map((page) => `docs/${page}.md`).sort(),
    )
  })

  it('leave no help page off the list', () => {
    expect(unlistedHelpPages()).toEqual([])
  })

  it('leave out the README of the help pages', () => {
    expect(pages.map((page) => page.slug)).not.toContain('README')
  })

  it('sit in the sidebar by group and order, with What is new last', () => {
    const groups = sidebar(pages)
    expect(groups.slice(0, -1).map((group) => 'label' in group && group.label)).toEqual(
      shownGroups(pages),
    )
    for (const group of groups) if ('items' in group) expect(group.items.length).toBeGreaterThan(0)
    expect(groups[0]).toMatchObject({
      items: [{ slug: 'get-started' }, { slug: 'connect-an-agent' }],
    })
    expect(groups.at(-1)).toEqual({ slug: 'changelog' })
  })

  it('skip a group that has no published page', () => {
    expect(shownGroups(pages)).toEqual(siteGroups)
    const onlyHelp = pages.filter((page) => page.file.startsWith('docs/help/'))
    expect(shownGroups(onlyHelp)).toEqual([
      'Start',
      'Write and review',
      'Set up',
      'How it works',
      'Reference',
    ])
    const labels = sidebar(onlyHelp).map((group) => 'label' in group && group.label)
    expect(labels).not.toContain('Run the service')
    expect(labels).not.toContain('Connectors')
  })

  it('open a page that is not published on GitHub, at the build reference', () => {
    const context = linkContext(pages, '/v0.1', 'v0.1.1')
    expect(resolveLink('../contributing/api.md#alerts', 'docs/help/tools.md', context)).toBe(
      'https://github.com/Fredehagelund92/heed/blob/v0.1.1/docs/contributing/api.md#alerts',
    )
    expect(resolveLink('privacy.md', 'docs/help/tools.md', context)).toBe('/v0.1/privacy/')
  })

  it('keep their address from their file', () => {
    expect(slugOf('help/privacy.md')).toBe('privacy')
    expect(slugOf('connectors/cube.md')).toBe('connectors/cube')
  })
})
