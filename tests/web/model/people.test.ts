import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from '@/api/errors'
import { homeDomain, listOf, type Domain } from '@/model/people'

// Where a person's new context starts, and how a list of names reads in a sentence; a refusal
// that names the live items a publish has to say it relates to; and a request that got no reply.

const domain = (id: string, owners: string[] = [], sandbox = false): Domain => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  owners,
  covers: '',
  text: '',
  ...(sandbox ? { sandbox } : {}),
})
const sandbox = domain('sandbox', ['Jon Abara'], true)
const sales = domain('sales', ['Jon Abara'])
const marketing = domain('marketing', ['Tomas Eriksen'])

describe('where new context starts', () => {
  it('is a domain the person owns, the sandbox last', () => {
    expect(homeDomain({ owns: ['sandbox', 'sales'] }, [sandbox, marketing, sales])).toBe(sales)
    expect(homeDomain({ owns: ['sandbox'] }, [sandbox, marketing])).toBe(sandbox)
  })

  it("is the workspace's first real domain for someone who owns none", () => {
    expect(homeDomain({ owns: [] }, [sandbox, marketing, sales])).toBe(marketing)
  })

  it('is nothing in a workspace with no domains', () => {
    expect(homeDomain({ owns: ['sales'] }, [])).toBeUndefined()
  })
})

describe('names in a sentence', () => {
  it('joins them the way a person writes them', () => {
    expect(listOf([])).toBe('')
    expect(listOf(['Ravi Kapoor'])).toBe('Ravi Kapoor')
    expect(listOf(['Ravi Kapoor', 'Ella Voss'], 'or')).toBe('Ravi Kapoor or Ella Voss')
    expect(listOf(['Jon Abara', 'Sofia Brandt', 'Lars Dahl'])).toBe(
      'Jon Abara, Sofia Brandt and Lars Dahl',
    )
  })
})

describe('a refused publish', () => {
  it('keeps the live items the service named, and only well-formed ones', () => {
    const refused = toApiError({
      status: 422,
      message: 'Say how this relates to “Returns excludes test accounts” first.',
      data: {
        clashes: [
          { itemId: 'itm_returns01', title: 'Returns excludes test accounts' },
          { title: 1 },
        ],
      },
    })
    expect(refused.kind).toBe('invalid')
    expect(refused.retryable).toBe(false)
    expect(refused.clashes).toEqual([
      { itemId: 'itm_returns01', title: 'Returns excludes test accounts' },
    ])
  })

  it('names none when the service gave no list', () => {
    expect(toApiError({ status: 422, message: 'Choose an active domain.' }).clashes).toEqual([])
    expect(new ApiError('failed', 'No answer.').clashes).toEqual([])
  })
})

describe('a request that got no reply', () => {
  it("says a request that got no reply in a sentence, never the browser's words", () => {
    const failed = toApiError(new TypeError('Failed to fetch'))
    expect(failed.kind).toBe('unanswered')
    expect(failed.message).toBe("The service didn't reply.")
    expect(toApiError(new ApiError('unanswered', "You're offline.")).message).toBe(
      "You're offline.",
    )
  })
})

describe('a conflict', () => {
  it('is a refusal only when the service sent one, so a changed word is not a taken word', () => {
    const taken = toApiError({
      status: 409,
      message: '“Sales” is already another name for Net revenue, added by Ines Duarte.',
      data: { refusal: { code: 'taken', holder: 'Net revenue', by: 'Ines Duarte' } },
    })
    expect(taken.kind).toBe('conflict')
    expect(taken.refusal).toBe(true)
    const changed = toApiError({ status: 409, message: 'Someone changed this word first.' })
    expect(changed.kind).toBe('conflict')
    expect(changed.refusal).toBe(false)
    const other = toApiError({ status: 409, message: 'No.', data: { refusal: 'x' } })
    expect(other.refusal).toBe(false)
    expect(new ApiError('conflict', 'Taken.', { refusal: true }).refusal).toBe(true)
    expect(new ApiError('failed', 'No answer.').refusal).toBe(false)
  })
})
