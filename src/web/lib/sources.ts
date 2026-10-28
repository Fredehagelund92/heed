/**
 * The words and rules of Sources (integrations decision, 12 October 2026): what each warning a
 * source reports means, the server's configuration a source reads, a source's issues, what it
 * holds and when it reads next. The words name the tool a source reads from the source itself
 * (`tool`), never a vendor (CON-101). Pure, so the pages, the tests and the stories share them.
 */
import type { OperationsOverviewView, SourceCheck, SourceSettings } from '@/api'
import { durationSeconds, type ConnectorManifest } from '@domain/connector-manifest'
import { fieldVisible, parseConnectorConfig } from '@domain/connector-config'
import type { SourceServerSettingKey, SourceWarningCode } from '../../contract/operations.ts'
import type { SourceConfig } from '../../contract/sources.ts'
import { builtInManifests } from '../../connectors/manifests.ts'

export type Source = OperationsOverviewView['connectors'][number]
export type SourceRead = Source['recentReads'][number]

/** A source's page: Sources with the source open. */
export const sourceSearch = (id: string) => ({ section: 'sources' as const, source: id })

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
export function listWords(targets: readonly string[], limit = 3): string {
  if (targets.length <= 1) return targets[0] ?? ''
  const shown = targets.length > limit ? targets.slice(0, limit) : targets.slice(0, -1)
  const last = targets.length > limit ? `${targets.length - limit} more` : targets.at(-1)!
  return `${shown.join(', ')} and ${last}`
}

/** A warning's target as people read it: the server's own name for a view says so. */
const targetWords = (target: string) =>
  target.startsWith('override:')
    ? `the server's domain name for ${target.slice('override:'.length)}`
    : target

export type WarningWords = {
  /** Warning asks for a look; info only says how something was settled. */
  tone: 'warning' | 'info'
  title: (count: number) => string
  /** `origin` says who configured the source, so the remedy is one its administrator has. */
  description: (targets: string, count: number, tool: string, origin?: Source['origin']) => string
}

/**
 * What each warning of a read means (the connector contract, docs/connectors.md). Every code a
 * source may report has words: tests/unit/sources.test.ts checks it against the connectors'.
 */
