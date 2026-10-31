import type { Advanced, Exported } from '../client'
import { SLUG } from '@/lib/brand'
import { DEFINITIONS_TOOL } from '@/model/integrations'
import { logLine, relativeDate } from '@/model/history'
import type { LogEntry } from '@/model/items'
import { type SettingChange, settingGroups } from '@/model/settings'
import { WORKSPACE_NAME } from './data/world'

// Settings, Advanced in the demo: every tuning setting, what was deleted, the
// history log, the jobs and the editions, as Larchwood Outdoor's week has them. The deletions and
// the log's first lines come from the changes made to many items this visit.

/** Who changed the demo's money caps, so its Observability reads $50 and $20 a month. */
const capped = {
  who: 'Jon Abara',
  when: '5 Oct',
  why: 'Keep the pilot cheap until the answer tests prove their worth',
}

/** Every tuning setting in the demo: the values it was installed with, but for the name and caps. */
function settingsOf(name: string, about: string, autoPublish: boolean) {
  const values: [key: string, value: unknown, changed?: SettingChange][] = [
    ['workspace.name', name, { who: 'Jon Abara', when: '1 Oct', why: 'Name the workspace' }],
    ['business.about', about],
    ['sources.cube_model_url', null],
    ['review.default_days', 90],
    ['review.open_issue_days', 14],
    ['gaps.no_item_threshold', { calls: 5, days: 7 }],
    ['limits.undo_seconds', 15],
    ['limits.mentions_per_version', 50],
    ['privacy.min_count', 5],
    ['retention.delivery_days', 180],
    ['retention.note_days', 180],
    ['retention.request_log_days', 90],
    ['retention.outbox_days', 30],
    // Publishing without review: off as installed, until an admin switches it on in the demo.
    autoPublish
      ? [
          'agents.auto_publish',
          true,
          { who: 'Jon Abara', when: 'Today', why: 'Changed in Settings, Agents and access.' },
        ]
      : ['agents.auto_publish', false],
    ['limits.agent_drafts', { per_day: 10, open: 20 }],
    ['limits.mcp_requests_per_minute', { person: 30, client: 120 }],
    ['limits.mcp_rate_per_minute', { get_context: 120, report: 20 }],
    ['limits.api_rate_per_minute', { person: 600, ip: 120 }],
    ['limits.gap_reports_per_minute', { person: 5 }],
    ['limits.assistant_ratings_per_minute', { person: 20 }],
    ['limits.web_searches_per_day', 0],
    ['serving.max_overlay_age_seconds', 60],
    ['limits.llm_monthly_cap_micros', 50_000_000, capped],
    ['limits.llm_daily_micros_per_person', 2_000_000],
    ['limits.llm_feature_monthly_micros', { eval: 20_000_000, assistant: 250_000_000 }, capped],
    ['evals.run_budget_micros', 2_000_000],
    ['models.assistant', { provider: 'anthropic', model: 'claude-sonnet-5-5' }],
    ['models.eval_answer', { provider: 'anthropic', model: 'claude-sonnet-5-5' }],
    ['models.judge', 'different_family'],
    ['models.test_authoring', { provider: 'anthropic', model: 'claude-sonnet-5-5' }],
    ['models.call_limits', { concurrency: 4 }],
    ['evals.tries', 3],
    ['evals.flip_repeats', 7],
  ]
  return settingGroups(
    values.map(([key, value, changed]) => ({ key, value, changed: changed ?? null })),
  )
}

const toolHref = '/settings/integrations/cube'

