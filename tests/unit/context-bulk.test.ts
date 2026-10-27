import { describe, expect, it } from 'vitest'
import {
  changeSummary,
  planBulk,
  type BulkInput,
  type BulkPerson,
  type BulkRow,
} from '../../src/domain/context-bulk.ts'

const names: Record<string, string> = { sales: 'Sales', marketing: 'Marketing' }
const domainName = (id: string) => names[id] ?? id
const jon: BulkPerson = { id: 'jon', name: 'Jon Abara', admin: false, owns: ['sales'] }
const ines: BulkPerson = { id: 'ines', name: 'Ines Duarte', admin: false, owns: [] }
const admin: BulkPerson = { id: 'ravi', name: 'Ravi Kapoor', admin: true, owns: [] }

const row = (id: string, patch: Partial<BulkRow> = {}): BulkRow => ({
  id,
  title: `Item ${id}`,
  kind: 'note',
  areaId: 'sales',
  status: 'live',
  owners: ['jon'],
  ...patch,
})
const plan = (rows: BulkRow[], input: BulkInput, me = jon, opened: string[] = []) =>
  planBulk(rows, input, me, { opened: new Set(opened), domainName })
const codes = (result: ReturnType<typeof plan>) => result.skipped.map((s) => [s.id, s.code])

describe('a change to many rows', () => {
  it("acts only on what the person may change: their domains' items, every item for an admin", () => {
    const rows = [row('a'), row('b', { areaId: 'marketing' })]
    const mine = plan(rows, { action: 'archive' })
    expect(mine.act.map((r) => r.id)).toEqual(['a'])
    expect(mine.skipped).toEqual([
      {
        id: 'b',
        title: 'Item b',
        code: 'not_allowed',
        why: 'owned by Marketing',
        message: 'Only owners of Marketing and admins can change it.',
      },
    ])
    expect(plan(rows, { action: 'archive' }, admin).act).toHaveLength(2)
    expect(plan(rows, { action: 'archive' }, ines).act).toHaveLength(0)
  })

  it('archives published items, and deletes only drafts', () => {
    const rows = [row('live'), row('old', { status: 'archived' }), row('new', { status: 'draft' })]
    expect(codes(plan(rows, { action: 'archive' }))).toEqual([
      ['old', 'archived'],
      ['new', 'draft'],
    ])
    expect(codes(plan(rows, { action: 'delete' }))).toEqual([
      ['live', 'published'],
      ['old', 'published'],
    ])
  })

  it('leaves alone what is already so: the same domain, the same kind', () => {
    const rows = [row('a'), row('b', { kind: 'guide' })]
    expect(plan(rows, { action: 'kind', kind: 'guide' }).skipped).toEqual([
      expect.objectContaining({ id: 'b', code: 'same_kind', message: 'It is a Guide already.' }),
    ])
    expect(plan(rows, { action: 'domain', areaId: 'sales' }).skipped[0]).toMatchObject({
      code: 'same_domain',
      why: 'already in Sales',
    })
  })

  it('names as owners only people who own the domain, once', () => {
    const rows = [row('a'), row('b', { owners: ['jon', 'ravi'] })]
    expect(plan(rows, { action: 'owner_add', person: ines }).skipped[0]).toMatchObject({
      code: 'not_owner_there',
      why: "Ines Duarte doesn't own Sales",
    })
    expect(codes(plan(rows, { action: 'owner_add', person: admin }))).toEqual([
      ['b', 'already_owner'],
    ])
    expect(codes(plan(rows, { action: 'owner_set', person: jon }))).toEqual([['a', 'only_owner']])
  })

  it('checks only live items the person opened', () => {
    const rows = [row('a'), row('b'), row('c', { status: 'draft' })]
    expect(codes(plan(rows, { action: 'check' }, jon, ['a']))).toEqual([
      ['b', 'not_opened'],
      ['c', 'draft'],
    ])
  })
})

describe('what a change says in History', () => {
  it('names the first item and how many more, in the words of the action', () => {
    expect(changeSummary({ action: 'archive' }, ['Webshop paused'], domainName)).toBe(
      'Archived “Webshop paused”.',
    )
    expect(
      changeSummary({ action: 'domain', areaId: 'marketing' }, ['A', 'B', 'C'], domainName),
    ).toBe('Moved “A” and 2 more to Marketing.')
    expect(changeSummary({ action: 'kind', kind: 'issue' }, ['A'], domainName)).toBe(
      'Made “A” a Warning.',
    )
  })
})