export const sourceWarningWords: Record<SourceWarningCode, WarningWords> = {
  missing_domain: {
    tone: 'warning',
    title: (n) => `${count(n, 'view')} ${n === 1 ? 'has' : 'have'} no domain`,
    description: (targets, n, tool, origin = 'server') =>
      `${targets} ${n === 1 ? 'names' : 'name'} no domain in ${tool}, so ${n === 1 ? 'its' : 'their'} metrics have no domain and no owner hears when they change. Name the domain with meta.domain in the model${origin === 'server' ? ", or in the server's domain names until the model has it" : ''}, then read the source again. Or choose a domain for each metric under Metrics without a domain when you propose names.`,
  },
  invalid_domain: {
    tone: 'warning',
    title: (n) => `${count(n, 'domain')} ${n === 1 ? "isn't" : "aren't"} a domain id`,
    description: (targets, n) =>
      `${targets} ${n === 1 ? 'names' : 'name'} a domain that isn't a domain id: lowercase letters, digits and underscores, starting with a letter. We leave it out, so its metrics and dimensions take their view's domain, or none.`,
  },
  unsupported_file: {
    tone: 'warning',
    title: (n) => `${count(n, 'file')} ${n === 1 ? "wasn't" : "weren't"} read`,
    description: (targets, n) =>
      `${targets} ${n === 1 ? "isn't" : "aren't"} a YAML model file. We read YAML only, so ${n === 1 ? 'its' : 'their'} metrics and dimensions aren't listed and the read is in part.`,
  },
  unreadable_file: {
    tone: 'warning',
    title: (n) => `${count(n, 'file')} couldn't be read`,
    description: (targets, n) =>
      `${targets} ${n === 1 ? 'is' : 'are'} too large, empty or couldn't be opened, so ${n === 1 ? 'its' : 'their'} metrics and dimensions aren't listed and the read is in part.`,
  },
  invalid_rename: {
    tone: 'warning',
    title: (n) => `${count(n, 'rename')} ${n === 1 ? "doesn't" : "don't"} apply`,
    description: (targets) =>
      `The server's renamed definitions name ${targets}. A rename applies only when the old name is gone from the model and the new one is in it.`,
  },
  domain_override: {
    tone: 'info',
    title: (n) =>
      `${count(n, 'definition')} ${n === 1 ? 'takes its' : 'take their'} domain from the server`,
    description: (targets, n, tool) =>
      `${tool} names no domain for ${targets}, so the server's domain names give ${n === 1 ? 'it one' : 'them one'}. Once the model names one, the model wins.`,
  },
  taken: {
    tone: 'warning',
    title: (n) => `${count(n, 'definition')} ${n === 1 ? 'is' : 'are'} read by another source`,
    description: (targets, n) =>
      `${targets} ${n === 1 ? 'is' : 'are'} already read by another source, so this one leaves ${n === 1 ? 'it' : 'them'} out and its read is in part. A definition stays with the source that read it first.`,
  },
  private_address: {
    tone: 'warning',
    title: () => "The address isn't public",
    description: (targets) =>
      `${targets} leads to this machine or a private network. We read repositories on public addresses only.`,
  },
  unreachable: {
    tone: 'warning',
    title: () => "We couldn't reach the repository",
    description: (targets) =>
      `${targets} didn't answer, or not in time. Check the address, and that we can reach the Git host.`,
  },
  unauthorized: {
    tone: 'warning',
    title: () => 'The token was refused',
    description: (targets) =>
      `The Git host refused the token for ${targets}, or the repository needs one. Give a read-only token that can read it.`,
  },
  not_found: {
    tone: 'warning',
    title: () => 'No repository at the address',
    description: (targets) =>
      `Nothing answers as a repository at ${targets}. Check the address. Some hosts also say this when the token can't see the repository.`,
  },
  ref_not_found: {
    tone: 'warning',
    title: () => "The branch, tag or commit isn't there",
    description: (targets) => `The repository has no ${targets}. Check its name.`,
  },
  folder_missing: {
    tone: 'warning',
    title: () => "The model folder isn't there",
    description: (targets) =>
      `The repository has no folder ${targets} at that version. Check the model folder.`,
  },
  secret_missing: {
    tone: 'warning',
    title: () => 'The token is gone from the secret store',
    description: () =>
      "We no longer have this source's token. Give it again in the source's settings.",
  },
  fetch_failed: {
    tone: 'warning',
    title: () => "We couldn't read the repository",
    description: (targets) =>
      `Git couldn't read ${targets}. Try again. If it keeps failing, check the address and the token.`,
  },
  compiler_unavailable: {
    tone: 'warning',
    title: () => "The compiler didn't start",
    description: (targets, _n, tool) =>
      `${tool}'s compiler needs its native part (${targets}), and it didn't load. Whoever runs the app installs it again with npm rebuild ${targets}, then reads the source again.`,
  },
  no_model_files: {
    tone: 'warning',
    title: () => 'The model folder holds no model files',
    description: (_targets, _n, tool) =>
      `We found no YAML model files to read. Check that the model folder is the one that holds ${tool}'s model files, not the repository around it.`,
  },
  compile_error: {
    tone: 'warning',
    title: () => "The model didn't compile",
    description: (_targets, _n, tool) =>
      `${tool} couldn't compile the model files. We keep no compiler message, since one can hold a calculation. Check the model with ${tool}'s own tools.`,
  },
  compile_timeout: {
    tone: 'warning',
    title: () => 'The model took too long to compile',
    description: (_targets, _n, tool) =>
      `${tool} didn't finish compiling the model in time. On a busy computer, read it again. If it keeps happening, the model needs a closer look.`,
  },
  invalid_output: {
    tone: 'warning',
    title: () => 'The connector sent something it may not',
    description: (_targets, _n, tool) =>
      `The connector for ${tool} sent a record the contract doesn't allow, so we kept nothing from the read. The connector needs a fix, so tell whoever looks after it.`,
  },
  timed_out: {
    tone: 'warning',
    title: () => 'The read took too long',
    description: (targets, _n, tool) =>
      `${tool} didn't finish in ${targets} seconds, so we stopped the read. On a busy day, read it again later.`,
  },
  too_many_records: {
    tone: 'warning',
    title: (n) => `${count(n, 'record limit')} ${n === 1 ? 'was' : 'were'} reached`,
    description: (targets) =>
      `We read at most ${targets} records from this source, so the rest are left out and the read is in part.`,
  },
  document_names_people: {
    tone: 'info',
    title: (n) => `${count(n, 'document')} ${n === 1 ? 'seems' : 'seem'} to name people`,
    description: (targets, n) =>
      `${targets} ${n === 1 ? 'holds' : 'hold'} an email address or a phone number, so we don't suggest ${n === 1 ? 'it' : 'them'}. An owner can write it by hand.`,
  },
  document_holds_secret: {
    tone: 'warning',
    title: (n) => `${count(n, 'document')} ${n === 1 ? 'holds' : 'hold'} what looks like a secret`,
    description: (targets, n) =>
      `${targets} ${n === 1 ? 'holds' : 'hold'} what looks like a password, a token or a key, so we don't suggest ${n === 1 ? 'it' : 'them'}. Take the secret out of the document.`,
  },
  document_no_scope: {
    tone: 'info',
    title: (n) => `${count(n, 'document')} ${n === 1 ? 'names' : 'name'} nothing we know`,
    description: (targets, n) =>
      `${targets} ${n === 1 ? 'names' : 'name'} no metric, market or other name your definitions know, so there's nowhere for ${n === 1 ? 'it' : 'them'} to apply.`,
  },
  document_empty: {
    tone: 'info',
    title: (n) => `${count(n, 'document')} ${n === 1 ? 'is' : 'are'} empty`,
    description: (targets, n) => `${targets} ${n === 1 ? 'holds' : 'hold'} no words to suggest.`,
  },
  document_not_valid: {
    tone: 'warning',
    title: (n) => `${count(n, 'document')} couldn't become a suggestion`,
    description: (targets, n) =>
      `${targets} didn't pass the checks every suggestion passes, so we don't suggest ${n === 1 ? 'it' : 'them'}. Look at its domain and what it names.`,
  },
  document_too_large: {
    tone: 'warning',
    title: (n) => `${count(n, 'document')} ${n === 1 ? 'is' : 'are'} too long`,
    description: (targets, n) =>
      `${targets} ${n === 1 ? 'is' : 'are'} longer than we read, so we left ${n === 1 ? 'it' : 'them'} out of this read. A suggestion from ${n === 1 ? 'it' : 'them'} stays as it is.`,
  },
  too_much_text: {
    tone: 'warning',
    title: (n) => `${count(n, 'read')} held too much text`,
    description: () =>
      'The documents held more text than we read at once, so the rest are left out and the read is in part.',
  },
  too_many_removals: {
    tone: 'warning',
    title: (n) => `${count(n, 'read')} would have withdrawn too many suggestions`,
    description: (targets) =>
      `${targets} documents seemed to be gone at once, so we kept their suggestions and the read is in part. Check the folders, then read it again.`,
  },
  rate_limited: {
    tone: 'warning',
    title: () => 'The tool asked us to read less often',
    description: (_targets, _n, tool) =>
      `${tool} asked us to wait before reading again. We try again later by ourselves.`,
  },
}

