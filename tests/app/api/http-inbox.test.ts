import { describe, expect, it } from 'vitest'
import type { Card, Feed } from '@contract/inbox'
import type { ReviewSheet } from '@contract/review-path'
import type { Area } from '@domain/item'
import { wordsOf } from '@/api/http-context'
import { inboxOf, refOf, reviewOf, whenWords, workspaceOf } from '@/api/http-inbox'
import type { Domains } from '@/model/people'
import { readiness, readTime } from '@/model/review'

const now = new Date(2026, 9, 23, 15, 0)
const at = (day: number, hour = 9, minute = 12) =>
  new Date(2026, 9, day, hour, minute).toISOString()

describe('when something happened, as the Inbox says it', () => {
  it('says today and yesterday with the time, and a day before that', () => {
    expect(whenWords(at(23), now)).toBe('Today, 09:12')
    expect(whenWords(at(22, 16, 40), now)).toBe('Yesterday, 16:40')
    expect(whenWords(at(20), now)).toBe('20 Oct')
  })
})

const area = (id: string, name: string, ownerIds: string[]): Area => ({
  id,
  demo: false,
  name,
  summary: `What ${name} covers.`,
  description: `What ${name} covers.\n\nHouse rules.`,
  ownerIds,
  label: 'sky',
  revision: 1,
})
const areas = [area('area_sales', 'Sales', ['p_jon', 'p_sofia']), area('area_mkt', 'Marketing', [])]
const people = [
  { id: 'p_jon', name: 'Jon Abara' },
  { id: 'p_sofia', name: 'Sofia Brandt' },
  { id: 'p_ines', name: 'Ines Duarte' },
]

describe('the workspace', () => {
  it('names each domain’s owners, and what each person owns', () => {
    const ws = workspaceOf({ areas, people, me: { id: 'p_jon', admin: true } })
    expect(ws.domains[0]).toEqual({
      id: 'area_sales',
      name: 'Sales',
      owners: ['Jon Abara', 'Sofia Brandt'],
      covers: 'What Sales covers.',
      text: 'What Sales covers.\n\nHouse rules.',
    })
    expect(ws.people.map((p) => [p.name, p.owns, p.admin, p.role])).toEqual([
      ['Jon Abara', ['area_sales'], true, 'Owner of Sales, admin'],
      ['Sofia Brandt', ['area_sales'], false, 'Owner of Sales'],
      ['Ines Duarte', [], false, 'Suggests context, owns no domain'],
    ])
  })

  it('knows only the signed-in person’s admin role', () => {
    const ws = workspaceOf({ areas, people, me: { id: 'p_ines', admin: false } })
    expect(ws.people.every((p) => !p.admin)).toBe(true)
  })
})

const base = { areaId: 'area_sales', at: at(23), opened: false, done: null }
const suggestion = (patch: Partial<Extract<Card, { group: 'suggestion' }>> = {}): Card => ({
  ...base,
  id: 'p1',
  group: 'suggestion',
  proposalId: 'p1',
  number: 7,
  title: 'Units sold excludes test accounts',
  action: 'change',
  itemId: 'itm_units01',
  from: { personId: 'p_ines', name: 'Ines Duarte' },
  writtenBy: null,
  synced: null,
  read: false,
  care: { claims: 0, clash: false },
  ...patch,
})
const feed = (cards: Card[], patch: Partial<Feed> = {}): Feed => ({
  week: { asked: 142, found: 117, nothing: 25, mostAbout: 'Orders in Spain' },
  groups: [],
  cards,
  waiting: [],
  ...patch,
})
const domains: Domains = Object.fromEntries(
  workspaceOf({ areas, people, me: { id: 'p_jon', admin: false } }).domains.map((d) => [d.id, d]),
)

