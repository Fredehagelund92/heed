import type { Advanced, Exported } from '../client'
import { SLUG } from '@/lib/brand'
import { DEFINITIONS_TOOL } from '@/model/integrations'
import { logLine, relativeDate } from '@/model/history'
import type { LogEntry } from '@/model/items'

// Settings, Advanced in the demo: the tuning settings people ask about, what was deleted, the
// history log, the jobs and the editions, as Larchwood Outdoor's week has them. The deletions and
// the log's first lines come from the changes made to many items this visit.

const limits: Advanced['limits'] = [
  { key: 'review.default_days', value: '90', what: "Days until a context item's check is due" },
  {
    key: 'gaps.no_item_threshold',
    value: '5 in 7 days',
    what: 'Questions with nothing written down before a Not found card',
  },
  { key: 'privacy.min_count', value: '5', what: 'Counts under this are hidden' },
  {
    key: 'privacy.questions',
    value: 'Scope and count',
    what: "What is kept of an agent's question: what it was about and how often, never the words or who asked",
  },
  { key: 'serving.max_reply_bytes', value: '100 KB', what: 'The most an agent gets in one reply' },
  { key: 'limits.agent_suggestions', value: '20 a day', what: 'Suggestions one agent can send' },
  {
    key: 'spend.monthly_cap',
    value: '$50',
    what: 'All model use in a month; at the cap Ask and web reads stop and say why',
  },
  { key: 'spend.person_daily_cap', value: '$2', what: 'Model use by one person in a day' },
  { key: 'spend.answer_tests_cap', value: '$20', what: 'Answer tests in a month' },
]

const toolHref = '/settings/integrations/cube'

/** What Settings, Advanced shows in the demo, with what this visit changed on top. */
export function advancedOf(log: readonly LogEntry[]): Advanced {
  return {
    limits,
    settings: 28,
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
