import { describe, expect, it } from 'vitest'
import { editorFieldOf, isLink, problemsOf, sourceProblem } from '@/lib/editor-problems'

describe("the service's reasons for refusing a draft, at the editor's fields", () => {
  it('finds the editor field for a stored field', () => {
    expect(editorFieldOf('evidence.0.url')).toBe('source')
    expect(editorFieldOf('evidence.0.quote')).toBe('source')
    expect(editorFieldOf('title')).toBe('title')
    expect(editorFieldOf('summary')).toBe('text')
    expect(editorFieldOf('bodyMarkup')).toBe('text')
    expect(editorFieldOf('scope')).toBe('where')
    expect(editorFieldOf('validity.end')).toBe('when')
    expect(editorFieldOf('notToConclude')).toBe('dont')
    expect(editorFieldOf('areaId')).toBe('domain')
    expect(editorFieldOf('claimLevel')).toBeNull()
  })

  // The refusal the real service gave for a source that is words, not a link (P04): two reasons
  // for the one field, in a validation library's stock words.
  it('says a source that is not a link in a sentence, once, at the source', () => {
    const problems = problemsOf([
      { field: 'evidence.0.url', message: 'Invalid URL' },
      { field: 'evidence.0.url', message: 'Invalid string: must match pattern /^https?:\\/\\// ' },
    ])
    expect(problems.at).toEqual({
      source: 'That is not a web link. Paste an address that starts with https://.',
    })
    expect(problems.elsewhere).toEqual([])
  })

  it("keeps the service's own sentence when it has one", () => {
    expect(
      problemsOf([{ field: 'scope', message: "We don't know the name metric:gone. Choose one." }])
        .at,
    ).toEqual({ where: "We don't know the name metric:gone. Choose one." })
  })

  it('tells a private detail in the text apart from a stock message', () => {
    expect(
      problemsOf([{ field: 'summary', message: 'Text matches email_address' }]).at.text,
    ).toMatch(/private detail/)
  })

  it('lists a reason with no field of its own apart', () => {
    const problems = problemsOf([{ field: 'claimLevel', message: 'The claim needs an authority.' }])
    expect(problems.at).toEqual({})
    expect(problems.elsewhere).toEqual(['The claim needs an authority.'])
  })
})

describe('a source is a link', () => {
  it('takes a web address and nothing else', () => {
    expect(isLink('https://customs.example/norway/notices/2026-08-04')).toBe(true)
    expect(isLink('http://wiki.example')).toBe(true)
    expect(isLink('Told by the finance team in the weekly meeting')).toBe(false)
    expect(isLink('finance.example/notes')).toBe(false)
    expect(isLink('https://')).toBe(false)
    expect(isLink('ftp://files.example/a')).toBe(false)
  })

  it('says nothing for an empty source or a link, and a sentence for words', () => {
    expect(sourceProblem('')).toBe('')
    expect(sourceProblem('  https://wiki.example/a  ')).toBe('')
    expect(sourceProblem('Told by the finance team')).toBe(
      'That is not a web link. Paste an address that starts with https://.',
    )
  })
})