describe('the Inbox', () => {
  it('reads a suggestion as a card in the person’s Inbox, with who sent it', () => {
    const { cards } = inboxOf(feed([suggestion()]), 'Jon Abara', domains, now)
    expect(cards[0]).toMatchObject({
      id: 'p1',
      type: 'suggestion',
      domain: 'area_sales',
      for: 'Jon Abara',
      when: 'Today, 09:12',
      title: 'Units sold excludes test accounts',
      line: 'A change from Ines Duarte.',
      primary: 'Review',
      factId: 'itm_units01',
      suggestion: { from: 'Ines Duarte', factId: 'itm_units01' },
    })
    expect(cards[0]?.suggestion?.agent).toBeUndefined()
  })

  it('says when an agent wrote it, and when it is new or archives something', () => {
    const lines = inboxOf(
      feed([
        suggestion({ id: 'a', writtenBy: 'agent', action: 'create', itemId: null }),
        suggestion({ id: 'b', action: 'create', itemId: null }),
        suggestion({ id: 'c', action: 'retire' }),
      ]),
      'Jon Abara',
      domains,
      now,
    ).cards.map((c) => [c.line, c.suggestion?.agent])
    expect(lines).toEqual([
      ["New context from an agent, sent with Ines Duarte's OK.", 'An agent'],
      ['New context from Ines Duarte.', undefined],
      ['Ines Duarte suggests archiving it.', undefined],
    ])
  })

  it('keeps what is done, opened and read, by card', () => {
    const inbox = inboxOf(
      feed([
        suggestion({ id: 'proposal:open', proposalId: 'open', opened: true, read: true }),
        suggestion({
          id: 'proposal:done',
          proposalId: 'done',
          opened: true,
          done: { outcome: 'Published', at: at(23, 10, 5) },
        }),
      ]),
      'Jon Abara',
      domains,
      now,
    )
    expect(inbox.opened).toEqual({ open: true, done: true })
    expect(inbox.reviewed).toEqual({ open: true })
    expect(inbox.done).toEqual({ done: { label: 'Published', at: 'Today, 10:05' } })
  })

  it('names a Not found card with a draft by its draft, reviewed like a suggestion', () => {
    const gap: Card = {
      ...base,
      id: 'gap:g1',
      group: 'gap',
      gapId: 'g1',
      ref: 'orders-spain-2026-10',
      title: 'Orders in Spain, October 2026',
      scope: {
        metrics: ['metric:orders'],
        values: ['val:market/spain'],
        dimensions: [],
        month: '2026-10',
      },
      times: 9,
      draft: 'p9',
    }
    const inbox = inboxOf(
      feed([gap, suggestion({ id: 'proposal:p9', proposalId: 'p9', opened: true, read: true })]),
      'Jon Abara',
      domains,
      now,
    )
    // One card, named by the draft as its review and its discussion are; the draft's own suggestion
    // card says it was opened and read.
    expect(inbox.cards.map((c) => c.id)).toEqual(['p9'])
    expect(inbox.cards[0]).toMatchObject({
      type: 'gap',
      title: 'Orders in Spain, October 2026',
      primary: 'Review',
      line: 'Agents found nothing written down for this, 9 times this week.',
      gap: { times: 9, draft: { id: 'p9', title: 'Orders in Spain, October 2026' } },
    })
    expect(inbox.opened).toEqual({ p9: true })
    expect(inbox.reviewed).toEqual({ p9: true })
    // With no draft yet, the card keeps the service's name and writes context from the editor.
    const [blank] = inboxOf(feed([{ ...gap, draft: null }]), 'Jon Abara', domains, now).cards
    expect(blank).toMatchObject({ id: 'gap:g1', primary: 'Write context' })
    // Once its draft is published, the card is done with it.
    const published = inboxOf(
      feed([
        gap,
        suggestion({
          id: 'proposal:p9',
          proposalId: 'p9',
          done: { outcome: 'Published', at: at(23, 11, 0) },
        }),
      ]),
      'Jon Abara',
      domains,
      now,
    )
    expect(published.done).toEqual({ p9: { label: 'Published', at: 'Today, 11:00' } })
    expect(blank?.gap?.draft).toBeUndefined()
  })

  it('says a report as what was sent, without a name the service does not keep', () => {
    const flag: Card = {
      ...base,
      id: 'feedback:f1',
      group: 'flag',
      source: 'agent',
      feedbackId: 'f1',
      verdict: 'unclear',
      note: 'Is this Germany only, or every market?',
      by: null,
      question: null,
      correction: null,
      link: null,
      items: [],
    }
    expect(inboxOf(feed([flag]), 'Jon Abara', domains, now).cards[0]).toMatchObject({
      type: 'flag',
      title: 'An answer was reported as unclear',
      line: 'Reported unclear: “Is this Germany only, or every market?”',
      primary: 'Not a problem',
      secondary: [],
      flag: { reason: 'unclear', by: '' },
    })
  })

  it('names a report by the context item the reported answer gave first', () => {
    const flag: Card = {
      ...base,
      id: 'feedback:f2',
      group: 'flag',
      source: 'agent',
      feedbackId: 'f2',
      verdict: 'wrong',
      note: null,
      by: null,
      question: null,
      correction: null,
      link: null,
      items: [
        { id: 'itm_lag0001', title: 'Orders lags by one day in the source tool' },
        { id: 'itm_other01', title: 'Another item' },
      ],
    }
    expect(inboxOf(feed([flag]), 'Jon Abara', domains, now).cards[0]).toMatchObject({
      id: 'feedback:f2',
      type: 'flag',
      title: 'Orders lags by one day in the source tool',
      line: 'Reported wrong.',
      primary: 'Open the context item',
      secondary: ['Not a problem'],
      factId: 'itm_lag0001',
      flag: { reason: 'wrong', note: '', by: '' },
    })
  })

  it('names who sent a named report from Ask, by their name', () => {
    const flag: Card = {
      ...base,
      id: 'report:r1',
      group: 'flag',
      source: 'ask',
      feedbackId: 'r1',
      verdict: 'wrong',
      note: 'Gift cards are paid out separately since October.',
      by: 'per_maria',
      question: 'Do Norway orders include gift-card money?',
      correction: null,
      link: null,
      items: [{ id: 'itm_gift0001', title: 'Norway orders count store credit' }],
    }
    const name = (id: string) => (id === 'per_maria' ? 'Maria Lindqvist' : 'Someone')
    expect(inboxOf(feed([flag]), 'Jon Abara', domains, now, name).cards[0]).toMatchObject({
      id: 'report:r1',
      type: 'flag',
      title: 'Norway orders count store credit',
      line: 'Reported wrong: “Gift cards are paid out separately since October.”',
      factId: 'itm_gift0001',
      flag: { by: 'Maria Lindqvist', via: 'Ask' },
    })
  })
  it('says since when a check is due, and who checked it last', () => {
    const check = (patch: Partial<Extract<Card, { group: 'check' }>>): Card => ({
      ...base,
      id: 'check:itm_a',
      group: 'check',
      itemId: 'itm_a',
      title: 'Returns changed definition on 28 April 2026',
      reason: 'date',
      lastChecked: { on: '2026-07-02', by: 'Jon Abara' },
      ...patch,
    })
    const [due, changed] = inboxOf(
      feed([
        check({ at: '2026-10-02' }),
        check({ id: 'check:itm_b', reason: 'source', lastChecked: { on: null, by: null } }),
      ]),
      'Jon Abara',
      domains,
      now,
    ).cards
    expect(due).toMatchObject({
      when: 'Since 2 Oct',
      line: 'Its check date passed on 2 Oct 2026. Agents are told it may be out of date.',
      detail: 'Last checked by you, 2 Jul 2026.',
      primary: 'Still true',
      secondary: ['Edit', 'Archive'],
      factId: 'itm_a',
    })
    expect(changed).toMatchObject({ when: 'Today', detail: 'Not checked yet.' })
    expect(changed?.line).toMatch(/changed a definition it relies on/)
  })

  it('reads the saved-question alert as one card for the domain, with its questions', () => {
    const look = (questions: { id: string; question: string }[]): Card => ({
      ...base,
      id: 'look:area_sales',
      group: 'look',
      areaId: 'area_sales',
      questions,
    })
    const [two, one] = inboxOf(
      feed([
        look([
          { id: 'q1', question: 'Why did support contacts in Norway rise?' },
          { id: 'q2', question: 'What should I rule out?' },
        ]),
        { ...look([{ id: 'q3', question: 'Why?' }]), id: 'look:area_marketing' },
      ]),
      'Jon Abara',
      domains,
      now,
    ).cards
    expect(two).toMatchObject({
      id: 'look:area_sales',
      type: 'look',
      domain: 'area_sales',
      title: '2 saved questions need a look',
      line: 'They answer worse than when they were saved.',
      primary: 'Open in Quality',
      secondary: [],
      look: { questions: ['q1', 'q2'] },
    })
    expect(one).toMatchObject({
      title: '1 saved question needs a look',
      line: 'It answers worse than when it was saved.',
    })
  })

  it('reads a raise of a rule with a card of its own as an Alert card, with one action', () => {
    const [sync, spend] = inboxOf(
      feed([
        {
          ...base,
          id: 'alert:r1',
          group: 'alert',
          areaId: 'area_sales',
          raiseId: 'r1',
          rule: 'sync',
          title: 'Cube did not sync',
          subject: { connector: 'cube' },
        },
        {
          ...base,
          id: 'alert:r2',
          group: 'alert',
          areaId: '',
          raiseId: 'r2',
          rule: 'spend',
          title: 'Model spend reached 80% of the monthly cap',
          subject: { page: 'usage' },
        },
      ]),
      'Jon Abara',
      domains,
      now,
    ).cards
    expect(sync).toMatchObject({
      id: 'alert:r1',
      type: 'alert',
      title: 'Cube did not sync',
      line: 'Its last read failed, or it has not read for longer than it should.',
      primary: 'Open the integration',
      secondary: [],
      alert: {
        rule: 'sync',
        name: 'A connected tool did not sync',
        href: '/settings/integrations/cube',
      },
    })
    expect(spend).toMatchObject({
      domain: '',
      primary: 'Open Usage',
      alert: { href: '/observability/usage' },
    })
  })

  it('says whom a suggestion the person sent waits for', () => {
    const inbox = inboxOf(
      feed([], {
        waiting: [
          {
            proposalId: 'p5',
            title: 'Norway launch campaign started on 24 March 2026',
            areaId: 'area_sales',
            sentAt: at(20),
            waitingFor: ['Jon Abara', 'Sofia Brandt'],
          },
        ],
      }),
      'Ines Duarte',
      domains,
      now,
    )
    expect(inbox.waiting).toEqual([
      {
        id: 'waiting:p5',
        for: 'Ines Duarte',
        title: 'Norway launch campaign started on 24 March 2026',
        waitingFor: 'Jon Abara or Sofia Brandt, owners of Sales',
        domain: 'area_sales',
        sent: '20 Oct',
        card: 'p5',
      },
    ])
  })

  it('passes the week’s counts on, hidden ones as they are', () => {
    const week = { asked: null, found: null, nothing: null, mostAbout: null }
    expect(inboxOf(feed([], { week }), 'Jon Abara', domains, now).week).toEqual(week)
  })
})

