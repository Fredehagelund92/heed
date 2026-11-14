import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from '@/api/errors'
import { homeDomain, listOf, soleOwnerOf, type Domain, type Domains } from '@/model/people'

// Where a person's new context starts, how a list of names reads in a sentence, and which domains
// someone owns alone; a refusal
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

describe('the only owner of a domain', () => {
  // Omar is invited as an owner of Paid media: his address sits in its owners beside Priya's name.
  const paidMedia = domain('paid_media', ['Priya Nair', 'omar@larchwood.example'])
  const domains: Domains = { paid_media: paidMedia, sales }
  const people = [
    { name: 'Priya Nair' },
    { name: 'Jon Abara' },
    { name: 'omar@larchwood.example', invited: true },
  ]

  it('is still the one member who owns it, whoever is invited there too', () => {
    expect(soleOwnerOf('Priya Nair', domains, people)).toEqual(['paid_media'])
    expect(soleOwnerOf('Jon Abara', domains, people)).toEqual(['sales'])
  })

  it('is never an invite, so taking one back never waits on a hand-over', () => {
    expect(soleOwnerOf('omar@larchwood.example', domains, people)).toEqual([])
    const onlyInvited = { paid_media: domain('paid_media', ['omar@larchwood.example']) }
    expect(soleOwnerOf('omar@larchwood.example', onlyInvited, people)).toEqual([])
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

describe('a refusal for what is in the draft', () => {
  // The answer the real service gave for a source that is words, not a link (P04).
  const body = {
    status: 422,
    message: 'Fix the problems shown before you send it for review.',
    data: {
      findings: [
        { code: 'format', field: 'evidence.0.url', message: 'Invalid URL', severity: 'error' },
        {
          code: 'format',
          field: 'evidence.0.url',
          message: 'Invalid string: must match pattern /^https?:\\/\\//',
          severity: 'error',
        },
        {
          code: 'domain_mismatch',
          field: 'areaId',
          message: 'Cube puts Orders in Sales',
          severity: 'warning',
        },
      ],
    },
  }

  it('keeps each problem with its field, and leaves the warnings out', () => {
    const refused = toApiError(body)
    expect(refused.kind).toBe('invalid')
    expect(refused.findings.map((f) => [f.field, f.message])).toEqual([
      ['evidence.0.url', 'Invalid URL'],
      ['evidence.0.url', 'Invalid string: must match pattern /^https?:\\/\\//'],
    ])
  })

  it('names none when the service gave none', () => {
    expect(toApiError({ status: 422, message: 'Choose an active domain.' }).findings).toEqual([])
    expect(new ApiError('failed', 'No answer.').findings).toEqual([])
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
