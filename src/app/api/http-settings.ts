/**
 * Settings on the http binding: what the service says, in the words the Settings screens use. The
 * agents people connected, Pause sharing and the tools agents call, and Settings, Advanced (the
 * tuning settings, read only; what was deleted; the history log; the jobs; the editions). Pure, so
 * it is unit tested (tests/app/api/http-settings.test.ts).
 */
import type { AuditEntry, Setting } from '@contract/admin'
import type { DeletedDraft, ItemChange } from '@contract/context'
import type { OperationsOverviewView } from '@contract/index'
import type { Edition } from '@contract/review'
import type { DeletedTerm } from '@contract/terms'
import { AGENT_TOOLS } from '@/lib/agents'
import type { Connected } from '@/lib/connect'
import { logLine } from '@/model/history'
import type { Advanced, Settings } from './client'
import { whenWords } from './http-inbox'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day as a connected agent's row says it: "2 Oct 2026". */
const dayOf = (at: string) => {
  const t = new Date(at)
  return `${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`
}

/** When an agent last used its connection: "Just now", "Today", "Yesterday", "3 days ago", "2 Oct". */
export function usedWords(at: string, now: Date): string {
  const t = new Date(at)
  if (now.getTime() - t.getTime() < 5 * 60_000) return 'Just now'
  const words = whenWords(at, now)
  if (words.startsWith('Today')) return 'Today'
  if (words.startsWith('Yesterday')) return 'Yesterday'
  const days = Math.round((now.getTime() - t.getTime()) / 86_400_000)
  return days < 7 ? `${days} days ago` : words
}

/** A connection the list shows: the person's own, or anyone's for an admin. */
export type Listed = {
  clientName: string
  connectedAt: string
  lastUsedAt: string
  person?: { name: string }
}

/** How long after it signed in an agent reads as new on the list. */
const NEW_MS = 15 * 60_000

/**
 * The agents connected, newest sign-in first, one row per agent and person: an agent that signed
 * in again keeps one row, with its newest sign-in. `me` names the person's own.
 */
export function connectedOf(rows: readonly Listed[], me: string, now: Date): Connected[] {
  const newest = new Map<string, Listed>()
  for (const r of rows) {
    const key = `${r.clientName}\n${r.person?.name ?? me}`
    const kept = newest.get(key)
    if (!kept || kept.connectedAt < r.connectedAt) newest.set(key, r)
  }
  return [...newest.values()]
    .sort((a, b) => (a.connectedAt < b.connectedAt ? 1 : a.connectedAt > b.connectedAt ? -1 : 0))
    .map((r) => ({
      agent: r.clientName,
      who: r.person?.name ?? me,
      since: dayOf(r.connectedAt),
      used: usedWords(r.lastUsedAt, now),
      ...(now.getTime() - new Date(r.connectedAt).getTime() < NEW_MS ? { fresh: true } : {}),
    }))
}

/** The tools Settings switches, by the ids the service and agents know. */
const SWITCHED = AGENT_TOOLS.map((t) => t.name)

/** The tools agents may call and what is paused, from what everyone signed in may read. */
export function switchesOf(
  tools: readonly { tool: string; enabled: boolean }[],
  stops: readonly { scope: string; areaId: string | null }[],
): Pick<Settings, 'links' | 'tools' | 'pause'> {
  const on = (name: string) => tools.find((t) => t.tool === name)?.enabled ?? false
  return {
    links: on('get_related'),
    tools: Object.fromEntries(SWITCHED.filter((n) => n !== 'get_related').map((n) => [n, on(n)])),
    pause: {
      all: stops.some((s) => s.scope === 'all'),
      domain: stops.find((s) => s.scope === 'area')?.areaId ?? null,
    },
  }
}

/* ---------- Advanced ---------- */