/**
 * The words of a connector's own warning, from its manifest (`static-definitions.description_cut`):
 * its level, its title and its detail, with the targets it names.
 */
function connectorWarningWords(code: string): WarningWords | undefined {
  const dot = code.lastIndexOf('.')
  if (dot < 0) return undefined
  const manifest = builtInManifests.find((candidate) => candidate.id === code.slice(0, dot))
  const words = manifest?.warnings[code.slice(dot + 1)]
  if (!words) return undefined
  return {
    tone: words.level,
    title: (n) => (n === 1 ? words.title : `${words.title} (${n.toLocaleString('en')})`),
    description: (targets) => `${words.detail} About ${targets}.`,
  }
}

/** The words of any warning a source may report: the core's, or its connector's own. */
export function warningWords(code: string): WarningWords | undefined {
  return code in sourceWarningWords
    ? sourceWarningWords[code as SourceWarningCode]
    : connectorWarningWords(code)
}

/** The codes that say why a read failed before anything was read: the failure's own words. */
export const sourceProblemCodes: readonly SourceWarningCode[] = [
  'private_address',
  'unreachable',
  'unauthorized',
  'not_found',
  'ref_not_found',
  'folder_missing',
  'secret_missing',
  'fetch_failed',
  'compiler_unavailable',
  'no_model_files',
  'compile_error',
  'compile_timeout',
  'invalid_output',
  'timed_out',
  'rate_limited',
]
/**
 * True for a code that says why a read failed: one of the core's, or a connector's own warning,
 * which is the reason when its read failed.
 */