type Diff = ReviewSheet['diff']
const sheet = (patch: Partial<ReviewSheet> = {}, diff: Partial<Diff> = {}): ReviewSheet => ({
  proposal: {
    id: 'p1',
    number: 7,
    subject: 'item',
    action: 'change',
    state: 'submitted',
    areaId: 'area_sales',
    itemId: 'itm_units01',
    itemVersionId: 'v2',
    vocabularyVersionId: null,
    termKey: null,
    title: 'Units sold excludes test accounts',
    riskLevel: 'normal',
    proposerId: 'p_ines',
    channel: 'chat',
    revision: 3,
    reason: null,
    claimedBy: null,
    dueAt: null,
    submittedAt: '2026-10-22T09:12:00Z',
    closedAt: null,
    createdAt: '2026-10-22T09:00:00Z',
  },
  mode: 'edit',
  from: { personId: 'p_ines', name: 'Ines Duarte' },
  writtenBy: null,
  synced: null,
  gapId: null,
  note: 'The returns team started its own test accounts in October.',
  withdrawn: null,
  diff: {
    mode: 'edit',
    blocks: [],
    counts: [],
    unchanged: ['title', 'kind', 'where', 'when', 'notToConclude'],
    values: [],
    only: null,
    ...diff,
  },
  source: { before: 'Leaves out 312 accounts.', after: 'Leaves out 340 accounts.', rows: [] },
  claims: null,
  clashes: [],
  overlaps: [],
  readiness: {
    state: 'link',
    ok: true,
    bulk: false,
    publishable: true,
    claimsToCheck: 0,
    unsourced: [],
    relation: null,
    title: 'Ready',
    text: 'The new values come with a new source page. Open it to check them.',
  },
  readMs: 2800,
  read: { opened: false, read: false },
  tryIt: {
    question: 'Units sold in Norway',
    before: { state: 'grounded', say: 'One context item applies.', items: [] },
    after: { state: 'stale', say: 'It may be out of date.', items: [] },
  },
  reach: { questions: 12, week: '2026-10-19' },
  saved: [],
  canPublish: true,
  whyNot: null,
  ...patch,
})

