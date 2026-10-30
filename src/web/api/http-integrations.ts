/**
 * Settings › Integrations on the http binding: the service's sources (`sources.list`), a source's
 * activity (`sources.activity`) and its settings (`sources.get`), in the words the integrations'
 * pages use. Pure, so it is unit tested (tests/web/api/http-integrations.test.ts).
 */
import type { ConnectorManifest } from '@domain/connector-manifest'
import type {
  SourceActivity,
  SourceCheck,
  SourceDocumentState,
  SourceReadEntry,
  SourceRow,
  SourceSettings,
} from '@contract/sources'
import type {
  Activity,
  ConnectChoice,
  ConnectField,
  ConnectForm,
  ConnectorId,
  ConnectTest,
  DocState,
  DriveDocument,
  DriveFolder,
  IntegrationsView,
  Source,
  SourcePage,
  When,
} from '@/model/integrations'
import { connectors } from '@/model/integrations'

/** The catalog's tool for each connector the service has, which the pages name it by. */
const catalogOf: Record<string, ConnectorId> = {
  cube: 'cube',
  'google-drive': 'google-drive',
  'git-markdown': 'markdown-git',
}

/** The catalog's tool a connector of the service is; undefined for one the app has no cell for. */
export const catalogIdOf = (type: string): ConnectorId | undefined => catalogOf[type]

/** The service's connector for a tool of the catalog. */
export const connectorOfCatalog = (id: ConnectorId) =>
  Object.entries(catalogOf).find(([, catalog]) => catalog === id)?.[0]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const twoDigits = (n: number) => String(n).padStart(2, '0')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A moment as the pages say it, in the reader's time zone: "Today", "Tomorrow", "21 Oct". */
export function whenOf(at: string, now: Date): When {
  const t = new Date(at)
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(t) - day(now)) / 86_400_000)
  const time = `${twoDigits(t.getHours())}:${twoDigits(t.getMinutes())}`
  const year = t.getFullYear() === now.getFullYear() ? '' : ` ${t.getFullYear()}`
  const named =
    days === 0
      ? 'Today'
      : days === 1
        ? 'Tomorrow'
        : days === -1
          ? 'Yesterday'
          : `${t.getDate()} ${MONTHS[t.getMonth()]}${year}`
  const hours = Math.floor((now.getTime() - t.getTime()) / 3_600_000)
  const ago =
    hours < 1
      ? undefined
      : hours < 48
        ? `${plural(hours, 'hour')} ago`
        : `${plural(Math.floor(hours / 24), 'day')} ago`
  return { day: named, time, ...(ago ? { ago } : {}) }
}

/** An ISO 8601 duration of days, hours and minutes, in minutes. */
function minutesOf(duration: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration)
  if (!m) return 0
  return Number(m[1] ?? 0) * 1_440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/** How long, in words: "6 hours", "2 days", "15 minutes". */
export function durationWords(duration: string): string {
  const minutes = minutesOf(duration)
  if (minutes % 1_440 === 0 && minutes >= 1_440) return plural(minutes / 1_440, 'day')
  if (minutes % 60 === 0 && minutes >= 60) return plural(minutes / 60, 'hour')
  return plural(minutes, 'minute')
}

/** How often, in words: "every hour", "every day", "every 15 minutes". */
export function everyWords(duration: string): string {
  const words = durationWords(duration)
  return `every ${words.replace(/^1 /, '')}`
}

/** Why a read failed, by the first warning that says so. */
const FAILURES: Record<string, string> = {
  unauthorized: 'the key was refused',
  secret_missing: 'it has no key',
  unreachable: "it couldn't be reached",
  not_found: "what it reads wasn't found",
  rate_limited: 'it was asked too often',
  timeout: 'it took too long',
  private_address: 'its address is not one it may reach',
}

/** Why a read failed, by the first of its warnings that says so. */
const failureWords = (warnings: readonly { code: string }[]) => {
  for (const warning of warnings) {
    const words = FAILURES[warning.code]
    if (words) return words
  }
  return "it couldn't be read"
}

export function failureOf(read: SourceReadEntry): string {
  return failureWords(read.warnings)
}

/** Why a document was not offered. */
const SKIPPED: Record<string, string> = {
  document_names_people: 'it names people',
  names_people: 'it names people',
  document_holds_secret: 'it holds a secret',
  holds_secret: 'it holds a secret',
  document_no_scope: 'it applies nowhere',
  no_scope: 'it applies nowhere',
  document_empty: 'it has no words',
  empty: 'it has no words',
}
const skippedWords = (code: string) => SKIPPED[code] ?? "it couldn't be offered"

/** Why documents were skipped, each reason once: "names people, applies nowhere". */
const whySkipped = (skips: readonly string[]) =>
  [...new Set(skips)].map((why) => why.replace(/^it /, '')).join(', ')