const isProblem = (code: string, failed = false) =>
  (sourceProblemCodes as readonly string[]).includes(code) ||
  (failed && connectorWarningWords(code) !== undefined)

/** The order issues show in: what asks for a look first. */
const warningOrder: readonly SourceWarningCode[] = [
  'missing_domain',
  'invalid_domain',
  'taken',
  'unsupported_file',
  'unreadable_file',
  'invalid_rename',
  'too_many_records',
  'too_much_text',
  'too_many_removals',
  'document_holds_secret',
  'document_not_valid',
  'document_too_large',
  'document_names_people',
  'document_no_scope',
  'document_empty',
  'domain_override',
]

export type SourceIssue = {
  id: string
  tone: 'danger' | 'warning' | 'info'
  title: string
  description: string
}

const isWarningCode = (code: string): code is SourceWarningCode => code in sourceWarningWords

/**
 * What the newest read could not settle, the most urgent first: a failed read, each kind of
 * warning with what it names, and definitions gone from the source.
 */
export function sourceIssues(source: Source): SourceIssue[] {
  const issues: SourceIssue[] = []
  const failed = source.lastRead?.status === 'failed'
  const problem = source.lastRead?.warnings.find((warning) => isProblem(warning.code, failed))
  const problemWords = problem && warningWords(problem.code)
  if (failed)
    issues.push({
      id: 'failed',
      tone: 'danger',
      // A failure that says why says it in its own words; the rest is the same for every one.
      title: problemWords
        ? `The last read failed: ${problemWords.title(1).toLowerCase()}`
        : 'The last read failed',
      description: problemWords
        ? `${problemWords.description(problem.target, 1, source.tool)} Nothing changed. We keep what we read before and flag nothing.`
        : `${source.tool} couldn't be read. Nothing changed. We keep what we read before and flag nothing. When the model is fixed, read it again.`,
    })
  const byCode = new Map<string, string[]>()
  for (const warning of source.lastRead?.warnings ?? [])
    if (!isProblem(warning.code, failed))
      byCode.set(warning.code, [...(byCode.get(warning.code) ?? []), targetWords(warning.target)])
  for (const code of warningOrder) {
    const targets = byCode.get(code)
    if (!targets) continue
    const words = sourceWarningWords[code]
    issues.push({
      id: code,
      tone: words.tone,
      title: words.title(targets.length),
      description: words.description(
        listWords(targets),
        targets.length,
        source.tool,
        source.origin,
      ),
    })
  }
  // A connector's own warnings, in its manifest's words.
  for (const [code, targets] of byCode) {
    const words = isWarningCode(code) ? undefined : connectorWarningWords(code)
    if (words)
      issues.push({
        id: code,
        tone: words.tone,
        title: words.title(targets.length),
        description: words.description(listWords(targets), targets.length, source.tool),
      })
  }
  // A code this screen does not know yet still shows, in plain terms.
  for (const [code, targets] of byCode)
    if (!isWarningCode(code) && !connectorWarningWords(code))
      issues.push({
        id: code,
        tone: 'warning',
        title: `${count(targets.length, 'warning')}: ${code}`,
        description: `About ${listWords(targets)}.`,
      })
  const gone = source.definitions.missing
  if (gone > 0)
    issues.push({
      id: 'gone',
      tone: 'info',
      title: `${count(gone, 'definition')} ${gone === 1 ? 'is' : 'are'} gone from ${source.tool}`,
      description: `We mark facts that refer to ${gone === 1 ? 'it' : 'one'} as needing checking.${source.renames.length ? ` The server's renamed definitions give the new id of ${count(source.renames.length, 'definition')}.` : ''}`,
    })
  return issues
}

