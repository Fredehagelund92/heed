// The tuning settings Settings, Advanced lists, read only: every setting an administrator may
// change (settingSchemas in src/contract/admin.ts), in groups, each with what it does and its
// value in words. Both bindings list them through `settingGroups`, so the demo and the service
// read the same.

/**
 * Who changed a setting last, when and why; null while it keeps the value it was installed with.
 * `who` is null for a change no person made: an update of the app or a script.
 */
export type SettingChange = { who: string | null; when: string; why: string | null }

/** One setting as Advanced lists it. */
export type SettingRow = {
  key: string
  value: string
  what: string
  changed: SettingChange | null
}

/** A group of settings and its rows, in the order Advanced lists them. */
export type SettingGroup = { group: string; rows: SettingRow[] }

const n = (value: unknown) => (typeof value === 'number' ? value : 0)
const field = (value: unknown, key: string) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
const count = (value: unknown, one: string, many = `${one}s`) =>
  `${n(value).toLocaleString('en')} ${n(value) === 1 ? one : many}`
const days = (value: unknown) => count(value, 'day')
const seconds = (value: unknown) => count(value, 'second')
const perMinute = (value: unknown) => `${n(value).toLocaleString('en')} a minute`
/** Model spend is kept in millionths of a dollar. */
const dollars = (micros: unknown) => {
  const amount = n(micros) / 1_000_000
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: amount < 10 ? 2 : 0 })}`
}
const model = (value: unknown) => {
  const provider = field(value, 'provider')
  const name = field(value, 'model')
  return typeof provider === 'string' && typeof name === 'string' ? `${name} (${provider})` : 'None'
}
const text = (value: unknown, empty: string) => (typeof value === 'string' && value ? value : empty)

type Entry = { key: string; what: string; value: (v: unknown) => string }

/** Every setting, by group. A setting the service has and this list lacks goes under Other. */
const GROUPS: { group: string; settings: Entry[] }[] = [
  {
    group: 'Workspace',
    settings: [
      {
        key: 'workspace.name',
        what: 'The workspace’s name, on the share card and for the people in it',
        value: (v) => text(v, 'No name yet'),
      },
      {
        key: 'business.about',
        what: 'About our business: background the assistant and agents get, never evidence',
        value: (v) => (typeof v === 'string' && v ? count(v.length, 'character') : 'No text yet'),
      },
      {
        key: 'sources.cube_model_url',
        what: 'Where your definitions source’s model files are on the Git host, for links to them',
        value: (v) => text(v, 'Off'),
      },
    ],
  },
  {
    group: 'Review',
    settings: [
      {
        key: 'review.default_days',
        what: 'Days until a context item’s check is due',
        value: days,
      },
      {
        key: 'review.open_issue_days',
        what: 'Days until a warning with no end is asked whether it still goes on',
        value: days,
      },
      {
        key: 'gaps.no_item_threshold',
        what: 'Questions with nothing written down before a Not found card',
        value: (v) => `${n(field(v, 'calls'))} in ${days(field(v, 'days'))}`,
      },
      {
        key: 'limits.undo_seconds',
        what: 'How long Undo works after a decision',
        value: seconds,
      },
      {
        key: 'limits.mentions_per_version',
        what: 'Mentions one version of a context item can have',
        value: (v) => String(n(v)),
      },
    ],
  },
  {
    group: 'Privacy and retention',
    settings: [
      {
        key: 'privacy.min_count',
        what: 'Counts under this are hidden',
        value: (v) => String(n(v)),
      },
      {
        key: 'retention.delivery_days',
        what: 'How long the full record of what agents were given is kept; weekly counts, with no words and no person, are kept for good',
        value: days,
      },
      {
        key: 'retention.note_days',
        what: 'How long the notes sent with a Not found report or a rating are kept',
        value: days,
      },
      {
        key: 'retention.request_log_days',
        what: 'How long the log of agents’ requests is kept',
        value: days,
      },
      {
        key: 'retention.outbox_days',
        what: 'How long a change waiting to reach the Inbox is kept after it went',
        value: days,
      },
    ],
  },
  {
    group: 'Agents and requests',
    settings: [
      {
        key: 'agents.auto_publish',
        what: 'Owners can let an agent publish without review',
        value: (v) => (v === true ? 'On' : 'Off'),
      },
      {
        key: 'limits.agent_drafts',
        what: 'Suggestions one person’s agents can send',
        value: (v) => `${n(field(v, 'per_day'))} a day, ${n(field(v, 'open'))} waiting at once`,
      },
      {
        key: 'limits.mcp_requests_per_minute',
        what: 'Requests agents can make',
        value: (v) =>
          `${perMinute(field(v, 'person'))} for one person, ${perMinute(field(v, 'client'))} for one kind of agent`,
      },
      {
        key: 'limits.mcp_rate_per_minute',
        what: 'Calls a minute to each tool, for one person',
        value: (v) =>
          v && typeof v === 'object' && Object.keys(v).length
            ? Object.entries(v as Record<string, unknown>)
                .map(([tool, rate]) => `${tool} ${n(rate)}`)
                .join(', ')
            : 'No limit of their own',
      },
      {
        key: 'limits.api_rate_per_minute',
        what: 'Requests to the web app’s service',
        value: (v) =>
          `${perMinute(field(v, 'person'))} for one person, ${perMinute(field(v, 'ip'))} before sign-in`,
      },
      {
        key: 'limits.gap_reports_per_minute',
        what: 'Not found reports one person can send from Ask',
        value: (v) => perMinute(field(v, 'person')),
      },
      {
        key: 'limits.assistant_ratings_per_minute',
        what: 'Ratings one person can give the assistant’s answers',
        value: (v) => perMinute(field(v, 'person')),
      },
      {
        key: 'limits.web_searches_per_day',
        what: 'Web searches one person’s assistant can run in a day; 0 is off',
        value: (v) => (n(v) ? `${n(v)} a day` : 'Off'),
      },
      {
        key: 'serving.max_overlay_age_seconds',
        what: 'How soon Pause sharing reaches every request',
        value: seconds,
      },
    ],
  },
  {
    group: 'Model spend',
    settings: [
      {
        key: 'limits.llm_monthly_cap_micros',
        what: 'All model use in a month; at the cap Ask and web reads stop and say why',
        value: dollars,
      },
      {
        key: 'limits.llm_daily_micros_per_person',
        what: 'Model use by one person in a day',
        value: dollars,
      },
      {
        key: 'limits.llm_feature_monthly_micros',
        what: 'Model use in a month by answer tests and by the assistant',
        value: (v) => {
          const eval_ = field(v, 'eval')
          const assistant = field(v, 'assistant')
          return eval_ === undefined && assistant === undefined
            ? 'No cap of their own'
            : [
                eval_ === undefined ? null : `answer tests ${dollars(eval_)}`,
                assistant === undefined ? null : `assistant ${dollars(assistant)}`,
              ]
                .filter(Boolean)
                .join(', ')
                .replace(/^./, (c) => c.toUpperCase())
        },
      },
      {
        key: 'evals.run_budget_micros',
        what: 'An answer test run estimated above this waits for an Admin',
        value: dollars,
      },
    ],
  },
  {
    group: 'Models',
    settings: [
      { key: 'models.assistant', what: 'The model that answers in Ask', value: model },
      { key: 'models.eval_answer', what: 'The model that answers in answer tests', value: model },
      {
        key: 'models.judge',
        what: 'The model that judges answer tests',
        value: (v) =>
          v === 'different_family' ? 'Another line than the answering model' : model(v),
      },
      {
        key: 'models.test_authoring',
        what: 'The model for drafting test questions; nothing uses it yet',
        value: model,
      },
      {
        key: 'models.call_limits',
        what: 'How hard answer tests may call a model provider',
        value: (v) =>
          [
            `${n(field(v, 'concurrency'))} at once`,
            field(v, 'requests_per_minute') === undefined
              ? null
              : `${perMinute(field(v, 'requests_per_minute'))} requests`,
            field(v, 'tokens_per_minute') === undefined
              ? null
              : `${perMinute(field(v, 'tokens_per_minute'))} tokens`,
          ]
            .filter(Boolean)
            .join(', '),
      },
    ],
  },
  {
    group: 'Answer tests',
    settings: [
      {
        key: 'evals.tries',
        what: 'Tries of each test question in a run',
        value: (v) => String(n(v)),
      },
      {
        key: 'evals.flip_repeats',
        what: 'Repeats that decide whether a result flipped; the majority decides',
        value: (v) => String(n(v)),
      },
    ],
  },
]

/** The keys of every setting Advanced names, in its order. */
export const SETTING_KEYS = GROUPS.flatMap((g) => g.settings.map((s) => s.key))

/** A value no entry says in words: as the service stores it. */
const raw = (value: unknown) =>
  typeof value === 'string' ? value || 'Empty' : (JSON.stringify(value) ?? 'None')

/**
 * The settings in groups, each with its value in words and who changed it last. A setting the list
 * does not name still shows, under Other, so nothing the service has is hidden.
 */
export function settingGroups(
  settings: readonly { key: string; value: unknown; changed: SettingChange | null }[],
): SettingGroup[] {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  const named = new Set(SETTING_KEYS)
  const groups = GROUPS.map(({ group, settings: entries }) => ({
    group,
    rows: entries.flatMap((e) => {
      const s = byKey.get(e.key)
      return s ? [{ key: e.key, value: e.value(s.value), what: e.what, changed: s.changed }] : []
    }),
  }))
  const other = settings
    .filter((s) => !named.has(s.key))
    .map((s) => ({ key: s.key, value: raw(s.value), what: '', changed: s.changed }))
  return [...groups, { group: 'Other', rows: other }].filter((g) => g.rows.length)
}