/** The skips of a read, one reason per document skipped. */
const skipsOf = (read: SourceReadEntry) =>
  read.warnings.flatMap((w) =>
    w.code.startsWith('document_') && w.code !== 'document_too_long'
      ? Array.from({ length: w.count }, () => skippedWords(w.code))
      : [],
  )

/** A source as the integrations' rows show it; null for a tool the app has no cell for. */
export function sourceOf(row: SourceRow, now: Date): Source | null {
  const connector = catalogOf[row.type]
  if (!connector) return null
  const last = row.lastRead
  const failed = last?.status === 'failed'
  const documents = row.documents
  const created =
    last && !failed && last.documents && last.documents.suggested > 0
      ? {
          suggested: last.documents.suggested,
          replaced: last.documents.replaced,
          skipped: skipsOf(last),
        }
      : null
  return {
    id: row.id,
    connector,
    health: row.health,
    every: everyWords(row.schedule),
    staleAfter: durationWords(row.staleAfter),
    last: last
      ? {
          at: whenOf(last.at, now),
          complete: last.status === 'ok',
          seconds:
            last.durationMs === null ? null : Math.max(1, Math.round(last.durationMs / 1000)),
          seen: last.definitions?.seen ?? last.documents?.seen ?? 0,
        }
      : null,
    lastGood: failed && row.lastGoodAt ? whenOf(row.lastGoodAt, now) : null,
    next: row.nextReadAt ? whenOf(row.nextReadAt, now) : null,
    failures: row.failures,
    failure: failed ? failureOf(last) : null,
    definitions: row.definitions
      ? {
          metrics: row.definitions.metrics,
          dimensions: row.definitions.dimensions,
          views: row.definitions.groups,
          noDomain: row.definitions.groupsWithoutDomain,
          flagged: row.definitions.flagged,
        }
      : null,
    documents: documents
      ? {
          held: documents.held,
          waiting: documents.waiting,
          domains: documents.waitingDomains,
          madeToday: documents.madeToday,
          perDay: documents.perDay,
        }
      : null,
    created,
    // The Inbox lists a read's suggestions under the read that made them.
    inbox: documents?.waiting ? '/inbox' : null,
    added: row.addedAt ? { by: row.addedBy, when: dayOf(row.addedAt, now) } : null,
  }
}

/** A day as the pages say it: "Today", "Yesterday" or "1 Oct". */
const dayOf = (at: string, now: Date) => whenOf(at, now).day

/** Settings › Integrations: the tools the service reads, and which others it can connect. */
export function integrationsOf(
  rows: readonly SourceRow[],
  types: readonly { manifest: Pick<ConnectorManifest, 'id'> }[],
  now: Date,
): IntegrationsView {
  const offered = new Set(types.flatMap((t) => (catalogOf[t.manifest.id] ? [t.manifest.id] : [])))
  return {
    sources: rows.flatMap((row) => {
      const source = sourceOf(row, now)
      return source ? [source] : []
    }),
    connectable: connectors.flatMap((c) => {
      const type = connectorOfCatalog(c.id)
      return type && offered.has(type) ? [c.id] : []
    }),
  }
}

/** One read, as a source's Activity lists it. */
export function activityOf(read: SourceReadEntry, tool: string, now: Date): Activity {
  const at = whenOf(read.at, now)
  const when = `${at.day}, ${at.time}`
  if (read.status === 'failed') {
    const refused = read.warnings.some((w) => w.code === 'unauthorized')
    return {
      when,
      tone: 'failed',
      what: refused ? 'Read refused' : 'Read failed',
      detail: refused
        ? `${tool} refused the key.`
        : `${failureOf(read).replace(/^./, (c) => c.toUpperCase())}.`,
    }
  }
  const what = read.first
    ? 'First read'
    : read.status === 'partial'
      ? 'Read in part'
      : 'Read complete'
  if (read.definitions) {
    const { seen, added, changed, gone } = read.definitions
    if (read.first)
      return { when, tone: 'ok', what, detail: `${plural(added, 'definition')} added` }
    const parts = [
      changed && `${plural(changed, 'definition')} changed`,
      added && `${added} new`,
      gone && `${gone} gone`,
    ].filter(Boolean)
    return parts.length
      ? { when, tone: 'changed', what, detail: parts.join(', ') }
      : {
          when,
          tone: read.status === 'partial' ? 'changed' : 'ok',
          what,
          detail: `${plural(seen, 'definition')}, no changes`,
        }
  }
  const d = read.documents ?? {
    seen: 0,
    suggested: 0,
    replaced: 0,
    withdrawn: 0,
    waiting: 0,
    skipped: 0,
  }
  const skips = skipsOf(read)
  const parts = [
    d.suggested && plural(d.suggested, 'new suggestion'),
    d.replaced && `${d.replaced} replaced an open one`,
    d.withdrawn && `${d.withdrawn} withdrawn`,
    d.waiting && `${d.waiting} waiting for the next read`,
    d.skipped && `${d.skipped} skipped${skips.length ? `: ${whySkipped(skips)}` : ''}`,
  ].filter(Boolean)
  if (read.first)
    return {
      when,
      tone: 'ok',
      what,
      detail: [plural(d.seen, 'document'), d.suggested && plural(d.suggested, 'suggestion')]
        .filter(Boolean)
        .join(', '),
    }
  return parts.length
    ? { when, tone: 'changed', what, detail: parts.join(', ') }
    : {
        when,
        tone: read.status === 'partial' ? 'changed' : 'ok',
        what,
        detail: `${plural(d.seen, 'document')}, no changes`,
      }
}

