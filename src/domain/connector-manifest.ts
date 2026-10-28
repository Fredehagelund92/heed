import * as z from 'zod/mini'
import { connectorIdPattern } from './connector-id.ts'

/*
  A connector's manifest (interface 3.0, docs/connectors.md "The manifest"): what a connector is,
  as pure data. The server and the web app both read it, so Sources lists and describes a
  connector, and draws its form, without running its code (CON-112). The runtime, the code that
  reads the tool, is server only and is typed in connector-runtime.ts.

  One schema says what a manifest may hold; `checkManifest` adds the rules a schema cannot say
  (a secret that is also a setting, a range this build does not read) and words every problem
  for the author. `checkManifests` checks a set: one id each, one tool per ref prefix.
*/

/** The connector interface this build speaks (CON-109). A minor version only adds. */
export const CONNECTOR_INTERFACE_VERSION = '3.0.0'

const CONNECTOR_ID_MAX = 64

/** What a connector reads: which metrics and dimensions exist, or documents to draft from. */
export const connectorKinds = ['definitions', 'content'] as const
export type ConnectorKind = (typeof connectorKinds)[number]

/** Who stands behind it (docs/connectors/packaging.md, "Support levels"). */
export const connectorSupportLevels = ['core', 'verified', 'community'] as const
export const connectorMaturities = ['stable', 'beta', 'experimental'] as const

/**
 * The kinds of setting a form has. A secret is not one: it is a slot of `secrets`, kept in the
 * server's secret store and never with the settings (CON-105).
 */
export const manifestFieldKinds = [
  'text',
  'address',
  'path',
  'ref',
  'select',
  'radio',
  'boolean',
  'integer',
  'list',
  'json',
  'domain_map',
] as const
export type ManifestFieldKind = (typeof manifestFieldKinds)[number]

/** The pictures Sources has for a connector; a connector names one, or gets a plug. */
export const connectorIcons = ['database', 'git', 'file', 'list', 'cloud', 'book'] as const

/** The keys every form already has, which a connector's settings and secrets cannot take. */
export const reservedSettingKeys = ['name', 'reason', 'type', 'id', 'schedule'] as const

const words = (max: number) => z.string().check(z.minLength(1), z.maxLength(max))
const settingKey = z.string().check(z.regex(/^[a-z][a-zA-Z0-9]{0,39}$/))
const groupId = z.string().check(z.regex(/^[a-z][a-z0-9-]{0,39}$/))
/** An ISO 8601 duration of days, hours and minutes: `PT1H`, `PT15M`, `P1D`. */
const duration = z.string().check(z.regex(/^P(?=\d|T\d)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?)?$/))
const count = (min: number, max: number) =>
  z.number().check(z.int(), z.minimum(min), z.maximum(max))
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/

export const manifestFieldSchema = z.strictObject({
  key: settingKey,
  kind: z.enum(manifestFieldKinds),
  label: words(80),
  /** What the field does for the person filling it in, in one or two sentences. */
  description: words(500),
  required: z.optional(z.boolean()),
  /** An example, shown in the empty field. */
  placeholder: z.optional(words(500)),
  /** The value a new source starts with. */
  default: z.optional(z.union([z.string(), z.boolean(), z.number(), z.array(z.string())])),
  /** The choices of a `select` or `radio` field. */
  options: z.optional(
    z
      .array(
        z.strictObject({
          value: words(200),
          label: words(80),
          description: z.optional(words(300)),
        }),
      )
      .check(z.minLength(1), z.maxLength(50)),
  ),
  /** The group it shows in; a form without groups shows its fields in order. */
  group: z.optional(groupId),
  /** Folded under More settings until opened: what most people leave as it is. */
  advanced: z.optional(z.boolean()),
  /** Shown, checked and kept only while another field has this value. */
  visibleIf: z.optional(
    z.strictObject({ field: settingKey, equals: z.union([z.string(), z.boolean()]) }),
  ),
  /** A pattern each text value must match, with what to write when it does not. */
  pattern: z.optional(words(500)),
  patternMessage: z.optional(words(200)),
  minimum: z.optional(z.number().check(z.int())),
  maximum: z.optional(z.number().check(z.int())),
  /** The most characters a text or JSON value may have (500, or 20,000 for JSON). */
  maxLength: z.optional(count(1, 20_000)),
  /** The most lines a list or a domain map may have (50, or 200 for a domain map). */
  maxItems: z.optional(count(1, 500)),
})
export type ManifestField = z.infer<typeof manifestFieldSchema>

