import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from '@/api/errors'
import { homeDomain, listOf, type Domain } from '@/model/people'

// Where a person's new context starts, and how a list of names reads in a sentence; and a refusal
// that names the live items a publish has to say it relates to.

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
