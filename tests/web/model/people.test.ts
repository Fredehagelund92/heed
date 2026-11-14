import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from '@/api/errors'
import {
  homeDomain,
  listOf,
  partyActions,
  soleOwnerOf,
  type Domain,
  type Domains,
  type Party,
  type Person,
} from '@/model/people'

// Where a person's new context starts, how a list of names reads in a sentence, which domains
// someone owns alone and what may be done to a member or an invite on the People page; a refusal
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
  const domains: Domains = { paid_media: domain('paid_media', ['Priya Nair']), sales }

  it('is the one member who owns it', () => {
    expect(soleOwnerOf('Priya Nair', domains)).toEqual(['paid_media'])
    expect(soleOwnerOf('Jon Abara', domains)).toEqual(['sales'])
    expect(soleOwnerOf('Ines Duarte', domains)).toEqual([])
  })
})

describe('what may be done to a member or an invite', () => {
  const member = (id: string, name: string, owns: string[], admin = false): Person => ({
    id,
    name,
    role: '',
    owns,
    admin,
  })
  const jon = member('p_jon', 'Jon Abara', ['sales'], true)
  const tomas = member('p_tomas', 'Tomas Eriksen', ['marketing'])
  const priya = member('p_priya', 'Priya Nair', ['paid_media'])
  const sofia = member('p_sofia', 'Sofia Brandt', ['sales'])
  const domains: Domains = {
    sales: domain('sales', ['Jon Abara', 'Sofia Brandt']),
    marketing,
    paid_media: domain('paid_media', ['Priya Nair']),
  }
  const as = (p: Person): Party => ({ kind: 'member', ...p })
  // Tomas invited Omar to own Marketing; the command line's invite has no sender.
  const omar: Party = {
    kind: 'invite',
    id: 'i_omar',
    email: 'omar@larchwood.example',
    admin: false,
    willOwn: ['marketing'],
    sentBy: 'p_tomas',
  }
  const cli: Party = { ...omar, id: 'i_cli', email: 'first@larchwood.example', sentBy: null }

  it("lets an admin change another member's role and domains, and remove them", () => {
    const a = partyActions(as(sofia), jon, domains)
    expect(a.role).toBe('can')
    expect(a.owners).toEqual({ sales: 'can', marketing: 'can', paid_media: 'can' })
    expect(a.resend).toBe('absent')
    expect(a.leave).toBe('can')
  })

  it('asks for a hand-over exactly when the member is the only owner of a domain', () => {
    expect(partyActions(as(priya), jon, domains).leave).toEqual({ handOver: ['paid_media'] })
    // Sofia owns Sales with Jon: she leaves without one.
    expect(partyActions(as(sofia), jon, domains).leave).toBe('can')
  })

  it('never lets someone change their own role or remove themselves', () => {
    const a = partyActions(as(jon), jon, domains)
    expect(a.role).toEqual({ locked: "You can't change your own role" })
    expect(a.leave).toEqual({ locked: "You can't remove yourself" })
  })

  it('lets an owner who is not an admin change owners of their own domain only', () => {
    const a = partyActions(as(sofia), tomas, domains)
    expect(a.role).toEqual({ locked: 'Only an admin changes roles' })
    expect(a.owners).toEqual({
      sales: { locked: 'Only its owners and admins add owners' },
      marketing: 'can',
      paid_media: { locked: 'Only its owners and admins add owners' },
    })
    expect(a.leave).toEqual({ locked: 'Only an admin removes people' })
  })

  it('has no role or domains to change on an invite: it keeps those it was sent with', () => {
    const a = partyActions(omar, jon, domains)
    expect(a.role).toBe('absent')
    expect(a.owners).toBe('absent')
  })

  it('lets an admin or its sender make a new link and take it back, never waiting on a hand-over', () => {
    expect(partyActions(omar, jon, domains)).toMatchObject({ resend: 'can', leave: 'can' })
    expect(partyActions(omar, tomas, domains)).toMatchObject({ resend: 'can', leave: 'can' })
    expect(partyActions(omar, priya, domains)).toMatchObject({
      resend: { locked: 'Only an admin or whoever sent it makes a new link' },
      leave: { locked: 'Only an admin or whoever sent it takes it back' },
    })
    // An invite with no sender is an admin's alone.
    expect(partyActions(cli, tomas, domains).leave).toEqual({
      locked: 'Only an admin or whoever sent it takes it back',
    })
  })

  it('lets a sender make a new link only while they still own its domains', () => {
    const moved = { ...tomas, owns: [] }
    expect(partyActions(omar, moved, domains)).toMatchObject({
      resend: { locked: 'Only an admin or whoever sent it makes a new link' },
      leave: 'can',
    })
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