/** The issues that ask for a look, as one line for a list: the first, and how many more. */
export function issueSummary(issues: readonly SourceIssue[]): string {
  const asking = issues.filter((issue) => issue.tone !== 'info')
  if (asking.length === 0) return 'Nothing'
  return asking.length === 1
    ? asking[0]!.title
    : `${asking[0]!.title}, ${count(asking.length - 1, 'more issue')}`
}

/** "3 facts, 5 mentions", or "Nothing": what refers to a changed or gone definition. */
export function needsALookWords(source: Pick<Source, 'flaggedItems' | 'staleLinks'>): string {
  if (!source.flaggedItems && !source.staleLinks) return 'Nothing'
  return `${count(source.flaggedItems, 'fact')}, ${count(source.staleLinks, 'mention')}`
}

/** "7 views, 42 definitions", or "2 definitions" for a source without views. */
export function holdsWords(source: Source): string {
  const definitions = count(source.definitions.current, 'definition')
  return source.views.length ? `${count(source.views.length, 'view')}, ${definitions}` : definitions
}

/**
 * What a source holds, in full: "7 views: 22 metrics and 20 dimensions, 1 gone", counted over
 * its views; "2 definitions" for a source without views.
 */
export function membersWords(source: Source): string {
  const gone = source.definitions.missing
    ? `, ${source.definitions.missing.toLocaleString('en')} gone`
    : ''
  if (!source.views.length) return `${count(source.definitions.current, 'definition')}${gone}`
  const metrics = source.views.reduce((sum, view) => sum + view.metrics, 0)
  const dimensions = source.views.reduce((sum, view) => sum + view.dimensions, 0)
  return `${count(source.views.length, 'view')}: ${count(metrics, 'metric')} and ${count(dimensions, 'dimension')}${gone}`
}

/**
 * A read's result: complete or in part, how long it took and its warnings ("Complete in 1.8
 * seconds, 2 warnings"), or failed with nothing changed.
 */
export function readResultWords(
  read: Pick<SourceRead, 'status' | 'warnings' | 'durationMs'>,
): string {
  if (read.status === 'failed') return 'Failed. Nothing changed.'
  const took = read.durationMs === null ? '' : ` ${durationWords(read.durationMs)}`
  const warnings = read.warnings ? `, ${count(read.warnings, 'warning')}` : ''
  return `${read.status === 'ok' ? 'Complete' : 'In part'}${took}${warnings}`
}

/** "in 1.8 seconds", "in 240 milliseconds". */
export function durationWords(ms: number): string {
  return ms < 1000
    ? `in ${count(ms, 'millisecond')}`
    : `in ${(ms / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} seconds`
}

/** A model version as people compare it: a commit or a digest's first seven characters. */
export function versionWords(version: string): string {
  return /^[0-9a-f]{12,}$/.test(version) ? version.slice(0, 7) : version
}

