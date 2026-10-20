import type { ConnectorManifest, ManifestField } from './connector-manifest.ts'

/*
  A source's settings, checked against its connector's manifest (interface 3.0, "The settings
  form"). The form and the service both call `parseConnectorConfig`, so a person sees the same
  words before they send as the service gives when it refuses. A connector's runtime may add
  rules a manifest cannot say; the service runs those after these.
*/

/** One setting as stored: text, a number, a yes or no, lines of text, or a map of names. */
export type ConnectorConfigValue = string | number | boolean | string[] | Record<string, string>
export type ConnectorConfig = Record<string, ConnectorConfigValue>

/** A problem with one field of a source's settings, in words for the person who wrote it. */
export interface FieldProblem {
  field: string
  message: string
}

const TEXT_MAX = 500
const JSON_MAX = 20_000
const LIST_MAX = 50
const MAP_MAX = 200
const LINE_MAX = 200
const domainId = /^[a-z][a-z0-9_]{1,39}$/
const loopback = ['localhost', '127.0.0.1', '[::1]']

/**
 * An address a source may be given: https, or plain http to this machine only (for a Git host
 * in tests), without a user name, a password, a query or a fragment. The service checks again
 * that it leads to a public host when it connects.
 */
export function isSourceAddress(value: string): boolean {
  const url = URL.parse(value)
  return (
    url !== null &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && loopback.includes(url.hostname)))
  )
}

/** A folder inside a repository or a share: no way out of it, no hidden Git folder. */
export function isRelativePath(value: string): boolean {
  if (value === '') return true
  return value
    .split('/')
    .every((part) => /^[A-Za-z0-9._ -]{1,100}$/.test(part) && !['.', '..', '.git'].includes(part))
}

/** A branch, tag or commit as Git names one, which git cannot read as an option or a range. */
export function isGitRef(value: string): boolean {
  return /^[A-Za-z0-9._/-]{1,200}$/.test(value) && !/^[-/]|\/$|\.lock$|\.\.|\/\//.test(value)
}

/** Whether a field shows: always, or while the field it depends on has the value it names. */
export function fieldVisible(
  field: Pick<ManifestField, 'visibleIf'>,
  config: Readonly<Record<string, unknown>>,
): boolean {
  if (!field.visibleIf) return true
  return config[field.visibleIf.field] === field.visibleIf.equals
}

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1)