export const manifestSecretSchema = z.strictObject({
  key: settingKey,
  label: words(80),
  description: words(500),
  required: z.optional(z.boolean()),
  /**
   * The settings it is bound to: where it is sent. A change to one forgets the stored secret
   * unless a new one comes with the change.
   */
  boundTo: z.array(settingKey),
})
export type ManifestSecret = z.infer<typeof manifestSecretSchema>

export const connectorManifestSchema = z.strictObject({
  /** Stable for good: sources store it. */
  id: z.string().check(z.maxLength(CONNECTOR_ID_MAX), z.regex(connectorIdPattern)),
  /** The connector's own version (semver), stored with its sources. */
  version: z.string().check(z.regex(semver)),
  /** The interface range it implements, such as `^3.0` (CON-109). */
  heed: words(40),
  kind: z.enum(connectorKinds),
  /** The tool it reads, as people say it. Every screen word that names the tool comes from here. */
  tool: words(60),
  title: words(80),
  /** What it reads and what it does with it, in one or two sentences. */
  summary: words(300),
  icon: z.optional(z.enum(connectorIcons)),
  /** Its README, relative to its folder. */
  docs: z.optional(words(200)),
  maintainer: z.strictObject({ name: words(80) }),
  support: z.enum(connectorSupportLevels),
  maturity: z.enum(connectorMaturities),
  /** A definitions connector's ref prefix, which belongs to the tool (CON-117). */
  refPrefix: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{0,39}$/))),
  config: z.strictObject({
    groups: z.optional(
      z.array(
        z.strictObject({ id: groupId, title: words(80), description: z.optional(words(300)) }),
      ),
    ),
    fields: z.array(manifestFieldSchema).check(z.maxLength(40)),
  }),
  secrets: z.array(manifestSecretSchema).check(z.maxLength(10)),
  /** The least access it needs, said before anything is given (CON-106). */
  access: z.array(words(300)).check(z.minLength(1), z.maxLength(6)),
  /**
   * Every host it may reach (CON-113): a host by name, or the host of an address setting. A host
   * for signing in takes a POST too, so a connector may trade its credential for a short-lived
   * token (an OAuth token endpoint); every other request is a GET or a HEAD.
   */
  egress: z.strictObject({
    hosts: z.array(
      z.union([
        z.strictObject({ fromField: settingKey, signIn: z.optional(z.boolean()) }),
        z.strictObject({
          host: z
            .string()
            .check(z.maxLength(253), z.regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/)),
          signIn: z.optional(z.boolean()),
        }),
      ]),
    ),
    git: z.optional(z.boolean()),
  }),
  capabilities: z.strictObject({
    discover: z.union([z.enum(['views', 'folders', 'spaces']), z.literal(false)]),
    /** Honours the cursor. */
    incremental: z.boolean(),
    deletions: z.enum(['full-listing', 'tombstones', 'both']),
    domain: z.enum(['hint', 'per-scope']),
    /** Definitions: whether marks see calculations (CON-505). */
    marks: z.optional(z.enum(['meaning', 'metadata'])),
    links: z.optional(z.boolean()),
  }),
  schedule: z.strictObject({ default: duration, minimum: duration }),
  staleAfter: duration,
  limits: z.strictObject({
    timeoutSeconds: count(1, 3_600),
    maxRecords: count(1, 100_000),
    draftsPerDay: z.optional(count(1, 1_000)),
  }),
  /** The connector's own warnings with their words, by code (namespaced as `<id>.<code>`). */
  warnings: z.record(
    z.string().check(z.regex(/^[a-z][a-z0-9_]{0,39}$/)),
    z.strictObject({ level: z.enum(['warning', 'info']), title: words(120), detail: words(500) }),
  ),
  /** Moves when the connector changes how it computes marks (CON-116). */
  markVersion: count(1, 1_000),
})
export type ConnectorManifest = z.infer<typeof connectorManifestSchema>