/**
 * When a job on an hourly schedule (`M * * * *`) runs next after `now`; null for any other
 * schedule, which the page then names by its expression.
 */
export function nextHourly(cron: string, now: Date): Date | null {
  const match = /^(\d{1,2}) \* \* \* \*$/.exec(cron)
  const minute = match ? Number(match[1]) : NaN
  if (!(minute >= 0 && minute < 60)) return null
  const next = new Date(now)
  next.setUTCSeconds(0, 0)
  next.setUTCMinutes(minute)
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1)
  return next
}

/** The server's configuration a source reads, in words: the label and what unset means. */
export const serverSettingWords: Record<
  SourceServerSettingKey,
  { label: string; unset: string; hint: string }
> = {
  model_folder: {
    label: 'Model folder',
    unset: 'Not set',
    hint: 'The folder of model files we read, offline. We never change them.',
  },
  domain_overrides: {
    label: 'Domain names',
    unset: 'None',
    hint: 'A domain for each view the model names none for. The model always wins.',
  },
  renames: {
    label: 'Renamed definitions',
    unset: 'None',
    hint: 'The new id of a definition that is gone, so facts and mentions name it.',
  },
}

/** What a kind of source is, for the list's group rows. */
export const sourceKindWords: Record<string, { title: string; description: string }> = {
  definition_source: {
    title: 'Definitions',
    description: 'What exists: the metrics and dimensions we check facts against',
  },
}

/**
 * What a kind of connector syncs, for the list of connectors: definitions say what exists,
 * content becomes drafts for a domain's owners to review.
 */
export const connectorKindWords: Record<
  ConnectorManifest['kind'],
  { title: string; syncs: string; description: string }
> = {
  definitions: {
    title: 'Definitions',
    syncs: 'Metrics and dimensions',
    description:
      'Say which metrics and dimensions exist. We check facts against them and never change them.',
  },
  content: {
    title: 'Content',
    syncs: 'Documents, as drafts',
    description: `Read documents you choose. Each new or changed one becomes a draft for the owners of its domain to review.`,
  },
}

/** How far along a connector is, when it is not stable; nothing for a stable one. */
export const connectorMaturityWords: Record<ConnectorManifest['maturity'], string | null> = {
  stable: null,
  beta: 'Beta',
  experimental: 'Experimental',
}

// ---- a source an administrator adds ----

/** Sources with the list of connectors to add a source of. */
export const addSourceSearch = { section: 'sources' as const, add: true as const }

/** A connector's form, to add a source of it. */
export const addConnectorSearch = (connector: string) => ({ ...addSourceSearch, connector })

/** A source's page with its settings' form open. */
export const editSourceSearch = (id: string) => ({ ...sourceSearch(id), edit: true as const })

/** A source's page with its members to propose as vocabulary terms. */
export const proposeTermsSearch = (id: string) => ({ ...sourceSearch(id), terms: true as const })
/** The same page for the values of one dimension only (a dimension's Values action). */
export const addValuesSearch = (id: string, dimensionKey: string) => ({
  ...proposeTermsSearch(id),
  values: dimensionKey,
})

/** One line of a domain map: the tool's name for a domain, and the domain it means. */
export type DomainNameRow = { from: string; to: string }

/**
 * The form's values, by the kind of each field: text (also numbers, lines of a list and JSON, as
 * typed), yes or no, the lines of a domain map, and secrets, each typed in once.
 */
export type SourceFormValues = {
  name: string
  fields: Record<string, string>
  flags: Record<string, boolean>
  maps: Record<string, DomainNameRow[]>
  secrets: Record<string, string>
  reason: string
}

const textOf = (value: SourceConfig[string] | undefined): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : Array.isArray(value)
        ? value.join('\n')
        : ''

/**
 * A new source's form, from the manifest's defaults, or a source's settings to change. A secret
 * is always empty: it is never sent back, and empty keeps the one in the store.
 */
