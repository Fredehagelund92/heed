import { describe, expect, it } from 'vitest'
import type { CatalogueTerm, LibraryItem, Term, Thread } from '@contract/index'
import {
  bodyFromService,
  bodyToService,
  commentsOf,
  commentWhen,
  definitionsOf,
  factsOf,
  hitsOf,
  refusalOf,
  statusOf,
  termDefinitionsOf,
  validityOf,
  type Names,
  type People,
} from '@/api/http-map'
import { mentionNotesOf } from '@/model/comments'

const row = (patch: Partial<LibraryItem> = {}): LibraryItem => ({
  id: 'itm_norway01',
  kind: 'event',
  areaId: 'area_sales',
  status: 'accepted',
  version: 2,
  title: 'Norway stopped taking orders',
  summary: 'From 4 August.',
  scope: {
    metrics: ['orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'market', value: 'norway' }],
  },
  validity: { start: '2026-08-04', end: null },
  reviewDate: '2027-01-01',
  reviewQuestion: 'still_correct',
  checkFlag: null,
  ownerId: 'per_jon',
  proposerId: 'per_maria',
  updatedAt: '2026-10-01T09:00:00Z',
  lastChecked: { on: '2026-10-03', personId: 'per_jon' },
  trust: 'current',
  chips: ['Orders', 'Norway'],
  owners: [],
  opened: false,
  ...patch,
})

const names: Names = {
  person: (id) => ({ per_jon: 'Jon Abara', per_maria: 'Maria Lindqvist' })[id] ?? 'Someone',
  domainOwners: (areaId) => (areaId === 'area_sales' ? ['Jon Abara'] : []),
}

describe('reading the library index', () => {
  it('says the status in the app’s words, from the status and the trust', () => {
    expect(statusOf(row())).toBe('Live')
    expect(statusOf(row({ trust: 'needs_check' }))).toBe('Needs checking')
    expect(statusOf(row({ trust: 'ended' }))).toBe('Live')
    expect(statusOf(row({ status: 'retired', trust: 'ended' }))).toBe('Archived')
  })

  it('keeps the dates, the day before the end as the last one, and an issue still going on', () => {
    expect(validityOf(row())).toEqual({ from: '2026-08-04' })
    expect(validityOf(row({ validity: { start: '2026-08-04', end: '2026-09-01' } }))).toEqual({
      from: '2026-08-04',
      until: '2026-08-31',
    })
    expect(validityOf(row({ reviewQuestion: 'still_going_on' }))).toEqual({
      from: '2026-08-04',
      ongoing: true,
    })
  })

  it('reads a row as a context item: its scope by name, who checked it and when', () => {
    expect(factsOf([row()], names)).toEqual([
      {
        id: 'itm_norway01',
        title: 'Norway stopped taking orders',
        summary: 'From 4 August.',
        domain: 'area_sales',
        kind: 'event',
        where: ['Orders', 'Norway'],
        valid: { from: '2026-08-04' },
        when: 'From 4 Aug 2026',
        status: 'Live',
        checkedBy: 'Jon Abara',
        checkedOn: '3 Oct 2026',
        source: '',
        quote: '',
        dontConclude: '',
      },
    ])
  })

  it('names the owners an item has of its own, and none when they are its domain’s', () => {
    const [own] = factsOf([row({ owners: ['per_maria', 'per_jon'] })], names)
    expect(own!.owners).toEqual(['Maria Lindqvist', 'Jon Abara'])
    const [domain] = factsOf([row({ owners: ['per_jon'] })], names)
    expect(domain!.owners).toBeUndefined()
  })

  it('names the owner only when they are not one of the domain’s owners', () => {
    const [fact] = factsOf([row({ ownerId: 'per_maria' })], names)
    expect(fact!.owners).toEqual(['Maria Lindqvist'])
  })

  it('leaves out the kind the app does not offer, and says nothing for an item never checked', () => {
    const facts = factsOf(
      [row({ kind: 'example' }), row({ id: 'itm_b', lastChecked: null })],
      names,
    )
    expect(facts.map((f) => f.id)).toEqual(['itm_b'])
    expect(facts[0]).toMatchObject({ checkedBy: '', checkedOn: '' })
  })
})

describe('reading the catalogue', () => {
  const term = (patch: Partial<CatalogueTerm> = {}): CatalogueTerm =>
    ({
      key: 'metric:net_revenue',
      kind: 'metric',
      id: 'net_revenue',
      name: 'Net revenue',
      aliases: ['Turnover', 'Turnover'],
      group: { key: 'group:revenue', name: 'Revenue' },
      domain: { areaId: 'area_sales', source: 'vocabulary' },
      definition: {
        ref: 'cube:revenue.net_revenue',
        name: 'revenue.net_revenue',
        title: 'Net revenue',
        descriptionCopy: 'Revenue after returns and discounts.',
        valueType: 'number',
        state: 'current',
        renamedTo: null,
        changedAt: '2026-10-02T06:00:00Z',
        readAt: '2026-10-07T06:00:00Z',
        sourceId: 'cube',
        tool: 'Cube',
      },
      definitions: [],
      status: 'current',
      shelf: {
        items: 3,
        byKind: { note: 3, event: 0, guide: 0, example: 0, issue: 0 },
        needsALook: 0,
        activeIssues: 0,
        ended: 0,
        gaps: 0,
        mentionedBy: 1,
        lastUpdated: '2026-09-18T10:00:00Z',
      },
      ...patch,
    }) as CatalogueTerm

  it('reads a term as a synced definition, its other names once each', () => {
    expect(definitionsOf([term()])).toEqual([
      {
        name: 'Net revenue',
        type: 'metric',
        definition: 'Revenue after returns and discounts.',
        synced: true,
        tool: 'Cube',
        sourceNames: ['Turnover'],
        domain: 'area_sales',
        group: 'Revenue',
        changed: '2 Oct 2026',
        updated: '18 Sep 2026',
      },
    ])
  })

  it('says nothing of a definition the source never listed', () => {
    const [d] = definitionsOf([
      term({ definition: null, group: null, domain: { areaId: null, source: 'none' } }),
    ])
    expect(d).toMatchObject({ definition: '', synced: true })
    expect(d).not.toHaveProperty('tool')
    expect(d).not.toHaveProperty('domain')
    expect(d).not.toHaveProperty('changed')
  })
})

describe('reading search everywhere', () => {
  it('keeps the groups, without the kind the app does not offer', () => {
    expect(
      hitsOf({
        items: [
          {
            id: 'itm_a',
            kind: 'note',
            areaId: 'area_sales',
            status: 'accepted',
            title: 'A',
            summary: '',
          },
          {
            id: 'itm_b',
            kind: 'example',
            areaId: 'area_sales',
            status: 'accepted',
            title: 'B',
            summary: '',
          },
        ],
        definitions: [{ key: 'dim:market', kind: 'dimension', name: 'Market', aliases: [] }],
        domains: [{ id: 'area_sales', name: 'Sales' }],
        people: [{ id: 'p1', name: 'Jon Abara' }],
      }),
    ).toEqual({
      items: [{ id: 'itm_a', title: 'A', kind: 'note', domain: 'area_sales' }],
      definitions: [{ name: 'Market', type: 'dimension', sourceNames: [] }],
      domains: [{ id: 'area_sales', name: 'Sales' }],
      people: [{ name: 'Jon Abara' }],
    })
  })
})

describe('reading comments', () => {
  const people: People = {
    name: (id) => ({ p_jon: 'Jon Abara', p_ines: 'Ines Duarte' })[id] ?? 'Someone',
    idOf: (name) => ({ 'Jon Abara': 'p_jon', 'Ines Duarte': 'p_ines' })[name],
  }
  // Local times, so the words do not depend on the machine's time zone.
  const now = new Date(2026, 9, 8, 12, 0)
  const iso = (d: Date) => d.toISOString()

  it('writes times as the Inbox does', () => {
    expect(commentWhen(iso(new Date(2026, 9, 8, 11, 59, 30)), now)).toBe('Just now')
    expect(commentWhen(iso(new Date(2026, 9, 8, 9, 40)), now)).toBe('Today, 09:40')
    expect(commentWhen(iso(new Date(2026, 9, 7, 14, 20)), now)).toBe('Yesterday, 14:20')
    expect(commentWhen(iso(new Date(2026, 9, 1, 8, 0)), now)).toBe('1 Oct')
    expect(commentWhen(iso(new Date(2025, 11, 21, 8, 0)), now)).toBe('21 Dec 2025')
    expect(commentWhen('not a time', now)).toBe('')
  })

  const said = (id: string, label: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ask ' },
          { type: 'mention', attrs: { id, label } },
        ],
      },
    ],
  })

  it('names a mentioned person by id for the service, and by name for the app', () => {
    expect(bodyToService(said('person:Jon Abara', 'Jon Abara'), people)).toEqual(
      said('person:p_jon', 'Jon Abara'),
    )
    // A name the workspace doesn't know stays the words the author saw.
    expect(bodyToService(said('person:Nobody', 'Nobody'), people)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ask ' },
            { type: 'text', text: '@Nobody' },
          ],
        },
      ],
    })
    // The name as it is now, even when it changed since.
    expect(bodyFromService(said('person:p_ines', 'Ines'), people)).toEqual(
      said('person:Ines Duarte', 'Ines Duarte'),
    )
  })

  it('reads threads as the app keeps comments, for the person signed in', () => {
    const at = iso(new Date(2026, 9, 8, 9, 40))
    const jon = { personId: 'p_jon', name: 'Jon Abara' }
    const ines = { personId: 'p_ines', name: null }
    const threads: Thread[] = [
      {
        subject: 'context:itm_norway01',
        comments: [
          {
            id: 'c1',
            author: jon,
            returned: false,
            withdrew: false,
            body: said('person:p_ines', 'Ines'),
            at,
            editedAt: at,
            deleted: false,
            reactions: [{ emoji: '👍', by: [ines, jon] }],
            anchor: null,
            resolved: null,
            reopened: null,
            replies: [
              {
                id: 'c2',
                author: ines,
                returned: false,
                withdrew: false,
                body: { type: 'doc' },
                at,
                editedAt: null,
                deleted: true,
                reactions: [],
              },
            ],
          },
        ],
        reactions: [{ emoji: '🙏', by: [jon] }],
        withdrawable: false,
        newReply: { commentId: 'c1', from: jon, at, excerpt: 'Ask @Ines' },
        mentions: [{ commentId: 'c1', from: jon, at, excerpt: 'Ask @Ines' }],
      },
      {
        subject: 'review:0f8fad5b-d9cb-469f-a165-70867728950e',
        comments: [
          {
            id: 'c3',
            author: jon,
            returned: true,
            withdrew: false,
            body: { type: 'doc', content: [] },
            at,
            editedAt: null,
            deleted: false,
            reactions: [],
            replies: [],
            anchor: null,
            resolved: null,
            reopened: null,
          },
          {
            id: 'c4',
            author: ines,
            returned: false,
            withdrew: false,
            body: said('person:p_jon', 'Jon'),
            at,
            editedAt: null,
            deleted: false,
            reactions: [],
            replies: [],
            anchor: { before: 'v1', after: 'v2', side: 'after', line: 3 },
            resolved: { by: jon, at },
            reopened: { by: ines, at },
          },
        ],
        reactions: [],
        withdrawable: false,
        newReply: null,
        mentions: [],
      },
    ]
    const read = commentsOf(threads, people, 'Ines Duarte', now)
    expect(read.threads['context:itm_norway01']).toEqual([
      {
        id: 'c1',
        author: 'Jon Abara',
        when: 'Today, 09:40',
        content: said('person:Ines Duarte', 'Ines Duarte'),
        reactions: [{ emoji: '👍', by: ['Ines Duarte', 'Jon Abara'] }],
        edited: true,
        replies: [
          {
            id: 'c2',
            author: 'Ines Duarte',
            when: 'Today, 09:40',
            content: { type: 'doc' },
            deleted: true,
          },
        ],
      },
    ])
    expect(read.threads['review:0f8fad5b-d9cb-469f-a165-70867728950e']![0]).toMatchObject({
      returned: true,
    })
    // A thread on a line keeps its place, and says who resolved it and who opened it again.
    expect(read.threads['review:0f8fad5b-d9cb-469f-a165-70867728950e']![1]).toMatchObject({
      anchor: { before: 'v1', after: 'v2', side: 'after', line: 3 },
      resolved: { by: 'Jon Abara', when: 'Today, 09:40' },
      reopened: { by: 'Ines Duarte', when: 'Today, 09:40' },
    })
    expect(read.threads['review:0f8fad5b-d9cb-469f-a165-70867728950e']![0]).not.toHaveProperty(
      'anchor',
    )
    expect(read.reactions).toEqual({ 'context:itm_norway01': [{ emoji: '🙏', by: ['Jon Abara'] }] })
    expect(read.newReplies).toEqual({
      'context:itm_norway01': { from: 'Jon Abara', when: 'Today, 09:40', excerpt: 'Ask @Ines' },
    })
    // The mention of Ines is unread where it is, and read where there is none for her.
    expect(
      mentionNotesOf(read)
        .get('Ines Duarte')
        ?.map((n) => n.id),
    ).toEqual(['c1'])
    expect(read.mentionSeen).toEqual({
      'review:0f8fad5b-d9cb-469f-a165-70867728950e|Ines Duarte': true,
    })
  })
})

