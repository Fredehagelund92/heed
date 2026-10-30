import { describe, expect, it } from 'vitest'
import type { AuditEntry, Setting } from '@contract/admin'
import type { OperationsOverviewView } from '@contract/index'
import type { Edition } from '@contract/review'
import { freeAreaId, summaryOf } from '@/api/http'
import {
  connectedOf,
  deletedOf,
  editionsOf,
  historyLine,
  historyOf,
  jobsOf,
  limitsOf,
  switchesOf,
  usedWords,
} from '@/api/http-settings'

const now = new Date(2026, 9, 23, 10, 0)
const at = (day: number, hour = 9, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString()

describe('the agents people connected', () => {
  it('says when an agent was last used in a few words', () => {
    expect(usedWords(new Date(now.getTime() - 60_000).toISOString(), now)).toBe('Just now')
    expect(usedWords(at(23, 8), now)).toBe('Today')
    expect(usedWords(at(22), now)).toBe('Yesterday')
    expect(usedWords(at(20), now)).toBe('3 days ago')
    expect(usedWords(at(2), now)).toBe('2 Oct')
  })

  it('lists one row per agent and person, newest sign-in first, a sign-in of minutes ago new', () => {
    const rows = connectedOf(
      [
        {
          clientName: 'Cursor',
          person: { name: 'Jon Abara' },
          connectedAt: at(12),
          lastUsedAt: at(22),
        },
        {
          clientName: 'Claude',
          person: { name: 'Maria Lindqvist' },
          connectedAt: at(2),
          lastUsedAt: at(23),
        },
        // The same agent signed in again for the same person: one row, the newest sign-in.
        {
          clientName: 'Cursor',
          person: { name: 'Jon Abara' },
          connectedAt: at(20),
          lastUsedAt: at(20),
        },
        {
          clientName: 'Claude Code',
          person: { name: 'Jon Abara' },
          connectedAt: new Date(now.getTime() - 120_000).toISOString(),
          lastUsedAt: new Date(now.getTime() - 120_000).toISOString(),
        },
      ],
      'Jon Abara',
      now,
    )
    expect(rows).toEqual([
      {
        agent: 'Claude Code',
        who: 'Jon Abara',
        since: '23 Oct 2026',
        used: 'Just now',
        fresh: true,
      },
      { agent: 'Cursor', who: 'Jon Abara', since: '20 Oct 2026', used: '3 days ago' },
      { agent: 'Claude', who: 'Maria Lindqvist', since: '2 Oct 2026', used: 'Today' },
    ])
  })

  it('lists each access key as its own row, by who made it, a key no agent used yet as Never', () => {
    const key = (id: string, createdAt: string, lastUsedAt: string | null) => ({
      kind: 'access_key' as const,
      id,
      createdAt,
      lastUsedAt,
      madeBy: { name: 'Jon Abara' },
    })
    expect(
      connectedOf(
        [
          key('k1', at(21), at(23, 8)),
          {
            clientName: 'Cursor',
            person: { name: 'Jon Abara' },
            connectedAt: at(22),
            lastUsedAt: at(22),
          },
          key('k2', new Date(now.getTime() - 60_000).toISOString(), null),
        ],
        'Jon Abara',
        now,
      ),
    ).toEqual([
      {
        agent: 'Access key',
        who: 'Jon Abara',
        since: '23 Oct 2026',
        used: 'Never',
        key: 'k2',
        fresh: true,
      },
      { agent: 'Cursor', who: 'Jon Abara', since: '22 Oct 2026', used: 'Yesterday' },
      { agent: 'Access key', who: 'Jon Abara', since: '21 Oct 2026', used: 'Today', key: 'k1' },
    ])
  })

  it("names the person's own agents by the person, when the list names nobody", () => {
    expect(
      connectedOf(
        [{ clientName: 'Codex', connectedAt: at(21), lastUsedAt: at(21) }],
        'Ines Duarte',
        now,
      ),
    ).toMatchObject([{ agent: 'Codex', who: 'Ines Duarte' }])
  })
})

describe('the switches', () => {
  it('reads the tools on and what is paused', () => {
    expect(
      switchesOf(
        [
          { tool: 'get_context', enabled: true },
          { tool: 'suggest_context', enabled: false },
          { tool: 'get_related', enabled: true },
          { tool: 'get_facts', enabled: true },
        ],
        [{ scope: 'area', areaId: 'area_marketing' }],
      ),
    ).toEqual({
      links: true,
      tools: {
        get_context: true,
        find_context: false,
        read_context: false,
        report: false,
        suggest_context: false,
      },
      pause: { all: false, domain: 'area_marketing' },
    })
    expect(switchesOf([], [{ scope: 'all', areaId: null }]).pause).toEqual({
      all: true,
      domain: null,
    })
  })
})

const setting = (key: string, value: unknown, editable = true): Setting => ({
  key,
  version: 1,
  value,
  changedAt: at(1),
  changedBy: null,
  reason: null,
  editable,
})

describe('Settings, Advanced', () => {
  it('lists the tuning settings people ask about in words, and counts every setting', () => {
    const page = limitsOf([
      setting('privacy.min_count', 5),
      setting('gaps.no_item_threshold', { calls: 5, days: 7 }),
      setting('limits.llm_monthly_cap_micros', 500_000_000),
      setting('limits.llm_daily_micros_per_person', 2_000_000),
      setting('limits.llm_feature_monthly_micros', { eval: 20_000_000 }),
      setting('limits.agent_drafts', { per_day: 10, open: 20 }),
      setting('retention.delivery_days', 1),
      setting('models.judge', 'different_family'),
      setting('business.about', ''),
      setting('serving.legacy', 1, false),
    ])
    expect(page.settings).toBe(9)
    expect(page.limits).toEqual([
      {
        key: 'gaps.no_item_threshold',
        value: '5 in 7 days',
        what: 'Questions with nothing written down before a Not found card',
      },
      { key: 'privacy.min_count', value: '5', what: 'Counts under this are hidden' },
      {
        key: 'limits.agent_drafts',
        value: '10 a day, 20 waiting at once',
        what: "Suggestions one person's agents can send",
      },
      {
        key: 'limits.llm_monthly_cap_micros',
        value: '$500',
        what: 'All model use in a month; at the cap Ask and web reads stop and say why',
      },
      {
        key: 'limits.llm_daily_micros_per_person',
        value: '$2',
        what: 'Model use by one person in a day',
      },
      { key: 'limits.llm_feature_monthly_micros', value: '$20', what: 'Answer tests in a month' },
      {
        key: 'retention.delivery_days',
        value: '1 day',
        what: 'How long what agents were given is kept, as scopes and counts',
      },
    ])
  })

  it('lists what was deleted, newest first, by whom and when, a term with its synonyms', () => {
    const names: Record<string, string> = { p1: 'Ravi Kapoor', p2: 'Ines Duarte' }
    const rows = deletedOf(
      [
        {
          id: 'd1',
          title: 'Payment provider test',
          areaId: 'area_sandbox',
          personId: 'p1',
          at: at(3),
        },
      ],
      [
        {
          id: 't1',
          name: 'Takings',
          sameAs: 'Revenue',
          areaId: 'area_sales',
          personId: 'p2',
          at: at(23, 8, 5),
          synonyms: [],
        },
        {
          id: 't2',
          name: 'Basket',
          sameAs: null,
          areaId: null,
          personId: 'p2',
          at: at(22, 16, 40),
          synonyms: ['Cart', 'Trolley'],
        },
      ],
      (id) => (id ? (names[id] ?? 'Someone') : 'Someone'),
      now,
    )
    expect(rows).toEqual([
      {
        key: 'term.t1',
        title: 'Takings',
        hint: 'Deleted by Ines Duarte, today, 08:05: another name for Revenue.',
        domain: 'area_sales',
      },
      {
        key: 'term.t2',
        title: 'Basket',
        hint: 'Deleted by Ines Duarte, yesterday, 16:40: a term, with its synonyms Cart and Trolley.',
        domain: null,
      },
      {
        key: 'draft.d1',
        title: 'Payment provider test',
        hint: 'Deleted by Ravi Kapoor, 3 Oct: a draft nobody published.',
        domain: 'area_sandbox',
      },
    ])
  })

  const entry = (over: Partial<AuditEntry>): AuditEntry => ({
    seq: 1,
    at: at(23, 9, 40),
    actorId: 'p1',
    actorName: 'Jon Abara',
    actorKind: 'person',
    action: 'setting.changed',
    areaId: null,
    subjectType: 'setting',
    subjectId: 'workspace.name',
    requestId: null,
    details: {},
    hash: 'x',
    batchId: null,
    reason: null,
    source: null,
    ...over,
  })

  it('says each history entry as a line, with a link to what it names', () => {
    expect(historyLine(entry({}))).toEqual({ what: 'Changed a setting: workspace.name' })
    // An integration's figures settings changed, never which token.
    expect(
      historyLine(entry({ action: 'figures.changed', subjectType: 'source', subjectId: 'cube' })),
    ).toEqual({ what: 'Changed figures in Ask' })
    expect(
      historyLine(
        entry({
          action: 'item.published',
          subjectType: 'item',
          subjectId: 'itm_units01',
          subjectTitle: 'Units sold',
        }),
      ),
    ).toEqual({ what: 'Published “Units sold”', href: '/context/itm_units01' })
    // A suggestion to archive its sender took back in the comments, then let stand, then closed.
    const suggestion = { subjectType: 'proposal', subjectId: 'p1', areaId: 'area_sales' }
    const sales = (id: string) => ({ area_sales: 'Sales' })[id] ?? id
    expect(historyLine(entry({ action: 'proposal.withdrawn', ...suggestion }), sales)).toEqual({
      what: 'Withdrew a suggestion in Sales',
    })
    expect(
      historyLine(entry({ action: 'proposal.withdrawal_taken_back', ...suggestion }), sales),
    ).toEqual({ what: 'Took back the withdrawal of a suggestion in Sales' })
    expect(historyLine(entry({ action: 'proposal.closed', ...suggestion }), sales)).toEqual({
      what: 'Closed a suggestion in Sales',
    })
    const names = (id: string) => ({ finance: 'Finance', area_sales: 'Sales' })[id] ?? id
    expect(
      historyLine(
        entry({
          action: 'area.created',
          subjectType: 'area',
          subjectId: 'finance',
          areaId: 'finance',
        }),
        names,
      ),
    ).toEqual({ what: 'Created a domain: Finance', href: '/settings/domains/finance' })
    expect(
      historyLine(
        entry({
          action: 'stop.off',
          subjectType: 'area',
          subjectId: 'area_sales',
          areaId: 'area_sales',
        }),
        names,
      ).what,
    ).toBe('Resumed sharing in Sales')
    expect(
      historyLine(entry({ action: 'stop.on', subjectType: 'all', subjectId: 'all' })).what,
    ).toBe('Paused sharing')
    expect(
      historyLine(entry({ action: 'ai_client.connected', subjectType: 'ai_connection' })).what,
    ).toBe('Connected an agent')
    const [row] = historyOf([entry({ actorKind: 'system', actorName: null, seq: 7 })], [], now, {
      person: () => 'Someone',
    })
    expect(row).toMatchObject({ key: '7', when: 'Today, 09:40', who: 'Automatic' })
  })

  it('says a change to many items as one line, in place of the entries it wrote for each', () => {
    const discarded = (seq: number, subjectId: string) =>
      entry({
        seq,
        at: at(23, 9, 45),
        action: 'proposal.discarded',
        subjectType: 'proposal',
        subjectId,
        areaId: 'area_sales',
      })
    const rows = historyOf(
      [
        discarded(9, 'd1'),
        discarded(8, 'd2'),
        discarded(7, 'd3'),
        entry({ seq: 6, at: at(23, 9) }),
      ],
      [
        {
          id: 'c1',
          action: 'deleted',
          personId: 'p1',
          at: at(23, 9, 45),
          summary: 'Deleted: drafts nobody published.',
          items: [
            { id: 'd1', title: 'Black Friday', areaId: 'area_sales' },
            { id: 'd2', title: 'Gift cards', areaId: 'area_sales' },
            { id: 'd3', title: 'Returns', areaId: 'area_sales' },
          ],
          withheld: 0,
          undone: false,
        },
      ],
      now,
      { person: (id) => (id === 'p1' ? 'Jon Abara' : 'Someone') },
    )
    expect(rows.map((r) => [r.who, r.what])).toEqual([
      ['Jon Abara', 'Deleted “Black Friday”, “Gift cards” and 1 more'],
      ['Jon Abara', 'Changed a setting: workspace.name'],
    ])
  })

  it('lists the jobs in words, with how their last run went', () => {
    const view = {
      jobs: [
        { name: 'gaps.detect', status: 'ok', lastStartedAt: at(23, 6, 5) },
        { name: 'connectors.sync', status: 'failing', lastStartedAt: at(22, 6) },
        { name: 'evals.weekly', status: 'waiting', lastStartedAt: null },
      ],
    } as unknown as OperationsOverviewView
    expect(jobsOf(view, now)).toEqual([
      {
        key: 'gaps.detect',
        job: 'Count what is not covered',
        last: 'Today, 06:05',
        result: 'Done',
      },
      {
        key: 'connectors.sync',
        job: 'Read the integrations',
        href: '/settings/integrations',
        last: 'Yesterday, 06:00',
        result: 'Failed',
      },
      { key: 'evals.weekly', job: 'Run the answer tests', last: 'Never', result: 'Not run yet' },
    ])
  })

  it('lists the sealed editions with what each changed', () => {
    const edition = (over: Partial<Edition>): Edition => ({
      seq: 1,
      label: '2026-10-23.1',
      reason: 'proposal_accepted',
      actorId: null,
      note: null,
      restores: null,
      digest: null,
      sealedAt: at(23, 9, 40),
      createdAt: at(23, 9, 40),
      live: true,
      ...over,
    })
    expect(
      editionsOf(
        [
          edition({ note: 'Units sold excludes test accounts' }),
          edition({ label: '2026-10-22.2', reason: 'item_retired', sealedAt: at(22, 8, 15) }),
          edition({ label: '2026-10-22.3', sealedAt: null }),
        ],
        now,
      ),
    ).toEqual([
      {
        label: '2026-10-23.1',
        sealed: 'Today, 09:40',
        change: 'Units sold excludes test accounts',
      },
      { label: '2026-10-22.2', sealed: 'Yesterday, 08:15', change: 'A context item was archived' },
    ])
  })
})

describe('a domain from its page', () => {
  it('takes the first paragraph of its text as its excerpt, on one line, cut at a word', () => {
    expect(summaryOf('Orders and the basket.\n\nHouse rules:\n\n- Euros.')).toBe(
      'Orders and the basket.',
    )
    expect(summaryOf('**Orders** and\nthe [@ id="metric:aov" label="basket"]')).toBe(
      'Orders and the basket',
    )
    const long = summaryOf(`${'word '.repeat(40)}end`)
    expect([...long].length).toBeLessThanOrEqual(160)
    expect(long.endsWith('word…')).toBe(true)
    expect(summaryOf('')).toBe('')
  })

  it('makes its id from its name, and another when that one is taken', () => {
    expect(freeAreaId('Customer value', new Set())).toBe('customer_value')
    expect(freeAreaId('Finance', new Set(['finance', 'finance_2']))).toBe('finance_3')
    expect(freeAreaId('Café & Bar', new Set())).toBe('cafe_bar')
    expect(freeAreaId('2026 plans', new Set())).toBe('area_2026_plans')
    expect(freeAreaId('!!', new Set())).toBe('area_domain')
  })
})