export function sourceFormValues(
  manifest: ConnectorManifest,
  settings?: SourceSettings,
): SourceFormValues {
  const values: SourceFormValues = {
    name: settings?.name ?? '',
    fields: {},
    flags: {},
    maps: {},
    secrets: Object.fromEntries(manifest.secrets.map((secret) => [secret.key, ''])),
    reason: '',
  }
  for (const field of manifest.config.fields) {
    const value = settings ? settings.config[field.key] : field.default
    if (field.kind === 'domain_map')
      values.maps[field.key] =
        typeof value === 'object' && !Array.isArray(value)
          ? Object.entries(value).map(([from, to]) => ({ from, to }))
          : []
    else if (field.kind === 'boolean') values.flags[field.key] = value === true
    else values.fields[field.key] = textOf(value)
  }
  return values
}

/**
 * The settings as the form has them, before any check: text trimmed, a number as a number when
 * it reads as one, a list by line, a domain map by its filled lines, and a field another one
 * hides left out.
 */
export function sourceFormConfig(
  manifest: ConnectorManifest,
  values: SourceFormValues,
): SourceConfig {
  const config: SourceConfig = {}
  for (const field of manifest.config.fields) {
    if (field.kind === 'boolean') {
      config[field.key] = values.flags[field.key] ?? false
      continue
    }
    if (field.kind === 'domain_map') {
      const lines = (values.maps[field.key] ?? []).filter((line) => line.from.trim() || line.to)
      if (lines.length)
        config[field.key] = Object.fromEntries(lines.map((line) => [line.from.trim(), line.to]))
      continue
    }
    const text = values.fields[field.key] ?? ''
    if (field.kind === 'list') {
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines.length) config[field.key] = lines
    } else if (field.kind === 'integer') {
      if (text.trim()) config[field.key] = /^-?\d+$/.test(text.trim()) ? Number(text) : text.trim()
    } else if (text.trim()) config[field.key] = field.kind === 'json' ? text : text.trim()
  }
  for (const field of manifest.config.fields)
    if (!fieldVisible(field, config)) delete config[field.key]
  return config
}

/** The settings and secrets the form sends: empty secrets are left out. */
export function sourceFormInput(
  manifest: ConnectorManifest,
  values: SourceFormValues,
): { config: SourceConfig; secrets: Record<string, string> } {
  const secrets: Record<string, string> = {}
  for (const secret of manifest.secrets) {
    const value = values.secrets[secret.key] ?? ''
    if (value) secrets[secret.key] = value
  }
  return { config: sourceFormConfig(manifest, values), secrets }
}

/**
 * What the form says before it sends anything, by field: the manifest's own rules
 * (`parseConnectorConfig`, the same the service runs first), a line of a domain map half
 * filled, a secret a new source needs, the name and the reason. The service checks every value
 * again, with the connector's own rules too.
 */
export function sourceFormProblems(
  manifest: ConnectorManifest,
  values: SourceFormValues,
  { isNew, withReason = true }: { isNew: boolean; withReason?: boolean },
): Record<string, string> {
  const problems: Record<string, string> = {}
  if (!values.name.trim()) problems.name = 'Give the source a name.'
  else if ([...values.name.trim()].length > 80) problems.name = 'Use at most 80 characters.'
  const parsed = parseConnectorConfig(manifest, sourceFormConfig(manifest, values))
  if ('problems' in parsed)
    for (const problem of parsed.problems) problems[problem.field] ??= problem.message
  for (const field of manifest.config.fields) {
    if (field.kind !== 'domain_map') continue
    const lines = (values.maps[field.key] ?? []).filter((line) => line.from.trim() || line.to)
    if (lines.some((line) => !line.from.trim()))
      problems[field.key] = 'Each line needs the name the tool gives.'
    else if (lines.some((line) => !line.to)) problems[field.key] = 'Choose a domain on each line.'
    else if (new Set(lines.map((line) => line.from.trim())).size !== lines.length)
      problems[field.key] = 'Give each name once.'
  }
  if (isNew)
    for (const secret of manifest.secrets)
      if (secret.required && !values.secrets[secret.key])
        problems[secret.key] =
          `Give the ${secret.label.charAt(0).toLowerCase()}${secret.label.slice(1)}.`
  if (withReason && !values.reason.trim()) problems.reason = "Say why you're changing it."
  return problems
}