describe('the terms written here', () => {
  const term = (patch: Partial<Term> = {}): Term => ({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Peak season',
    meaning: '15 November to 31 December.',
    sameAs: null,
    areaId: 'area_marketing',
    createdBy: 'per_tomas',
    createdAt: '2026-09-18T09:00:00.000Z',
    updatedBy: 'per_tomas',
    updatedAt: '2026-09-18T09:00:00.000Z',
    revision: 1,
    items: 2,
    conflict: null,
    canChange: false,
    ...patch,
  })
  const person = (id: string) => (id === 'per_tomas' ? 'Tomas Eriksen' : 'Jon Abara')

  it('reads a term and a synonym as definitions, by who wrote them', () => {
    expect(
      termDefinitionsOf(
        [
          term(),
          term({
            name: 'GMV',
            meaning: null,
            sameAs: { ref: 'metric:gross_sales', name: 'Gross sales', type: 'metric' },
            areaId: null,
            createdBy: 'per_jon',
            createdAt: '2026-09-20T09:00:00.000Z',
          }),
        ],
        person,
      ),
    ).toEqual([
      {
        name: 'Peak season',
        type: 'term',
        definition: '15 November to 31 December.',
        synced: false,
        sourceNames: [],
        domain: 'area_marketing',
        by: 'Tomas Eriksen',
        updated: '18 Sep 2026',
      },
      {
        name: 'GMV',
        type: 'term',
        definition: '',
        sameAs: 'Gross sales',
        synced: false,
        sourceNames: [],
        by: 'Jon Abara',
        updated: '18 Sep 2026',
      },
    ])
  })

  it('lists them in the order they were written, so other names read as they were added', () => {
    const later = term({ name: 'Gross takings', createdAt: '2026-10-23T09:00:00.000Z' })
    const first = term({ name: 'Sales value', createdAt: '2026-10-22T09:00:00.000Z' })
    const same = term({ name: 'Peak', createdAt: '2026-10-22T09:00:00.000Z' })
    expect(termDefinitionsOf([later, first, same], person).map((d) => d.name)).toEqual([
      'Peak',
      'Sales value',
      'Gross takings',
    ])
  })

  it("reads a refused word as the synonym box's reason, and nothing else as one", () => {
    expect(
      refusalOf({
        status: 409,
        message: '“Turnover” is already another name for Net revenue, added by Sofia Brandt.',
        data: { refusal: { code: 'taken', holder: 'Net revenue', by: 'Sofia Brandt' } },
      }),
    ).toEqual({
      ok: false,
      why: 'taken',
      reason: '“Turnover” is already another name for Net revenue, added by Sofia Brandt.',
      holder: 'Net revenue',
      by: 'Sofia Brandt',
    })
    expect(
      refusalOf({
        status: 409,
        message: 'Net revenue is already called “net sales”.',
        data: { refusal: { code: 'here', holder: 'Net revenue', by: null } },
      }),
    ).not.toHaveProperty('by')
    expect(refusalOf({ status: 409, message: 'Someone changed this term.' })).toBeNull()
    expect(refusalOf({ status: 403, message: 'No.', data: { refusal: {} } })).toBeNull()
    expect(refusalOf(new Error('offline'))).toBeNull()
  })
})