/** What became of a document, in the pages' words. */
const docStates: Record<SourceDocumentState, DocState> = {
  suggested: 'waiting',
  published: 'published',
  returned: 'returned',
  declined: 'declined',
  withdrawn: 'withdrawn',
  held: 'held',
  skipped: 'skipped',
  gone: 'gone',
}

/** A document a read looked at, as Recent documents lists it. */
export function documentOf(d: SourceActivity['documents'][number], now: Date): DriveDocument {
  const state = docStates[d.state]
  const by = d.decidedBy?.split(' ')[0]
  const note =
    state === 'skipped'
      ? `Skipped: ${skippedWords(d.skipReason ?? '').replace(/^it /, '')}`
      : state === 'returned' && by
        ? `Returned by ${by}`
        : state === 'declined' && by
          ? `Declined by ${by}`
          : undefined
  return {
    title: d.title,
    folder: d.scope,
    ...(d.domain ? { domain: d.domain } : {}),
    state,
    ...(note ? { note } : {}),
    read: dayOf(d.readAt, now),
    ...(state === 'waiting' && d.proposalId ? { href: `/inbox?card=${d.proposalId}` } : {}),
  }
}

/** A scope a content source reads ("Data team / Definitions"), as its folder and path. */
export function folderOf(scope: SourceActivity['scopes'][number]): DriveFolder {
  const [folder = scope.title, ...rest] = scope.title.split(' / ')
  return { folder, path: rest.join(' / '), domain: scope.domain, documents: scope.documents }
}

/** How a source is connected, setting by setting, in its connector's words; never a secret. */
export function connectionOf(
  settings: SourceSettings | null,
  manifest: Pick<ConnectorManifest, 'config' | 'secrets'> | undefined,
): SourcePage['connection'] {
  if (!settings || !manifest)
    return [{ label: 'Settings', value: 'Set where the server runs, by whoever runs it' }]
  const fields = manifest.config.fields.flatMap((field) => {
    const value = settings.config[field.key]
    if (value === undefined || value === '' || typeof value === 'object') return []
    return [
      {
        label: field.label,
        value: String(value),
        ...(field.kind === 'address' || field.kind === 'ref' || field.kind === 'path'
          ? { code: true }
          : {}),
      },
    ]
  })
  const secrets = manifest.secrets.map((secret) => ({
    label: secret.label,
    value: settings.secrets.find((s) => s.key === secret.key)?.set
      ? 'Set, only used for reading'
      : 'Not set',
  }))
  return [...fields, ...secrets]
}

/** One source's page: its row, what it reads, its documents, its reads, and how it is connected. */
export function sourcePageOf(
  row: SourceRow,
  activity: SourceActivity,
  settings: SourceSettings | null,
  manifest: Pick<ConnectorManifest, 'config' | 'secrets'> | undefined,
  now: Date,
): SourcePage | null {
  const source = sourceOf(row, now)
  if (!source) return null
  const changed = activity.reads.find((r) => !r.first && (r.definitions?.changed ?? 0) > 0)
  const reads = activity.reads.map((read) => activityOf(read, row.tool, now))
  const firstAt = source.next ? `at ${source.next.time}` : 'soon'
  const connected =
    !reads.length && source.added
      ? [
          {
            when: source.added.when,
            tone: 'ok' as const,
            what: 'Connected',
            detail: `First read ${firstAt}. Nothing is published by a read.`,
          },
        ]
      : []
  return {
    source,
    views: activity.groups.map((g) => ({
      view: g.name,
      metrics: g.metrics,
      dimensions: g.dimensions,
      ...(g.domain ? { domain: g.domain } : {}),
    })),
    changedOn: changed ? dayOf(changed.at, now) : null,
    folders: activity.scopes.map(folderOf),
    documents: activity.documents.map((d) => documentOf(d, now)),
    activity: [...reads, ...connected],
    connection: connectionOf(settings, manifest),
  }
}