/** What a test found, in words for the form: whether Heed can read it, and what it holds. */
export function checkWords(
  check: SourceCheck,
  tool: string,
): { tone: 'success' | 'warning' | 'danger'; title: string; description: string } {
  if (!check.ok) {
    const problem = check.warnings.find((warning) => isProblem(warning.code, true))
    if (problem) {
      const words = warningWords(problem.code)!
      return {
        tone: 'danger',
        title: words.title(1),
        description: words.description(problem.target, 1, tool),
      }
    }
    const failedStep = check.steps.find((step) => step.status === 'failed')
    if (failedStep)
      return {
        tone: 'danger',
        title: `${failedStep.title}: it didn't work`,
        description: [failedStep.detail, failedStep.fix].filter(Boolean).join(' ') || 'Try again.',
      }
    const files = check.warnings.filter((warning) => warning.code === 'unreadable_file')
    return {
      tone: 'danger',
      title: `We couldn't read the ${tool} model`,
      description: files.length
        ? `We fetched it, but couldn't read ${listWords(files.map((file) => file.target))} or anything else. Check the model folder.`
        : `We fetched it but couldn't compile the model. Check that the model folder holds ${tool} YAML model files.`,
    }
  }
  const holds = check.views
    ? `${count(check.views, 'view')}: ${count(check.metrics, 'metric')} and ${count(check.dimensions, 'dimension')}`
    : `${count(check.metrics, 'metric')} and ${count(check.dimensions, 'dimension')}`
  const version = check.version ? `Version ${versionWords(check.version)}, ` : ''
  const byCode = new Map<string, number>()
  for (const warning of check.warnings)
    byCode.set(warning.code, (byCode.get(warning.code) ?? 0) + 1)
  const asking = [...byCode]
    .filter(([code]) => warningWords(code)?.tone === 'warning')
    .map(([code, n]) => warningWords(code)!.title(n))
  return {
    tone: asking.length ? 'warning' : 'success',
    title: asking.length ? 'We can read it, with warnings' : 'We can read it',
    description: `${version}${holds}.${asking.length ? ` ${asking.join('. ')}.` : ''}${check.complete ? '' : ' The read was in part.'}`,
  }
}

/** How often a schedule reads, from its ISO 8601 duration: "every hour", "every 15 minutes". */
export function scheduleWords(duration: string): string {
  const seconds = durationSeconds(duration)
  if (!Number.isFinite(seconds) || seconds <= 0) return 'on a schedule'
  const [unit, size] =
    seconds % 86_400 === 0
      ? (['day', 86_400] as const)
      : seconds % 3_600 === 0
        ? (['hour', 3_600] as const)
        : (['minute', 60] as const)
  const n = seconds / size
  return n === 1 ? `every ${unit}` : `every ${n.toLocaleString('en')} ${unit}s`
}

/**
 * Where a connector's code may reach, in words: the host of an address setting by its label, or
 * a host by name, and whether it signs in there; nothing for a connector that reaches nothing
 * outside the app.
 */
export function egressWords(manifest: ConnectorManifest): string[] {
  return manifest.egress.hosts.map((host) => {
    const signIn = host.signIn ? ', to sign in' : ''
    if ('host' in host) return `${host.host}${signIn}`
    const field = manifest.config.fields.find((candidate) => candidate.key === host.fromField)
    const label = field?.label ?? host.fromField
    // A label that starts with the tool's name keeps its capital: it is a name.
    const named = label.startsWith(manifest.tool.split(' ')[0]!)
      ? label
      : label.charAt(0).toLowerCase() + label.slice(1)
    return `The host of the ${named} you give${signIn}`
  })
}
