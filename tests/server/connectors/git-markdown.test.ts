import { describe, expect, it } from 'vitest'
import { fileLink, scopeOf, titleOf } from '../../../src/connectors/git-markdown/runtime.ts'

describe('Markdown in Git', () => {
  const config = { repository: 'https://github.com/acme/handbook.git', ref: 'main' }
  it('links a file on its host at the commit it was read at', () => {
    expect(fileLink(config, 'abc', 'docs/sales/orders in norway.md')).toBe(
      'https://github.com/acme/handbook/blob/abc/docs/sales/orders%20in%20norway.md',
    )
    expect(
      fileLink({ ...config, repository: 'https://gitlab.com/acme/handbook.git' }, 'abc', 'a.md'),
    ).toBe('https://gitlab.com/acme/handbook/-/blob/abc/a.md')
    expect(
      fileLink({ ...config, repository: 'https://bitbucket.org/acme/handbook' }, 'abc', 'a.md'),
    ).toBe('https://bitbucket.org/acme/handbook/src/abc/a.md')
    expect(
      fileLink(
        { ...config, fileLink: 'https://git.example.test/h/src/commit/{commit}/{path}' },
        'abc',
        'a.md',
      ),
    ).toBe('https://git.example.test/h/src/commit/abc/a.md')
    // A repository over plain http has no link to give, unless one is set.
    expect(
      fileLink({ ...config, repository: 'http://127.0.0.1:3000/h.git' }, 'abc', 'a.md'),
    ).toBeNull()
  })

  it('titles a document by its first top heading, or by its file name', () => {
    expect(titleOf('Intro\n\n# Orders in Norway #\n\n# Later', 'docs/x.md')).toBe(
      'Orders in Norway',
    )
    expect(titleOf('## Not a top heading\n\nWords.', 'docs/sales/orders-in_norway.md')).toBe(
      'Orders in norway',
    )
  })

  it('puts a file in the deepest chosen folder it is in', () => {
    const scopes = [
      { id: '.', title: 'docs', domain: 'general' },
      { id: 'sales', title: 'docs/sales', domain: 'sales' },
      { id: 'sales/emea', title: 'docs/sales/emea', domain: 'emea' },
    ]
    expect(scopeOf(scopes, 'sales/emea/norway.md')?.domain).toBe('emea')
    expect(scopeOf(scopes, 'sales/orders.md')?.domain).toBe('sales')
    expect(scopeOf(scopes, 'salesforce.md')?.domain).toBe('general')
    expect(scopeOf(scopes.slice(1), 'marketing/spend.md')).toBeNull()
  })
})