/* ---------- the connect flow and Change settings ---------- */

/** The kinds of setting the connect form draws: words, an address, a branch, a folder. */
const formKinds: readonly string[] = ['text', 'address', 'path', 'ref']

/**
 * A tool's connect form from its connector's manifest: its settings, with what is set or their
 * defaults, and its secrets, each only as set or not (never their value). With a source's
 * settings, it is that source's Change settings; without, a new connection.
 */
export function connectFormOf(
  manifest: Pick<
    ConnectorManifest,
    'id' | 'kind' | 'config' | 'secrets' | 'schedule' | 'staleAfter' | 'limits'
  >,
  settings: SourceSettings | null,
): ConnectForm | null {
  const connector = catalogOf[manifest.id]
  if (!connector) return null
  const fields = manifest.config.fields.flatMap((field): ConnectField[] => {
    if (!formKinds.includes(field.kind)) return []
    const set = settings?.config[field.key]
    // A new connection starts from the manifest's default; a source's form from what it has.
    const value =
      typeof set === 'string' || typeof set === 'number'
        ? String(set)
        : !settings && typeof field.default === 'string'
          ? field.default
          : ''
    return [
      {
        key: field.key,
        kind: field.kind as ConnectField['kind'],
        label: field.label,
        description: field.description,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        required: field.required ?? false,
        advanced: field.advanced ?? false,
        value,
      },
    ]
  })
  return {
    connector,
    source: settings ? { id: settings.id, revision: settings.revision } : null,
    fields,
    secrets: manifest.secrets.map((secret) => ({
      key: secret.key,
      label: secret.label,
      description: secret.description,
      required: secret.required ?? false,
      set: settings?.secrets.find((s) => s.key === secret.key)?.set ?? false,
    })),
    every: everyWords(settings?.schedule ?? manifest.schedule.default),
    staleAfter: durationWords(manifest.staleAfter),
    perDay: manifest.kind === 'content' ? (manifest.limits.draftsPerDay ?? null) : null,
    chosen: (settings?.scopes ?? []).map((scope) => ({
      id: scope.id,
      title: scope.title,
      domain: scope.domain,
    })),
  }
}

/** What Test connection found, in the flow's words: the check's steps, and what may be read. */
export function connectTestOf(check: SourceCheck): ConnectTest {
  const scopes = (check.scopes ?? []).map((scope) => {
    const holds =
      scope.metrics === undefined && scope.dimensions === undefined
        ? ''
        : [
            scope.metrics ? plural(scope.metrics, 'metric') : '',
            scope.dimensions ? plural(scope.dimensions, 'dimension') : '',
          ]
            .filter(Boolean)
            .join(', ')
    return {
      id: scope.id,
      title: scope.title,
      detail: holds,
      ...(scope.metrics === undefined ? {} : { metrics: scope.metrics }),
      ...(scope.dimensions === undefined ? {} : { dimensions: scope.dimensions }),
      ...(scope.suggestedDomain ? { domain: scope.suggestedDomain } : {}),
    }
  })
  const steps = check.steps.map((step) => ({
    title: step.title,
    status: step.status,
    ...(step.detail ? { detail: step.detail } : {}),
    ...(step.fix ? { fix: step.fix } : {}),
  }))
  const said = steps.some((step) => step.status === 'failed')
  return {
    ok: check.ok,
    steps,
    scopes: check.ok ? scopes : [],
    ...(check.ok || said
      ? {}
      : { failure: `It couldn't be read: ${failureWords(check.warnings)}.` }),
  }
}

/** The form's settings as the service keeps them: each one written, trimmed; none left empty. */
export function configOf(config: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config).flatMap(([key, value]) => (value.trim() ? [[key, value.trim()]] : [])),
  )
}

/**
 * Change settings' settings: the source's own, with each the form draws as the form says it; a
 * setting the form does not draw (a map of domain names) stays as it was.
 */
export function changedConfigOf(
  before: SourceSettings['config'],
  form: Readonly<Record<string, string>>,
): SourceSettings['config'] {
  const config = { ...before }
  for (const [key, value] of Object.entries(form))
    if (value.trim()) config[key] = value.trim()
    else delete config[key]
  return config
}

/** The secrets written in the form; one left empty is not sent, so the stored one stays. */
export const secretsOf = (secrets: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(secrets).filter(([, value]) => value !== ''))

/** What was chosen to read, as the service keeps it: each with its domain, or none. */
export const scopesOf = (chosen: readonly ConnectChoice[]) =>
  chosen.map((choice) => ({ id: choice.id, title: choice.title, domain: choice.domain }))