/** One value checked against its field: the value to keep, nothing, or what is wrong. */
function parseValue(
  field: ManifestField,
  raw: unknown,
): { value?: ConnectorConfigValue } | { problem: string } {
  const missing = {
    problem: `Give the ${lower(field.label)}${field.kind === 'address' && !/address$/i.test(field.label) ? ' address' : ''}.`,
  }
  switch (field.kind) {
    case 'boolean':
      if (raw === undefined) return {}
      return typeof raw === 'boolean' ? { value: raw } : { problem: 'Choose yes or no.' }
    case 'integer': {
      if (raw === undefined || raw === '') return field.required ? missing : {}
      const value = typeof raw === 'string' && /^-?\d+$/.test(raw.trim()) ? Number(raw) : raw
      if (typeof value !== 'number' || !Number.isSafeInteger(value))
        return { problem: 'Give a whole number.' }
      if (field.minimum !== undefined && value < field.minimum)
        return { problem: `Give ${field.minimum.toLocaleString('en')} or more.` }
      if (field.maximum !== undefined && value > field.maximum)
        return { problem: `Give ${field.maximum.toLocaleString('en')} or less.` }
      return { value }
    }
    case 'list': {
      if (raw === undefined) return field.required ? missing : {}
      if (!Array.isArray(raw) || raw.some((line) => typeof line !== 'string'))
        return { problem: 'Give lines of text.' }
      const lines = (raw as string[]).map((line) => line.trim()).filter(Boolean)
      if (!lines.length) return field.required ? missing : {}
      const most = field.maxItems ?? LIST_MAX
      if (lines.length > most) return { problem: `Give at most ${most} lines.` }
      if (lines.some((line) => [...line].length > LINE_MAX))
        return { problem: `Keep each line to ${LINE_MAX} characters.` }
      if (new Set(lines).size !== lines.length) return { problem: 'Give each line once.' }
      if (field.pattern !== undefined) {
        const pattern = new RegExp(field.pattern, 'u')
        if (lines.some((line) => !pattern.test(line)))
          return { problem: field.patternMessage ?? 'A line is not written as it should be.' }
      }
      return { value: lines }
    }
    case 'domain_map': {
      if (raw === undefined) return field.required ? missing : {}
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return { problem: 'Not a list of names.' }
      const lines = Object.entries(raw as Record<string, unknown>)
      const most = field.maxItems ?? MAP_MAX
      if (lines.length > most) return { problem: `Give at most ${most} names.` }
      const map = new Map<string, string>()
      for (const [from, to] of lines) {
        const name = from.trim()
        if (!name) return { problem: 'Each line needs the name the tool gives.' }
        if ([...name].length > LINE_MAX)
          return { problem: `Keep each name to ${LINE_MAX} characters.` }
        if (typeof to !== 'string' || !domainId.test(to))
          return { problem: `Choose the domain for ${name}.` }
        if (map.has(name)) return { problem: 'Give each name once.' }
        map.set(name, to)
      }
      if (!map.size) return field.required ? missing : {}
      return { value: Object.fromEntries(map) }
    }
    default: {
      if (raw === undefined) return field.required ? missing : {}
      if (typeof raw !== 'string') return { problem: 'Give text.' }
      const text =
        field.kind === 'json'
          ? raw.trim()
          : field.kind === 'path'
            ? raw.trim().replace(/^\/+|\/+$/g, '')
            : raw.trim()
      if (!text) return field.required ? missing : {}
      const most = field.maxLength ?? (field.kind === 'json' ? JSON_MAX : TEXT_MAX)
      if ([...text].length > most)
        return { problem: `Use at most ${most.toLocaleString('en')} characters.` }
      if (field.kind === 'address' && !isSourceAddress(text))
        return {
          problem:
            'Use an https address, without a user name, password, query or fragment. A secret goes in its own field.',
        }
      if (field.kind === 'path' && !isRelativePath(text))
        return { problem: 'Name a folder inside it, such as model or docs/finance.' }
      if (field.kind === 'ref' && !isGitRef(text))
        return {
          problem:
            'Use letters, digits, dots, dashes, underscores and slashes, as Git names a branch.',
        }
      if (
        (field.kind === 'select' || field.kind === 'radio') &&
        !field.options?.some((o) => o.value === text)
      )
        return { problem: 'Choose one of the options.' }
      if (field.kind === 'json')
        try {
          JSON.parse(text)
        } catch {
          return { problem: 'This is not JSON. Check the brackets, commas and quotes.' }
        }
      if (field.pattern !== undefined && !new RegExp(field.pattern, 'u').test(text))
        return { problem: field.patternMessage ?? 'This is not written as it should be.' }
      return { value: text }
    }
  }
}

/**
 * A source's settings as stored, or every problem with them by field. Empty values are left
 * out, a field hidden by another's value is dropped, and a key the manifest does not name is
 * refused. A secret never comes here: the manifest's secrets are not settings.
 */
export function parseConnectorConfig(
  manifest: Pick<ConnectorManifest, 'config' | 'secrets'>,
  config: Readonly<Record<string, unknown>>,
): { config: ConnectorConfig } | { problems: FieldProblem[] } {
  const problems: FieldProblem[] = []
  const fields = manifest.config.fields
  for (const key of Object.keys(config))
    if (!fields.some((field) => field.key === key))
      problems.push({
        field: key,
        message: manifest.secrets.some((secret) => secret.key === key)
          ? 'A secret goes in its own field only.'
          : 'This source has no such setting.',
      })
  const stored: ConnectorConfig = {}
  for (const field of fields) {
    if (!fieldVisible(field, config)) continue
    const parsed = parseValue(field, config[field.key])
    if ('problem' in parsed) problems.push({ field: field.key, message: parsed.problem })
    else if (parsed.value !== undefined) stored[field.key] = parsed.value
  }
  return problems.length ? { problems } : { config: stored }
}

/** The domains a source's settings name, which must be domains that exist (I-5). */
export function connectorConfigDomains(
  manifest: Pick<ConnectorManifest, 'config'>,
  config: Readonly<Record<string, unknown>>,
): string[] {
  const named = manifest.config.fields
    .filter((field) => field.kind === 'domain_map')
    .flatMap((field) => {
      const value = config[field.key]
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.values(value as Record<string, unknown>).filter(
            (to): to is string => typeof to === 'string',
          )
        : []
    })
  return [...new Set(named)]
}

/** The secrets a source of this connector must be given when it is added. */
export const requiredSecrets = (manifest: Pick<ConnectorManifest, 'secrets'>) =>
  manifest.secrets.filter((secret) => secret.required)