describe('the review', () => {
  it('reads the sheet under its card’s id, with the service’s Ready line and read time', () => {
    const r = reviewOf(
      sheet(
        {},
        {
          counts: [
            { kind: 'wording', n: 2 },
            { kind: 'link', n: 1 },
          ],
          values: [
            { what: 'number', field: 'text', before: '312', after: '340' },
            { what: 'date', field: 'text', before: null, after: '1 October 2026' },
            {
              what: 'source',
              field: 'sources',
              before: 'https://wiki.example/data/units-sold',
              after: 'https://wiki.example/data/units-sold-october#changes',
            },
          ],
        },
      ),
      'p1',
    )
    expect(r).toMatchObject({
      id: 'p1',
      title: 'Units sold excludes test accounts',
      from: 'Ines Duarte',
      via: 'a chat',
      on: '22 Oct 2026',
      note: 'The returns team started its own test accounts in October.',
      mode: 'edit',
      summary: 'Rewords 2 places and changes a link: 312 to 340.',
      counts: [
        { kind: 'Wording', n: 2 },
        { kind: 'Link', n: 1 },
      ],
      moved: [
        { label: 'Number', before: '312', after: '340' },
        { label: 'New date', after: '1 October 2026' },
        { label: 'Source page', before: 'units-sold', after: 'units-sold-october#changes' },
      ],
      unchanged: ['Title', 'Kind', 'Where', 'When', "Don't conclude"],
      tryIt: {
        question: 'Units sold in Norway',
        before: { state: 'grounded', text: 'One context item applies.' },
        after: { state: 'stale', text: 'It may be out of date.' },
        reach: 12,
      },
      source: { before: 'Leaves out 312 accounts.', after: 'Leaves out 340 accounts.' },
    })
    expect(readiness(r)).toEqual({
      ok: true,
      bulk: false,
      title: 'Ready',
      text: 'The new values come with a new source page. Open it to check them.',
    })
    expect(readTime(r)).toBe(2800)
    expect(refOf(sheet())).toEqual({
      proposalId: 'p1',
      revision: 3,
      itemVersionId: 'v2',
      clashes: [],
      gap: null,
    })
    // A Not found card's draft: Publish also saves the question agents asked, in words.
    expect(refOf(sheet({ gapId: 'g1' })).gap).toEqual({
      scope: 'Units sold in Norway',
      areaId: 'area_sales',
    })
  })

  it('shows the service’s check of the draft against the saved questions, in words', () => {
    const item = (summary: string) => ({
      id: 'itm_a',
      title: 'Units sold',
      summary,
      unverified: null,
    })
    const r = reviewOf(
      sheet({
        saved: [
          {
            id: 'q1',
            question: 'Do units sold include test accounts?',
            result: 'changed',
            reason: 'words',
            live: {
              state: 'grounded',
              say: 'Checked.',
              items: [item('Leaves out 312 accounts.')],
            },
            draft: {
              state: 'grounded',
              say: 'Checked.',
              items: [item('Leaves out 340 accounts.')],
            },
            expectItems: ['itm_a'],
          },
        ],
      }),
      'sug-1',
    )
    expect(r.saved).toEqual([
      {
        id: 'q1',
        result: 'changed',
        why: 'The sentence agents get has new words. Still based on checked context.',
        before: 'Leaves out 312 accounts.',
        now: 'Leaves out 340 accounts.',
      },
    ])
    expect(reviewOf(sheet(), 'sug-1').saved).toEqual([])
  })

  it('names a link to a term written in Definitions by its word, as Try it says it', () => {
    const id = '0190a0a0-0000-7000-8000-00000000000c'
    const words = wordsOf({ metrics: [], dimensions: [] }, [{ id, name: 'Test account' }])
    const mention = { target: `term:${id}`, label: 'accounts', change: 'added' as const }
    const [block] = reviewOf(
      sheet({}, { blocks: [{ kind: 'link', field: 'text', mention }] }),
      'p1',
      undefined,
      words,
    ).blocks
    expect(block).toEqual({
      kind: 'Link',
      field: 'What agents should know',
      text: '',
      mention: { id: 'term:Test account', label: 'Test account', change: 'added' },
    })
  })

  it('draws each kind of change as its block, with the app’s marks', () => {
    const blocks = reviewOf(
      sheet(
        {},
        {
          blocks: [
            {
              kind: 'wording',
              field: 'text',
              runs: [
                { t: 'same', text: 'Leaves out ' },
                { t: 'del', text: '312' },
                { t: 'add', text: '340' },
                { t: 'same', text: ' accounts.' },
              ],
              changes: 1,
              rewrite: false,
            },
            { kind: 'wording', field: 'kind', before: 'note', after: 'issue' },
            {
              kind: 'added',
              field: 'notToConclude',
              text: 'Fewer orders are not fewer customers.',
            },
            { kind: 'removed', field: 'where', parts: ['Orders', 'Spain'] },
            { kind: 'added', field: 'when', from: '2026-10-14', until: '2026-10-17' },
            {
              kind: 'added',
              field: 'sources',
              url: 'https://status.example/poland',
              quote: 'Files are late.',
            },
            {
              kind: 'formatting',
              field: 'text',
              change: { what: 'marks', added: ['bold'], removed: [] },
              runs: [
                { t: 'same', text: 'the webshop was ' },
                { t: 'fmt', text: 'the only way', added: ['bold'], removed: [] },
              ],
            },
            {
              kind: 'formatting',
              field: 'text',
              change: { what: 'list', was: 'bullet', now: 'number' },
              items: ['Parcels still arrived.', 'Compare before or after.'],
            },
            {
              kind: 'link',
              field: 'sources',
              text: 'Returns changelog',
              before: 'https://wiki.example/a',
              after: 'https://wiki.example/b',
            },
            {
              kind: 'link',
              field: 'text',
              mention: { target: 'term:Test account', label: 'Test account', change: 'added' },
            },
            {
              kind: 'order',
              field: 'text',
              steps: [
                { text: 'Check for large orders.', from: 2 },
                { text: 'Look at four weeks.', from: null },
              ],
              moved: 1,
            },
            {
              kind: 'dates',
              field: 'when',
              before: { from: '2026-05-12', until: '2026-05-20' },
              after: { from: '2026-05-12', until: '2026-05-27' },
            },
          ],
        },
      ),
      'p1',
    ).blocks
    expect(blocks).toEqual([
      {
        kind: 'Wording',
        field: 'What agents should know',
        text: 'Leaves out [-312-]{+340+} accounts.',
      },
      { kind: 'Wording', field: 'Kind', text: '[-Rule-]{+Warning+}' },
      { kind: 'Added', field: "Don't conclude", text: 'Fewer orders are not fewer customers.' },
      { kind: 'Removed', field: 'Where', text: 'Orders, Spain' },
      { kind: 'Added', field: 'When', text: '14 to 16 Oct 2026' },
      {
        kind: 'Added',
        field: 'Source',
        text: 'https://status.example/poland: “Files are late.”',
      },
      {
        kind: 'Formatting',
        field: 'What agents should know',
        label: 'Bold added',
        text: 'the webshop was {*the only way|Bold*}',
      },
      {
        kind: 'Formatting',
        field: 'What agents should know',
        label: 'Bulleted list became a numbered list',
        text: '',
        list: {
          ordered: true,
          was: 'bullets',
          items: ['Parcels still arrived.', 'Compare before or after.'],
        },
      },
      {
        kind: 'Link',
        field: 'Source',
        text: 'Returns changelog',
        before: 'https://wiki.example/a',
        after: 'https://wiki.example/b',
      },
      {
        kind: 'Link',
        field: 'What agents should know',
        text: '',
        mention: { id: 'term:Test account', label: 'Test account', change: 'added' },
      },
      {
        kind: 'Order',
        field: 'What agents should know',
        label: 'Moved up from step 2',
        steps: [{ text: 'Check for large orders.', from: 2 }, { text: 'Look at four weeks.' }],
      },
      {
        kind: 'Dates',
        field: 'When',
        before: '12 to 19 May 2026',
        after: '12 to 26 May 2026',
        span: { from: 12, was: 19, now: 26, month: 'May' },
      },
    ])
  })

  it('leaves the timeline out when a change of dates spans months', () => {
    const [dates] = reviewOf(
      sheet(
        {},
        {
          blocks: [
            {
              kind: 'dates',
              field: 'when',
              before: { from: '2026-05-12', until: '2026-05-20' },
              after: { from: '2026-05-12', until: '2026-06-10' },
            },
          ],
        },
      ),
      'p1',
    ).blocks
    expect(dates).toEqual({
      kind: 'Dates',
      field: 'When',
      before: '12 to 19 May 2026',
      after: '12 May to 9 Jun 2026',
    })
  })

  it('shows a long rewording side by side', () => {
    const r = reviewOf(
      sheet(
        {},
        {
          counts: [{ kind: 'wording', n: 4 }],
          blocks: [
            {
              kind: 'wording',
              field: 'text',
              runs: [
                { t: 'same', text: 'The provider sends ' },
                { t: 'del', text: 'weekend files on Monday' },
                { t: 'add', text: "Saturday's file on Sunday" },
                { t: 'same', text: '.' },
              ],
              changes: 4,
              rewrite: true,
            },
          ],
        },
      ),
      'p1',
    )
    expect(r.blocks).toEqual([])
    expect(r.rewrite).toEqual({
      field: 'What agents should know',
      before: 'The provider sends [-weekend files on Monday-].',
      after: "The provider sends {+Saturday's file on Sunday+}.",
      changes: 4,
    })
  })

  it('reads a Not found card’s draft as drafted for the owner, from the page it was drafted from', () => {
    const r = reviewOf(
      sheet(
        {
          mode: 'new',
          gapId: 'g1',
          writtenBy: 'assistant',
          from: { personId: 'p_maria', name: 'Maria Lindqvist' },
          tryIt: {
            question: 'Orders in Spain',
            before: { state: 'missing', say: 'Nothing is written down.', items: [] },
            after: { state: 'grounded', say: 'Card payments failed.', items: [] },
          },
        },
        {
          mode: 'new',
          blocks: [
            {
              kind: 'added',
              field: 'sources',
              url: 'https://status.payments.example/incidents/2026-10-14-spain',
              quote: 'Card authorisations failed.',
            },
          ],
        },
      ),
      'p9',
      { times: 9 },
    )
    expect(r.from).toBe('Drafted for you')
    expect(r.drafted).toEqual({
      questions: 9,
      scope: 'Orders in Spain',
      from: 'the page at status.payments.example',
    })
    // Without the card's count, how many questions reach it this week.
    expect(reviewOf(sheet({ gapId: 'g1', writtenBy: 'assistant' }), 'p9').drafted?.questions).toBe(
      12,
    )
  })

  it('carries an agent’s claims, the clash still to answer, and what a retirement archives', () => {
    const agent = reviewOf(
      sheet({
        mode: 'new',
        writtenBy: 'agent',
        source: {
          before: '',
          after: 'Poland orders arrive late. The last days are short.',
          rows: [],
        },
        claims: {
          sentence: 'Settlement files for Poland are delayed by up to 48 hours.',
          rows: [
            { claim: 'up to two days', source: null, verdict: 'check' },
            { claim: 'Poland', source: 'Poland', verdict: 'same' },
          ],
        },
        clashes: [
          { itemId: 'itm_a', title: 'Answered', summary: 'Said before.', relation: 'unrelated' },
          {
            itemId: 'itm_b',
            title: 'Norway orders count store credit',
            summary: 'They count it.',
            relation: null,
          },
        ],
      }),
      'p1',
    )
    expect(agent.agent).toBe('An agent')
    expect(agent.summary).toBe('New context: Poland orders arrive late.')
    expect(agent.claims).toEqual({
      sentence: 'Settlement files for Poland are delayed by up to 48 hours.',
      rows: [
        { claim: 'up to two days', source: 'not in the sentence', same: 'check' },
        { claim: 'Poland', source: 'Poland', same: 'same' },
      ],
    })
    expect(agent.clash).toEqual({
      factId: 'itm_b',
      title: 'Norway orders count store credit',
      mine: 'Poland orders arrive late. The last days are short.',
      theirs: 'They count it.',
    })
    const retire = reviewOf(
      sheet({ mode: 'retire', note: 'Finance restated it.', reach: null }, { mode: 'retire' }),
      'p1',
    )
    expect(retire.summary).toBe('Archives a context item: Units sold excludes test accounts.')
    expect(retire.retire).toEqual({
      factId: 'itm_units01',
      reason: 'Finance restated it.',
      used: 0,
      checkFirst: '',
    })
  })

  it('says a change of layout or of order in one sentence', () => {
    expect(reviewOf(sheet({}, { only: 'formatting' }), 'x').summary).toBe(
      'Tidies the layout. The words are the same.',
    )
    expect(reviewOf(sheet({}, { only: 'formatting' }), 'x').formattingOnly).toBe(true)
    expect(reviewOf(sheet({}, { only: 'order' }), 'x').summary).toBe(
      'Changes the order. The words are the same.',
    )
  })
})

describe('the Inbox mentions', () => {
  it('reads a Mentioned you card as a mention, not as a card', () => {
    const mention: Card = {
      ...base,
      id: 'mention:review:p1',
      group: 'mention',
      subject: 'review:p1',
      title: 'Units sold excludes test accounts',
      commentId: 'c1',
      from: { personId: 'p_ines', name: 'Ines Duarte' },
      excerpt: 'Can you check this?',
    }
    const inbox = inboxOf(feed([mention, suggestion()]), 'Jon Abara', domains, now)
    expect(inbox.cards.map((c) => c.id)).toEqual(['p1'])
    expect(inbox.mentions).toEqual([
      {
        subject: 'review:p1',
        id: 'c1',
        from: 'Ines Duarte',
        when: 'Today, 09:12',
        excerpt: 'Can you check this?',
        title: 'Units sold excludes test accounts',
      },
    ])
  })
})
