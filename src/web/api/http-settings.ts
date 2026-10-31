/**
 * Settings on the http binding: what the service says, in the words the Settings screens use. The
 * agents people connected, Pause sharing and the tools agents call, and Settings, Advanced (every
 * tuning setting, read only, and who changed it; what was deleted; the history log; the jobs; the editions). Pure, so
 * it is unit tested (tests/web/api/http-settings.test.ts).
 */
import type { AuditEntry, Setting } from '@contract/admin'
import type { DeletedDraft, ItemChange } from '@contract/context'
import type { OperationsOverviewView } from '@contract/index'
import type { Edition } from '@contract/review'
import type { DeletedTerm } from '@contract/terms'
import { AGENT_TOOLS } from '@/lib/agents'
import type { Agent } from '@contract/connections'
import type { Connected } from '@/lib/connect'
import { logLine } from '@/model/history'
import { settingGroups } from '@/model/settings'
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

/** How long after it signed in an agent, or was made, a row reads as new on the list. */
const NEW_MS = 15 * 60_000

/**
 * The agents by name, as the service lists them, the last used first (FR-420): an app a person
 * signed in with by that person, an access key by who made it. A new one reads as new.
 */
export function connectedOf(rows: readonly Agent[], now: Date): Connected[] {
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    agent: r.name,
    who: r.person?.name ?? r.madeBy?.name ?? 'Someone',
    ...(r.host ? { host: r.host } : {}),
    since: dayOf(r.since),
    used: r.lastUsedAt ? usedWords(r.lastUsedAt, now) : 'Never',
    ...(now.getTime() - new Date(r.since).getTime() < NEW_MS ? { fresh: true } : {}),
    tools: r.tools.map((t) => ({ ...t })),
    ...(r.toolsSetBy ? { setBy: { name: r.toolsSetBy.name, on: dayOf(r.toolsSetBy.at) } } : {}),
    sent: r.suggestions.lastDays,
    recent: r.suggestions.recent.map((x) => ({
      id: x.id,
      title: x.title,
      state: x.state,
      on: dayOf(x.at),
    })),
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

/**
 * Every tuning setting, read only, in Advanced's groups: its value in words, and who changed it
 * last, when and why. The first version is the one the app was installed with; a later version no
 * person wrote came from an update of the app or a script. `person` names a person by their id.
 */
export function settingsOf(
  settings: readonly Setting[],
  person: (id: string) => string,
  now: Date,
): Advanced['settings'] {
  return settingGroups(
    settings
      .filter((s) => s.editable)
      .map((s) => ({
        key: s.key,
        value: s.value,
        changed:
          s.changedBy || s.version > 1
            ? {
                who: s.changedBy ? person(s.changedBy) : null,
                when: whenWords(s.changedAt, now),
                why: s.reason,
              }
            : null,
      })),
  )
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
  access_key: 'an access key',
  agent: 'an agent',
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
  withdrawal_taken_back: 'Took back the withdrawal of',
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
  const named = (key: string) => {
    const value = e.details[key]
    return typeof value === 'string' ? `“${value}”` : null
  }
  // An agent's own changes name it (FR-420): a tool switched for it, or a key's new name.
  if (e.action === 'agent.tool_switched' && typeof e.details.tool === 'string')
    return {
      what: `Switched ${e.details.tool} ${e.details.on === true ? 'on' : 'off'} for ${named('name') ?? 'an agent'}`,
    }
  if (e.action === 'access_key.renamed' && named('from') && named('to'))
    return { what: `Renamed the access key ${named('from')} to ${named('to')}` }
  if (noun === 'access_key' && named('name'))
    return { what: `${VERBS[verb] ?? verb} the access key ${named('name')}` }
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

/** Who did it: the person, or the agent that did it for them ("Claude Code for Kofi Mensah"). */
function whoOf(e: AuditEntry) {
  const person = e.actorName ?? 'Someone'
  const agent = e.details.agent as { name?: unknown } | undefined
  return typeof agent?.name === 'string' ? `${agent.name} for ${person}` : person
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
        who: e.actorKind === 'person' ? whoOf(e) : 'Automatic',
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
  'observability.rollup': 'Keep the weekly counts for good',
  'observability.snapshot': "Keep each month's summary",
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
