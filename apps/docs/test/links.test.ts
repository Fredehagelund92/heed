import { describe, expect, it } from 'vitest'
import { resolveLink, withResolvedLinks, type LinkContext } from '../lib/links.ts'

const context: LinkContext = {
  pages: new Map([
    ['docs/operations.md', 'operations'],
    ['docs/connectors/cube.md', 'connectors/cube'],
    ['docs/help/privacy.md', 'privacy'],
  ]),
  base: '/heed/v0.1',
  ref: 'v0.1.2',
  kind: (path) =>
    path === 'docs/templates'
      ? 'tree'
      : ['compose.yaml', 'README.md'].includes(path)
        ? 'blob'
        : undefined,
}

describe('a link in a page', () => {
  it('opens another page of the site at its address, with its heading', () => {
    expect(resolveLink('operations.md#run-it', 'docs/reference.md', context)).toBe(
      '/heed/v0.1/operations/#run-it',
    )
    expect(resolveLink('../operations.md', 'docs/connectors/cube.md', context)).toBe(
      '/heed/v0.1/operations/',
    )
    expect(resolveLink('help/privacy.md', 'docs/ai-sign-in.md', context)).toBe(
      '/heed/v0.1/privacy/',
    )
  })

  it('opens any other file on GitHub at the build reference', () => {
    expect(resolveLink('../compose.yaml', 'docs/self-hosting.md', context)).toBe(
      'https://github.com/Fredehagelund92/heed/blob/v0.1.2/compose.yaml',
    )
    expect(resolveLink('../README.md#quick-start', 'docs/operations.md', context)).toBe(
      'https://github.com/Fredehagelund92/heed/blob/v0.1.2/README.md#quick-start',
    )
    expect(resolveLink('templates', 'docs/operations.md', context)).toBe(
      'https://github.com/Fredehagelund92/heed/tree/v0.1.2/docs/templates',
    )
  })

  it('stops the build when the file is not there', () => {
    expect(() => resolveLink('gone.md', 'docs/operations.md', context)).toThrow(
      'docs/operations.md: a link to "gone.md", and docs/gone.md does not exist',
    )
    expect(() => resolveLink('../../../etc/passwd', 'docs/operations.md', context)).toThrow()
  })

  it('leaves web addresses and headings of the same page as they are', () => {
    for (const url of ['https://example.com/a', 'mailto:a@example.com', '#back-up'])
      expect(resolveLink(url, 'docs/operations.md', context)).toBe(url)
  })

  it('has no address for a screen of the app', () => {
    expect(resolveLink('/settings/agents', 'docs/help/privacy.md', context)).toBeUndefined()
  })
})

describe('a page read away from the site', () => {
  const site = { ...context, base: 'https://docs.example.com/v0.1' }

  it('takes whole addresses, and leaves code alone', () => {
    const body = [
      'See [the page](../operations.md), [here](#up) and [Compose](../../compose.yaml).',
      '',
      '`[not a link](operations.md)`',
      '',
      '```md',
      '[not a link](operations.md)',
      '```',
    ].join('\n')
    expect(withResolvedLinks(body, 'docs/connectors/cube.md', site).split('\n')[0]).toBe(
      'See [the page](https://docs.example.com/v0.1/operations/), ' +
        '[here](https://docs.example.com/v0.1/connectors/cube/#up) and ' +
        '[Compose](https://github.com/Fredehagelund92/heed/blob/v0.1.2/compose.yaml).',
    )
    const written = withResolvedLinks(body, 'docs/connectors/cube.md', site)
    expect(written).toContain('`[not a link](operations.md)`')
    expect(written).toContain('```md\n[not a link](operations.md)\n```')
  })

  it('keeps the words of a link to a screen of the app', () => {
    expect(
      withResolvedLinks('Open [Agents](/settings/agents).', 'docs/help/privacy.md', site),
    ).toBe('Open Agents.')
  })
})