/** A problem with a manifest: where in it, and what to write instead. */
export interface ManifestProblem {
  path: string
  message: string
}

/** Seconds in an ISO 8601 duration of days, hours and minutes. */
export function durationSeconds(value: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value)
  if (!match) return Number.NaN
  const [, days = '0', hours = '0', minutes = '0'] = match
  return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60
}

const parseVersion = (version: string) => {
  const match = semver.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/**
 * True when this build's interface version is in the range: `^3`, `^3.0`, `^3.0.0`, `3.x` or
 * `~3.0`. Any other way of writing a range is refused, so a manifest says it plainly.
 */
export function satisfiesInterface(range: string, version = CONNECTOR_INTERFACE_VERSION): boolean {
  const have = parseVersion(version)
  if (!have) return false
  const caret = /^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range)
  const tilde = /^~(\d+)\.(\d+)(?:\.(\d+))?$/.exec(range)
  const major = /^(\d+)\.x$/.exec(range)
  const at = (match: RegExpExecArray) => [1, 2, 3].map((index) => Number(match[index] ?? 0))
  const atLeast = (want: number[]) =>
    have[0]! > want[0]! ||
    (have[0] === want[0] && (have[1]! > want[1]! || (have[1] === want[1] && have[2]! >= want[2]!)))
  if (caret) return have[0] === Number(caret[1]) && atLeast(at(caret))
  if (tilde)
    return have[0] === Number(tilde[1]) && have[1] === Number(tilde[2]) && atLeast(at(tilde))
  if (major) return have[0] === Number(major[1])
  return false
}

const pathOf = (path: readonly PropertyKey[]) =>
  path.reduce<string>(
    (text, part) =>
      typeof part === 'number'
        ? `${text}[${part}]`
        : text
          ? `${text}.${String(part)}`
          : String(part),
    '',
  )

/** Words for a schema problem, by what it is about. */
function issueWords(issue: z.core.$ZodIssue): string {
  const key = issue.path.at(-1)
  if (issue.code === 'unrecognized_keys')
    return `Remove ${issue.keys.join(', ')}: a manifest has no such ${issue.keys.length === 1 ? 'key' : 'keys'}.`
  if (issue.code === 'invalid_type' && issue.input === undefined) return 'Give it: it is required.'
  if (key === 'id')
    return 'Use lowercase letters, digits and dashes, starting with a letter, with at most one dot for a namespace: acme.lookml.'
  if (key === 'version') return 'Use a semantic version, such as 1.0.0.'
  if (key === 'key') return 'Use letters and digits, starting with a lowercase letter: modelFolder.'
  if (issue.code === 'invalid_format' && (key === 'staleAfter' || issue.path.includes('schedule')))
    return 'Use an ISO 8601 duration of days, hours and minutes, such as PT1H or P1D.'
  if (issue.code === 'too_small' && issue.origin === 'string') return 'Give it some words.'
  if (issue.code === 'too_big' && issue.origin === 'string')
    return `Use at most ${String(issue.maximum)} characters.`
  if (issue.code === 'invalid_value') return `Use one of ${issue.values.map(String).join(', ')}.`
  return issue.message
}