/** What Settings, Advanced shows in the demo, with what this visit changed on top. */
export function advancedOf(log: readonly LogEntry[], about = '', autoPublish = false): Advanced {
  return {
    settings: settingsOf(WORKSPACE_NAME, about, autoPublish),
    // Newest first: drafts and terms. Published context is archived, never deleted.
    deleted: [
      ...log
        .filter((e) => e.what === 'deleted')
        .flatMap((e) =>
          e.items.map((i) => ({
            key: `${e.id}.${i.id}`,
            title: i.title,
            hint: `Deleted by ${e.who}, ${relativeDate(e.on)}: ${e.summary.replace(/^Deleted: /, '')}`,
            domain: i.domain ?? null,
          })),
        ),
      {
        key: 'seed',
        title: 'Payment provider test in Sandbox',
        hint: 'Deleted by Ravi Kapoor, 3 Oct: a draft nobody published.',
        domain: 'sandbox',
      },
    ],
    history: [
      ...log.map((e) => ({
        key: e.id,
        when: relativeDate(e.on).replace(/^./, (c) => c.toUpperCase()),
        who: e.who,
        what: logLine(e),
      })),
      {
        key: 'h4',
        when: '22 Oct, 09:40',
        who: 'Jon Abara',
        what: 'Published “Units sold excludes test accounts”, version 2',
      },
      {
        key: 'h3',
        when: '21 Oct, 16:40',
        who: 'Cursor for Kofi Mensah',
        what: 'Suggested “Payment provider delays order data in Poland”',
      },
      {
        key: 'h2',
        when: '20 Oct, 11:02',
        who: 'Jon Abara',
        what: 'Suggested a change to “Norway launch campaign started on 24 March 2026”',
      },
      {
        key: 'h1',
        when: '7 Oct, 06:00',
        who: 'Automatic',
        what: `Read ${DEFINITIONS_TOOL}: 2 definitions changed`,
        href: toolHref,
      },
      {
        key: 'h0',
        when: '5 Oct, 10:12',
        who: 'Jon Abara',
        what: 'Changed a setting: limits.llm_monthly_cap_micros',
      },
      {
        key: 'h-1',
        when: '5 Oct, 10:11',
        who: 'Jon Abara',
        what: 'Changed a setting: limits.llm_feature_monthly_micros',
      },
      {
        key: 'h-2',
        when: '1 Oct, 09:30',
        who: 'Jon Abara',
        what: 'Changed a setting: workspace.name',
      },
    ],
    jobs: [
      {
        key: 'cube',
        job: `Read ${DEFINITIONS_TOOL}`,
        href: toolHref,
        last: 'Today, 06:00',
        result: 'Done',
      },
      {
        key: 'drive',
        job: 'Read Google Drive',
        href: '/settings/integrations/google-drive',
        last: 'Today, 06:00',
        result: 'Done',
      },
      { key: 'gaps', job: 'Count what is not covered', last: 'Today, 06:05', result: 'Done' },
      { key: 'checks', job: 'Remind owners of checks due', last: 'Today, 07:00', result: 'Done' },
    ],
    editions: [
      {
        label: '2026-10-22.4',
        sealed: 'Today, 09:40',
        change: 'Units sold excludes test accounts',
      },
      {
        label: '2026-10-22.3',
        sealed: 'Today, 08:15',
        change: 'Checked: Online sales to Norway stopped',
      },
      {
        label: '2026-10-21.2',
        sealed: 'Yesterday',
        change: 'Archived: Payment provider switched in Norway',
      },
    ],
  }
}

/** The demo's history log as a file: what the log shows, one entry a line. */
export const historyFile = (log: readonly LogEntry[]): Exported => ({
  name: 'history-2026-10-22.jsonl',
  type: 'application/jsonl',
  content: advancedOf(log)
    .history.map((h) => JSON.stringify({ when: h.when, who: h.who, what: h.what }))
    .join('\n'),
})

/** The demo's context as a file: every item agents get. */
export const contextFile = (items: readonly { id: string; title: string }[]): Exported => ({
  name: 'context-2026-10-22.json',
  type: 'application/json',
  content: JSON.stringify({ items }, null, 2),
})

/** The key a bot would use in the demo: invented, never one that works anywhere. */
export const demoAccessKey = () =>
  `${SLUG}_demo_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')}`
