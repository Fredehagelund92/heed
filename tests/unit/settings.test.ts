import { describe, expect, it } from 'vitest'
import { ABOUT_BUSINESS_MAX, ABOUT_BUSINESS_STARTER } from '../../src/domain/about-business.ts'
import {
  settingKeys,
  settingSchemas,
  type AuditEntry,
  type SettingKey,
} from '../../src/contract/admin.ts'
import {
  auditActionWords,
  auditByHeed,
  auditRows,
  byteWords,
  durationWords,
  fieldsOf,
  groupSettings,
  adminSectionGroups,
  adminSections,
  adminSectionsFor,
  JUDGE_MODE,
  limitsSettingGroups,
  settingFormValue,
  settingFormValues,
  settingMeta,
  settingWords,
} from '@/lib/settings'

/*
  The setting editors of Settings (slice W11b) against the contract's settingSchemas: every key
  has words and an editor, a value round-trips through its form unchanged, and what the schema
  refuses the form refuses in words, before anything is sent.
*/

const tools = [
  'get_facts',
  'get_related',
  'give_feedback',
  'improve_question',
  'read_item',
  'report_gap',
  'search_facts',
]

/** A value each setting accepts, as a fresh service starts it. */
const samples: Record<SettingKey, unknown> = {
  'privacy.min_count': 5,
  'retention.delivery_days': 180,
  'retention.note_days': 180,
  'retention.request_log_days': 90,
  'retention.outbox_days': 30,
  'gaps.no_item_threshold': { calls: 5, days: 7 },
  'limits.mcp_rate_per_minute': { get_facts: 120, give_feedback: 20, report_gap: 20 },
  'limits.mcp_requests_per_minute': { person: 30, client: 120 },
  'limits.api_rate_per_minute': { person: 600, ip: 120 },
  'limits.gap_reports_per_minute': { person: 5 },
  'limits.assistant_ratings_per_minute': { person: 20 },
  'limits.agent_drafts': { per_day: 10, open: 20 },
  'limits.web_searches_per_day': 0,
  'limits.llm_daily_micros_per_person': 2_000_000,
  'limits.llm_monthly_cap_micros': 500_000_000,
  'limits.llm_feature_monthly_micros': { assistant: 250_000_000, eval: 250_000_000 },
  'limits.mentions_per_version': 50,
  'limits.undo_seconds': 15,
  'review.default_days': 90,
  'review.open_issue_days': 14,
  'serving.max_overlay_age_seconds': 60,
  'evals.tries': 3,
  'evals.flip_repeats': 7,
  'evals.run_budget_micros': 2_000_000,
  'models.eval_answer': { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  'models.judge': 'different_family',
  'models.assistant': { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  'models.test_authoring': { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  'models.call_limits': { concurrency: 4 },
  'sources.cube_model_url': null,
  'business.about': ABOUT_BUSINESS_STARTER,
  'workspace.name': 'Larchwood Outdoor',
}

const submit = (key: SettingKey, values: Record<string, string>, current = samples[key]) =>
  settingFormValue(key, values, tools, current)

describe('every setting the contract lets an administrator change', () => {
  it('has a title, a description and words for its value', () => {
    for (const key of settingKeys) {
      const meta = settingMeta[key]
      expect(meta.title, key).toBeTruthy()
      expect(meta.description, key).toBeTruthy()
      expect(settingWords(key, samples[key]), key).not.toMatch(/NaN|undefined|\[object/)
    }
  })

  it('reads back the value it started from, unchanged and valid for the schema', () => {
    for (const key of settingKeys) {
      expect(settingSchemas[key].safeParse(samples[key]).success, key).toBe(true)
      const result = submit(key, settingFormValues(key, samples[key], tools))
      expect(result, key).toEqual({ ok: true, value: samples[key] })
    }
  })
})

describe('the editors', () => {
  it('read a number of days and refuse what the schema refuses, in its unit', () => {
    expect(submit('review.default_days', { value: '120' })).toEqual({ ok: true, value: 120 })
    expect(submit('review.default_days', { value: '0' })).toEqual({
      ok: false,
      errors: { value: 'Use at least 1 day.' },
    })
    expect(submit('review.default_days', { value: '4000' })).toEqual({
      ok: false,
      errors: { value: 'Use at most 3,650 days.' },
    })
    expect(submit('review.default_days', { value: '1.5' })).toEqual({
      ok: false,
      errors: { value: 'Enter a whole number.' },
    })
    expect(submit('review.default_days', { value: '' })).toEqual({
      ok: false,
      errors: { value: 'Enter a whole number.' },
    })
  })

  it('keep the repeats odd, so a majority decides', () => {
    expect(submit('evals.flip_repeats', { value: '4' })).toEqual({
      ok: false,
      errors: { value: 'Use an odd number, so a majority decides.' },
    })
    expect(submit('evals.flip_repeats', { value: '5' })).toEqual({ ok: true, value: 5 })
  })

  it('read dollars as millionths and say limits in dollars', () => {
    expect(settingFormValues('limits.llm_daily_micros_per_person', 2_000_000, tools)).toEqual({
      value: '2.00',
    })
    expect(submit('limits.llm_daily_micros_per_person', { value: '$3.25' })).toEqual({
      ok: true,
      value: 3_250_000,
    })
    expect(submit('limits.llm_daily_micros_per_person', { value: 'two' })).toEqual({
      ok: false,
      errors: { value: 'Enter an amount in dollars, such as 2.50.' },
    })
    expect(submit('limits.llm_monthly_cap_micros', { value: '2000000' })).toEqual({
      ok: false,
      errors: { value: 'Use at most $1,000,000.00.' },
    })
  })

  it('name the field of an object value that is wrong', () => {
    expect(submit('gaps.no_item_threshold', { calls: '5', days: '400' })).toEqual({
      ok: false,
      errors: { days: 'Use at most 365 days.' },
    })
    expect(submit('limits.mcp_requests_per_minute', { person: '', client: '120' })).toEqual({
      ok: false,
      errors: { person: 'Enter a whole number.' },
    })
  })

  it('leave an empty feature or tool out, so it has no limit of its own', () => {
    expect(submit('limits.llm_feature_monthly_micros', { assistant: '100', eval: '' })).toEqual({
      ok: true,
      value: { assistant: 100_000_000 },
    })
    const toolFields = fieldsOf(
      'limits.mcp_rate_per_minute',
      samples['limits.mcp_rate_per_minute'],
      tools,
    )
    expect(toolFields.map((field) => field.name)).toEqual(expect.arrayContaining(tools))
    expect(
      submit('limits.mcp_rate_per_minute', {
        get_facts: '90',
        search_facts: '30',
      }),
    ).toEqual({ ok: true, value: { get_facts: 90, search_facts: 30 } })
  })

  it('choose the judge: another model line, or a model named here', () => {
    expect(settingFormValues('models.judge', 'different_family', tools)).toEqual({
      [JUDGE_MODE]: 'different_family',
      provider: '',
      model: '',
    })
    expect(
      submit('models.judge', { [JUDGE_MODE]: 'model', provider: 'anthropic', model: '' }),
    ).toEqual({ ok: false, errors: { model: 'Enter the model.' } })
    expect(
      submit('models.judge', {
        [JUDGE_MODE]: 'model',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
      }),
    ).toEqual({ ok: true, value: { provider: 'anthropic', model: 'claude-haiku-4-5' } })
  })

  it('take an empty model folder address as none, and refuse an address with a query', () => {
    expect(submit('sources.cube_model_url', { value: '  ' })).toEqual({ ok: true, value: null })
    expect(
      submit('sources.cube_model_url', { value: 'https://github.com/acme/model?tab=1' }),
    ).toEqual({
      ok: false,
      errors: {
        value: 'Use an https address without a user name, password, query or fragment.',
      },
    })
  })
})

describe('About our business', () => {
  const about = settingSchemas['business.about']

  it('keeps plain text within its cap, in the form Heed sends it', () => {
    expect(
      about.safeParse('  We run marketplace sites.\r\n\r\n\r\nFTD: a first orderor.  '),
    ).toEqual({ success: true, data: 'We run marketplace sites.\n\nFTD: a first orderor.' })
    expect(about.safeParse('').success).toBe(true)
    expect(about.safeParse('é'.repeat(ABOUT_BUSINESS_MAX)).success).toBe(true)
    expect(about.safeParse('é'.repeat(ABOUT_BUSINESS_MAX + 1)).success).toBe(false)
    expect(about.safeParse(null).success).toBe(false)
    // The starter text fits, with room to spare, and is already in the form Heed keeps.
    expect(about.safeParse(ABOUT_BUSINESS_STARTER)).toEqual({
      success: true,
      data: ABOUT_BUSINESS_STARTER,
    })
    expect([...ABOUT_BUSINESS_STARTER].length).toBeLessThan(ABOUT_BUSINESS_MAX)
  })

  it('says a version in a few words: its start and length, or that nothing is given', () => {
    expect(settingWords('business.about', 'We run marketplace sites.\nFTD: a first orderor.')).toBe(
      'We run marketplace sites. (47 characters)',
    )
    expect(settingWords('business.about', ABOUT_BUSINESS_STARTER)).toMatch(
      /^We are an outdoor-gear retailer\. We sell footwear, clothing, camping and clim\.\.\. \(1,102 characters\)$/,
    )
    expect(settingWords('business.about', '')).toBe('Empty')
  })

  it('names no company and draws no legal conclusion in the starter text', () => {
    expect(ABOUT_BUSINESS_STARTER).toMatch(/^We are an outdoor-gear retailer\./)
    for (const term of [
      'Order',
      'Return',
      'First-time buyer',
      'Marketplace',
      'Marketplace commission',
      'Gross margin',
      'Market',
      'Selling country',
      'Season',
    ])
      expect(ABOUT_BUSINESS_STARTER).toContain(term)
    expect(ABOUT_BUSINESS_STARTER).not.toMatch(
      /better ?collective|\blegal\b|\billegal\b|\bbanned\b|\bprohibit/i,
    )
  })
})

describe('what the screen says', () => {
  it('lists the settings by group, in the contract order inside each', () => {
    const groups = groupSettings(settingKeys.map((key) => ({ key })))
    expect(groups.map((entry) => entry.group)).toEqual([
      'review',
      'limits',
      'spending',
      'privacy',
      'tests',
      'models',
      'sources',
      'business',
    ])
    expect(groups.flatMap((entry) => entry.settings)).toHaveLength(settingKeys.length)
    expect(groupSettings([{ key: 'legacy.unknown' }])).toEqual([])
    // A source's settings are on its page in Sources, and About our business has its own
    // section: neither is on Limits.
    const limits = groupSettings(
      settingKeys.map((key) => ({ key })),
      limitsSettingGroups,
    ).flatMap((entry) => entry.settings.map((setting) => setting.key))
    expect(limits).not.toContain('sources.cube_model_url')
    expect(limits).not.toContain('business.about')
  })

  it('says values and actions in words', () => {
    expect(settingWords('gaps.no_item_threshold', { calls: 5, days: 7 })).toBe('5 calls in 7 days')
    expect(settingWords('limits.llm_feature_monthly_micros', {})).toBe('Only the monthly cap')
    // Web search is off at 0, the default, and otherwise says its daily cap.
    expect(settingWords('limits.web_searches_per_day', 0)).toBe('Off')
    expect(settingWords('limits.web_searches_per_day', 10)).toBe('On, 10 searches a day per person')
    expect(settingWords('limits.web_searches_per_day', 1)).toBe('On, 1 search a day per person')
    expect(settingWords('models.judge', 'different_family')).toBe(
      'Another model line than the model that answers',
    )
    expect(auditActionWords('setting.changed')).toBe('Setting changed')
    // The log keeps its keys; only how a row reads follows the glossary.
    expect(auditActionWords('edition.published')).toBe('Shared with agents')
    expect(auditActionWords('item.retired')).toBe('Fact archived')
    expect(auditActionWords('client_policy.changed')).toBe('Agent changed')
    expect(auditActionWords('proposal.test_attached')).toBe('Test question added to a proposal')
    // An action the screen doesn't know reads from its parts.
    expect(auditActionWords('report.exported')).toBe('Report exported')
    expect(byteWords(15_400_000)).toBe('15.4 MB')
    expect(byteWords(640)).toBe('640 bytes')
    expect(durationWords(1_890)).toBe('1.9 s')
    expect(durationWords(null)).toBe('No calls timed')
  })
})

describe('the history log on screen', () => {
  let seq = 100
  const entry = (patch: Partial<AuditEntry>): AuditEntry => ({
    seq: seq--,
    at: '2026-10-13T07:50:00.000Z',
    actorId: 'per_maria',
    actorName: 'Maria Lindqvist',
    actorKind: 'person',
    action: 'proposal.saved',
    areaId: 'area_commercial',
    subjectType: 'proposal',
    subjectId: 'p1',
    requestId: null,
    details: {},
    hash: '',
    batchId: null,
    reason: null,
    source: null,
    ...patch,
  })

  it('shows autosaves of one proposal by one person in a row as one row, and nothing else', () => {
    const entries = [
      entry({ action: 'proposal.submitted' }),
      entry({}),
      entry({}),
      entry({}),
      entry({ subjectId: 'p2' }),
      entry({ actorId: 'per_jon' }),
      entry({ action: 'proposal.created' }),
      entry({}),
    ]
    expect(auditRows(entries).map((row) => [row.entry.seq, row.entries.length])).toEqual([
      [entries[0]!.seq, 1],
      [entries[1]!.seq, 3],
      [entries[4]!.seq, 1],
      [entries[5]!.seq, 1],
      [entries[6]!.seq, 1],
      [entries[7]!.seq, 1],
    ])
    // Every entry is still there, in order.
    expect(auditRows(entries).flatMap((row) => row.entries)).toEqual(entries)
  })

  it("credits the checks Heed ran to Heed, and a person's own changes to the person", () => {
    expect(auditByHeed(entry({ action: 'proposal.checked' }))).toBe(true)
    expect(auditByHeed(entry({ action: 'proposal.submitted' }))).toBe(false)
    expect(auditByHeed(entry({ action: 'item.flagged', actorKind: 'system' }))).toBe(true)
  })
})

describe('who sees which section of Administration', () => {
  const none = { roles: [], assignments: [] }
  it('gives a contributor, an owner and an approver none: their settings are their own', () => {
    expect(adminSectionsFor(none)).toEqual([])
    expect(
      adminSectionsFor({
        roles: [],
        assignments: [{ areaId: 'area_commercial', role: 'owner' }],
      }),
    ).toEqual([])
    expect(
      adminSectionsFor({
        roles: [],
        assignments: [{ areaId: 'area_commercial', role: 'approver' }],
      }),
    ).toEqual([])
  })
  it('gives an auditor the history log only, and an administrator every section', () => {
    expect(adminSectionsFor({ roles: ['auditor'], assignments: [] })).toEqual(['audit'])
    expect(adminSectionsFor({ roles: ['administrator'], assignments: [] })).toEqual([
      'domains',
      'business',
      'people',
      'sources',
      'limits',
      'gateway',
      'import',
      'audit',
      'operations',
    ])
  })
  it('groups every section once, Workspace then Oversight', () => {
    expect(adminSectionGroups.map((group) => group.title)).toEqual(['Workspace', 'Oversight'])
    expect(adminSectionGroups.flatMap((group) => group.sections)).toEqual([...adminSections])
  })
})