/** Checks that only make sense for one field: its options, its pattern, its bounds. */
function fieldProblems(
  field: ManifestField,
  at: string,
  earlier: readonly ManifestField[],
  groups: ReadonlySet<string>,
): ManifestProblem[] {
  const problems: ManifestProblem[] = []
  const problem = (where: string, message: string) =>
    problems.push({ path: where ? `${at}.${where}` : at, message })
  const choice = field.kind === 'select' || field.kind === 'radio'
  if (choice && !field.options?.length)
    problem('options', `A ${field.kind} field needs its options.`)
  if (!choice && field.options) problem('options', `Only a select or radio field has options.`)
  if (
    field.options &&
    new Set(field.options.map((option) => option.value)).size !== field.options.length
  )
    problem('options', 'Give each option a value of its own.')
  if (field.pattern !== undefined) {
    if (!['text', 'path', 'ref', 'list'].includes(field.kind))
      problem('pattern', 'Only a text, path, ref or list field has a pattern.')
    try {
      new RegExp(field.pattern, 'u')
    } catch {
      problem('pattern', 'Write a pattern JavaScript can read.')
    }
    if (field.patternMessage === undefined)
      problem('patternMessage', 'Say what to write when a value does not match the pattern.')
  }
  if ((field.minimum !== undefined || field.maximum !== undefined) && field.kind !== 'integer')
    problem('minimum', 'Only an integer field has a minimum or a maximum.')
  if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum)
    problem('maximum', 'Make the maximum at least the minimum.')
  if (field.maxItems !== undefined && field.kind !== 'list' && field.kind !== 'domain_map')
    problem('maxItems', 'Only a list or a domain map has a most number of lines.')
  if (field.group !== undefined && !groups.has(field.group))
    problem('group', `Declare the group ${field.group} under config.groups.`)
  if (field.visibleIf) {
    const other = earlier.find((candidate) => candidate.key === field.visibleIf!.field)
    if (!other) problem('visibleIf', `Name a field that comes before ${field.key}.`)
  }
  if (field.default !== undefined) {
    const value = field.default
    const fits =
      field.kind === 'boolean'
        ? typeof value === 'boolean'
        : field.kind === 'integer'
          ? Number.isInteger(value)
          : field.kind === 'list'
            ? Array.isArray(value)
            : field.kind === 'domain_map'
              ? false
              : typeof value === 'string'
    if (!fits) problem('default', `The default is not a value a ${field.kind} field holds.`)
    else if (choice && !field.options?.some((option) => option.value === value))
      problem('default', 'Make the default one of the options.')
  }
  return problems
}

/**
 * Checks a manifest: its shape, then the rules a schema cannot say. Every problem names where it
 * is and what to write instead, so an author fixes all of them in one go.
 */