const n = (value: unknown) => (typeof value === 'number' ? value : 0)
const field = (value: unknown, key: string) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
const days = (value: unknown) => `${n(value)} ${n(value) === 1 ? 'day' : 'days'}`
/** Model spend is kept in millionths of a dollar. */
const dollars = (micros: unknown) => {
  const amount = n(micros) / 1_000_000
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: amount < 10 ? 2 : 0 })}`
}

/**
 * The tuning settings people ask about, in the order Advanced lists them: each with its value in
 * words and what it does. Every other setting is counted, not listed.
 */
const LIMITS: { key: string; what: string; value: (v: unknown) => string }[] = [
  {
    key: 'review.default_days',
    what: "Days until a context item's check is due",
    value: (v) => String(n(v)),
  },
  {
    key: 'review.open_issue_days',
    what: 'Days until a warning with no end is asked whether it still goes on',
    value: (v) => String(n(v)),
  },
  {
    key: 'gaps.no_item_threshold',
    what: 'Questions with nothing written down before a Not found card',
    value: (v) => `${n(field(v, 'calls'))} in ${days(field(v, 'days'))}`,
  },
  { key: 'privacy.min_count', what: 'Counts under this are hidden', value: (v) => String(n(v)) },
  {
    key: 'limits.agent_drafts',
    what: "Suggestions one person's agents can send",
    value: (v) => `${n(field(v, 'per_day'))} a day, ${n(field(v, 'open'))} waiting at once`,
  },
  {
    key: 'limits.mcp_requests_per_minute',
    what: 'Requests agents can make',
    value: (v) => `${n(field(v, 'person'))} a minute for one person`,
  },
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
    what: 'Answer tests in a month',
    value: (v) =>
      field(v, 'eval') === undefined ? 'No cap of their own' : dollars(field(v, 'eval')),
  },
  {
    key: 'limits.undo_seconds',
    what: 'How long Undo works after a decision',
    value: (v) => `${n(v)} seconds`,
  },
  {
    key: 'retention.delivery_days',
    what: 'How long what agents were given is kept, as scopes and counts',
    value: days,
  },
  {
    key: 'retention.request_log_days',
    what: "How long the log of agents' requests is kept",
    value: days,
  },
]

/** The tuning settings, read only, and how many settings there are. */
export function limitsOf(settings: readonly Setting[]): Pick<Advanced, 'limits' | 'settings'> {
  const byKey = new Map(settings.map((s) => [s.key, s]))
  return {
    limits: LIMITS.flatMap((l) => {
      const setting = byKey.get(l.key)
      return setting ? [{ key: l.key, what: l.what, value: l.value(setting.value) }] : []
    }),
    settings: settings.filter((s) => s.editable).length,
  }
}

const list = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** Drafts and terms deleted for good, newest first, each with who deleted it and when. */
export function deletedOf(
  drafts: readonly DeletedDraft[],
  terms: readonly DeletedTerm[],
  person: (id: string | null) => string,
  now: Date,
): Advanced['deleted'] {
  const when = (at: string) =>
    whenWords(at, now).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase())
  return [
    ...drafts.map((d) => ({
      at: d.at,
      key: `draft.${d.id}`,
      title: d.title,
      hint: `Deleted by ${person(d.personId)}, ${when(d.at)}: a draft nobody published.`,
      domain: d.areaId,
    })),
    ...terms.map((t) => ({
      at: t.at,
      key: `term.${t.id}`,
      title: t.name,
      hint: `Deleted by ${person(t.personId)}, ${when(t.at)}: ${t.sameAs ? `another name for ${t.sameAs}` : 'a term'}${t.synonyms.length ? `, with its synonyms ${list(t.synonyms)}` : ''}.`,
      domain: t.areaId,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map(({ at: _at, ...row }) => row)
}

/** What the history log names, in the screens' words: the domain, the context item, the agent. */
const SUBJECTS: Record<string, string> = {
  area: 'a domain',
  item: 'a context item',
  proposal: 'a suggestion',
  setting: 'a setting',
  ai_client: 'an agent',
  ai_connection: 'an agent',
  member: 'a person',
  person: 'a person',
  invite: 'an invite',
  term: 'a term',
  edition: 'what agents get',
  stop: 'sharing',
  tool: 'a tool',
  comment: 'a comment',
  report: 'a report',
  source: 'an integration',
  figures: 'figures in Ask',
}

/** The verbs of the history log's actions, as a sentence starts. */
const VERBS: Record<string, string> = {
  created: 'Created',
  changed: 'Changed',
  deleted: 'Deleted',
  archived: 'Archived',
  restored: 'Restored',
  published: 'Published',
  submitted: 'Suggested',
  accepted: 'Published',
  rejected: 'Returned',
  withdrawn: 'Withdrew',
  connected: 'Connected',
  disconnected: 'Disconnected',
  revoked: 'Ended',
  on: 'Paused',
  off: 'Resumed',
  invited: 'Invited',
  removed: 'Removed',
  sealed: 'Sealed',
}

/**
 * One entry of the history log as a line: "Changed a setting: workspace.name", "Paused sharing in
 * Sales". `domain` names a domain by its id; one deleted since keeps its id.
 */
export function historyLine(
  e: AuditEntry,
  domain: (id: string) => string = (id) => id,
): { what: string; href?: string } {
  const [noun = '', verb = ''] = e.action.split('.')
  const said = VERBS[verb] ?? verb.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  const subject = e.subjectTitle
    ? `“${e.subjectTitle}”`
    : (SUBJECTS[noun] ?? SUBJECTS[e.subjectType ?? ''] ?? noun.replace(/_/g, ' '))
  const detail =
    noun === 'setting' && e.subjectId
      ? `: ${e.subjectId}`
      : noun === 'area' && e.areaId
        ? `: ${domain(e.areaId)}`
        : e.areaId && !e.subjectTitle
          ? ` in ${domain(e.areaId)}`
          : ''
  const href =
    e.subjectType === 'item' && e.subjectId?.startsWith('itm_')
      ? `/context/${e.subjectId}`
      : e.subjectType === 'area' && e.subjectId
        ? `/settings/domains/${e.subjectId}`
        : undefined
  return { what: `${said} ${subject}${detail}`, ...(href ? { href } : {}) }
}

/** How close an entry of the history log is to a change to many items for that change to cover it. */
const SAME_CHANGE_MS = 60_000

/**
 * The history log's latest entries, newest first, each by who did it, or Automatic. A change to
 * many items is one line, as the Context page's History says it ("Deleted “A”, “B” and 1 more"),
 * in place of the entries it wrote for each of them.
 */
export function historyOf(
  entries: readonly AuditEntry[],
  changes: readonly ItemChange[],
  now: Date,
  names: { domain?: (id: string) => string; person: (id: string) => string },
): Advanced['history'] {
  const shown = changes.filter((c) => !c.undone && c.items.length)
  const covered = (e: AuditEntry) =>
    shown.some(
      (c) =>
        Math.abs(Date.parse(c.at) - Date.parse(e.at)) < SAME_CHANGE_MS &&
        c.items.some((i) => i.id === e.subjectId),
    )
  return [
    ...entries
      .filter((e) => !covered(e))
      .map((e) => ({
        at: e.at,
        key: String(e.seq),
        when: whenWords(e.at, now),
        who: e.actorKind === 'person' ? (e.actorName ?? 'Someone') : 'Automatic',
        ...historyLine(e, names.domain),
      })),
    ...shown.map((c) => ({
      at: c.at,
      key: `change.${c.id}`,
      when: whenWords(c.at, now),
      who: names.person(c.personId),
      what: logLine({ what: c.action, summary: c.summary, items: c.items }),
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map(({ at: _at, ...row }) => row)
}

/** The jobs that run on their own, in the screens' words. */
const JOBS: Record<string, string> = {
  'gaps.detect': 'Count what is not covered',
  'connectors.sync': 'Read the integrations',
  'outbox.relay': 'Send what lands in the Inbox',
  'evals.weekly': 'Run the answer tests',
  'evals.work': 'Work through the answer tests',
  'evals.retrieval': 'Check what the answer tests find',
  'retention.run': 'Clear what is kept for a while only',
  'partitions.ensure': 'Make room for the next weeks',
}

/** Why an edition was sealed, when it has no note of its own. */
const REASONS: Record<string, string> = {
  bootstrap: 'The first context agents got',
  proposal_accepted: 'A suggestion was published',
  item_retired: 'A context item was archived',
  vocabulary_changed: 'Definitions changed',
  area_state_changed: 'A domain was paused or resumed',
  area_map_changed: 'Domains changed',
  source_rechecked: 'An integration was read again',
  rollback: 'What agents got before came back',
  item_restored: 'A context item came back',
  area_deleted: 'A domain was deleted',
  area_restored: 'A domain came back',
  decision_undone: 'A decision was undone',
}

/** How a job's last run went. */
const RESULTS = { ok: 'Done', waiting: 'Not run yet', failing: 'Failed', overdue: 'Late' } as const

/** What runs on its own: each job, when it last ran and how it went. */
export function jobsOf(view: OperationsOverviewView, now: Date): Advanced['jobs'] {
  return view.jobs.map((j) => ({
    key: j.name,
    job: JOBS[j.name] ?? j.name.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    ...(j.name.startsWith('connectors.') ? { href: '/settings/integrations' } : {}),
    last: j.lastStartedAt ? whenWords(j.lastStartedAt, now) : 'Never',
    result: RESULTS[j.status],
  }))
}

/** The latest sealed editions, newest first: what each one changed, as its note says. */
export function editionsOf(editions: readonly Edition[], now: Date): Advanced['editions'] {
  return editions
    .filter((e) => e.sealedAt)
    .map((e) => ({
      label: e.label,
      sealed: whenWords(e.sealedAt!, now),
      change: e.note ?? REASONS[e.reason] ?? e.reason.replace(/_/g, ' '),
    }))
}