export function checkManifest(
  input: unknown,
  interfaceVersion = CONNECTOR_INTERFACE_VERSION,
): { ok: true; manifest: ConnectorManifest } | { ok: false; problems: ManifestProblem[] } {
  const parsed = connectorManifestSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        path: pathOf(issue.path) || 'manifest',
        message: issueWords(issue),
      })),
    }
  const manifest = parsed.data
  const problems: ManifestProblem[] = []
  const problem = (path: string, message: string) => problems.push({ path, message })

  if (!satisfiesInterface(manifest.heed, interfaceVersion))
    problem(
      'heed',
      `This build speaks interface ${interfaceVersion}, which ${manifest.heed} does not include. Write a range such as ^${parseVersion(interfaceVersion)?.[0] ?? 3}.0.`,
    )

  const { fields, groups = [] } = manifest.config
  const groupIds = new Set(groups.map((group) => group.id))
  if (groupIds.size !== groups.length) problem('config.groups', 'Give each group an id of its own.')
  const seen = new Set<string>()
  fields.forEach((field, index) => {
    const at = `config.fields[${index}]`
    if (seen.has(field.key)) problem(`${at}.key`, `Use ${field.key} for one field only.`)
    seen.add(field.key)
    if ((reservedSettingKeys as readonly string[]).includes(field.key))
      problem(`${at}.key`, `Every form already has ${field.key}. Choose another key.`)
    problems.push(...fieldProblems(field, at, fields.slice(0, index), groupIds))
  })
  const secretKeys = new Set<string>()
  manifest.secrets.forEach((secret, index) => {
    const at = `secrets[${index}]`
    if (seen.has(secret.key))
      problem(
        `${at}.key`,
        `${secret.key} is a setting too. A secret is kept apart from the settings.`,
      )
    if (secretKeys.has(secret.key)) problem(`${at}.key`, `Use ${secret.key} for one secret only.`)
    if ((reservedSettingKeys as readonly string[]).includes(secret.key))
      problem(`${at}.key`, `Every form already has ${secret.key}. Choose another key.`)
    secretKeys.add(secret.key)
    for (const bound of secret.boundTo)
      if (!seen.has(bound))
        problem(`${at}.boundTo`, `${bound} is not a setting, so the secret cannot be bound to it.`)
    if (secret.boundTo.length === 0)
      problem(`${at}.boundTo`, 'Name the setting that says where the secret is sent.')
  })
  manifest.egress.hosts.forEach((host, index) => {
    if (!('fromField' in host)) return
    const field = fields.find((candidate) => candidate.key === host.fromField)
    if (field?.kind !== 'address')
      problem(
        `egress.hosts[${index}].fromField`,
        `Name an address setting; ${host.fromField} is not one.`,
      )
  })

  if (manifest.kind === 'definitions') {
    if (manifest.refPrefix === undefined)
      problem('refPrefix', 'A definitions connector names the prefix of its refs, such as cube.')
    if (manifest.capabilities.domain !== 'hint')
      problem('capabilities.domain', 'A definitions connector takes its domain from a hint.')
    if (manifest.capabilities.marks === undefined)
      problem(
        'capabilities.marks',
        'Say whether its change marks see calculations: meaning or metadata.',
      )
    if (manifest.limits.draftsPerDay !== undefined)
      problem('limits.draftsPerDay', 'Only a content connector makes drafts.')
  } else {
    if (manifest.refPrefix !== undefined)
      problem('refPrefix', 'Only a definitions connector has a ref prefix.')
    if (manifest.capabilities.domain !== 'per-scope')
      problem('capabilities.domain', 'A content connector takes one domain per scope.')
    if (manifest.capabilities.marks !== undefined)
      problem('capabilities.marks', 'Only a definitions connector has change marks of its own.')
    if (manifest.limits.draftsPerDay === undefined)
      problem('limits.draftsPerDay', 'Say how many drafts a source may make in a day.')
  }

  const every = durationSeconds(manifest.schedule.default)
  const minimum = durationSeconds(manifest.schedule.minimum)
  if (minimum > every)
    problem('schedule.minimum', 'Make the shortest schedule at most the default one.')
  if (durationSeconds(manifest.staleAfter) < every)
    problem('staleAfter', 'Make a source out of date no sooner than its default schedule reads it.')
  if (manifest.limits.timeoutSeconds > minimum && minimum > 0)
    problem('limits.timeoutSeconds', 'Let a read finish before the next one may start.')

  return problems.length ? { ok: false, problems } : { ok: true, manifest }
}

/**
 * Checks a set of manifests that load together: one connector per id, and one tool per ref
 * prefix (two connectors for the same tool share it, CON-117).
 */
export function checkManifests(
  manifests: readonly ConnectorManifest[],
): { id: string; problem: ManifestProblem }[] {
  const problems: { id: string; problem: ManifestProblem }[] = []
  const ids = new Set<string>()
  const prefixes = new Map<string, string>()
  for (const manifest of manifests) {
    if (ids.has(manifest.id))
      problems.push({
        id: manifest.id,
        problem: { path: 'id', message: `Another connector has the id ${manifest.id}.` },
      })
    ids.add(manifest.id)
    if (manifest.refPrefix === undefined) continue
    const tool = prefixes.get(manifest.refPrefix)
    if (tool !== undefined && tool !== manifest.tool)
      problems.push({
        id: manifest.id,
        problem: {
          path: 'refPrefix',
          message: `${tool} already writes refs under ${manifest.refPrefix}:. A prefix belongs to one tool.`,
        },
      })
    else prefixes.set(manifest.refPrefix, manifest.tool)
  }
  return problems
}

/** The settings a connector's secrets are bound to, each once. */
export const secretsBoundTo = (manifest: Pick<ConnectorManifest, 'secrets'>): string[] => [
  ...new Set(manifest.secrets.flatMap((secret) => secret.boundTo)),
]
