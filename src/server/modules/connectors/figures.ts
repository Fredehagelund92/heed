import { ORPCError } from '@orpc/client'
import type {
  DataContact,
  FigureRead,
  FigureSource,
  FigureSourceRef,
  FigureSources,
  ReadFigureInput,
  SetFiguresInput,
} from '../../../contract/figures.ts'
import type { FigureQuery, FigureResult } from '../../../domain/connector-runtime.ts'
import { comparisonDays, queryWords, type Days } from '../../../domain/figures.ts'
import type { Queryable } from '../../db/database.ts'
import { plainReason, recordAudit } from '../admin/index.ts'
import { isFetchableAddress } from './git.ts'
import { FigureReadError, type RegisteredConnector } from './platform.ts'
import { SecretStoreError, type SecretStore } from './secrets.ts'
import type { TransactionHooks } from './workspace.ts'

/*
  Figures in Ask (FR-716, CON-612; docs/product.md, sections 9 and 12). A definitions source whose
  connector declares the figures capability keeps its figures settings on its row
  (`connectors.capabilities.figures`, migration 0024): the switch, off by default; the data
  endpoint an administrator set; and the name of the endpoint's token in the secret store, never
  the token. Its data contact is `connectors.data_contact_id`.

  A figure is read when an answer asks for one, from the source the metric's definition comes
  from (the source that holds its ref, under its connector's ref prefix, CON-117), never a guess:
  the definition's own view gives the date and the dimensions, the question gives the days and the
  values. The read has 4 seconds, its result is kept a minute in this process so a busy Ask asks
  once, and nothing of it is written anywhere. No person's identity is passed on: the token is the
  integration's own (CON-406).
*/

/** How long a figure's read may take. Ask shows the answer first and never waits on it. */
export const FIGURE_TIMEOUT_MS = 4_000
/** How long a figure read once is kept in this process, so asking again asks the tool once. */
export const FIGURE_CACHE_MS = 60_000
const CACHE_ENTRIES_MAX = 500

interface FiguresSettings {
  enabled?: boolean
  endpoint?: string
  secretRef?: string
}

interface Row {
  id: string
  type: string
  name: string
  capabilities: { figures?: FiguresSettings }
  contact_id: string | null
  contact_name: string | null
}

const columns = `c.id, c.type, c.name, c.capabilities, c.data_contact_id::text as contact_id,
  p.display_name as contact_name`

const invalid = (field: string, message: string): never => {
  throw new ORPCError('UNPROCESSABLE_CONTENT', {
    message,
    data: { findings: [{ code: 'invalid_setting', field, message, severity: 'error' as const }] },
  })
}

const hostOf = (endpoint: string | undefined) =>
  endpoint ? (URL.parse(endpoint)?.hostname.toLowerCase() ?? null) : null
/** What a token is bound to: the endpoint's scheme, host and port. */
const originOf = (endpoint: string | undefined) =>
  endpoint ? (URL.parse(endpoint)?.origin ?? null) : null

/** A cached figure: what the tool said for the days and the days before, until it expires. */
type Cached = { until: number; result: [FigureResult, FigureResult | null] }

export function createFigureSources({
  secrets,
  connectors,
  now = () => new Date(),
}: {
  secrets: SecretStore
  /** The connectors the registry holds: those that read figures are found here by a source's type. */
  connectors: () => readonly RegisteredConnector[]
  now?: () => Date
}) {
  const cache = new Map<string, Cached>()
  const capable = (type: string) =>
    connectors().find((c) => c.manifest.id === type && c.figure !== undefined)

  const refOf = (row: Row): FigureSourceRef => ({
    id: row.id,
    type: row.type,
    tool: capable(row.type)?.manifest.tool ?? row.name,
    name: row.name,
  })
  const contactOf = (row: Row): DataContact | null =>
    row.contact_id ? { personId: row.contact_id, name: row.contact_name ?? 'Someone' } : null

  async function rows(tx: Queryable, id?: string, lock = false): Promise<Row[]> {
    const found = await tx.query<Row>(
      `select ${columns} from connectors c left join people p on p.id = c.data_contact_id
        where c.kind = 'definition_source' and c.enabled ${id === undefined ? '' : 'and c.id = $1'}
        order by c.id collate "C"${lock ? ' for update of c' : ''}`,
      id === undefined ? [] : [id],
    )
    return found.filter((row) => capable(row.type))
  }

  /** The token kept for a source's endpoint; null when none is set or the store lost it. */
  async function tokenOf(settings: FiguresSettings): Promise<string | null> {
    if (!settings.secretRef) return null
    try {
      const held = await secrets.read(settings.secretRef)
      return typeof held?.token === 'string' ? held.token : null
    } catch (error) {
      if (error instanceof SecretStoreError) return null
      throw error
    }
  }

  async function sourceOf(row: Row, admin: boolean): Promise<FigureSource> {
    const settings = row.capabilities.figures ?? {}
    return {
      ...refOf(row),
      enabled: settings.enabled === true,
      dataContact: contactOf(row),
      connection: admin
        ? {
            endpoint: settings.endpoint ?? null,
            declaredHost: hostOf(settings.endpoint),
            tokenSet: (await tokenOf(settings)) !== null,
          }
        : null,
    }
  }

  /** The figure, read by the source's connector, or from the cache while it is fresh. */
  async function readCached(
    connector: RegisteredConnector,
    row: Row,
    connection: { endpoint: string; token: string; secretRef: string },
    query: FigureQuery,
    before: FigureQuery,
  ): Promise<[FigureResult, FigureResult | null]> {
    const key = JSON.stringify([row.id, connection.endpoint, connection.secretRef, query])
    const at = now().getTime()
    const hit = cache.get(key)
    if (hit && hit.until > at) return hit.result
    const signal = AbortSignal.timeout(FIGURE_TIMEOUT_MS)
    const conn = { endpoint: connection.endpoint, token: connection.token }
    // The days and the days before in one go; the comparison may fail without the figure failing.
    const [figure, compared] = await Promise.all([
      connector.figure!(conn, query, signal),
      connector.figure!(conn, before, signal).catch(() => null),
    ])
    const result: [FigureResult, FigureResult | null] = [figure, compared]
    for (const [old, entry] of cache) if (entry.until <= at) cache.delete(old)
    cache.set(key, { until: at + FIGURE_CACHE_MS, result })
    // The oldest go first once it is full: a Map keeps the order things were put in.
    for (const old of cache.keys()) {
      if (cache.size <= CACHE_ENTRIES_MAX) break
      cache.delete(old)
    }
    return result
  }

  return {
    /** The integrations that read figures; their endpoint and token only for an administrator. */
    async list(tx: Queryable, admin: boolean): Promise<FigureSources> {
      return {
        sources: await Promise.all((await rows(tx)).map((row) => sourceOf(row, admin))),
      }
    },

    /**
     * Changes an integration's figures settings. A token goes into the secret store and is sent
     * only to the endpoint's origin (scheme, host and port): a new origin forgets the token it had,
     * so an administrator cannot send a token they never saw to an address of their choosing. Switching figures on needs an
     * endpoint, its token and a data contact.
     */
    async set(
      tx: Queryable,
      input: SetFiguresInput,
      hooks: TransactionHooks,
    ): Promise<FigureSource> {
      plainReason(input.reason)
      const [row] = await rows(tx, input.id, true)
      if (!row)
        throw new ORPCError('NOT_FOUND', {
          message: "We couldn't find this integration, or it doesn't read figures.",
        })
      const before = row.capabilities.figures ?? {}
      const next: FiguresSettings = { ...before }
      const audit: Record<string, unknown> = {}
      if (input.endpoint !== undefined) {
        const endpoint = input.endpoint
        if (!isFetchableAddress(endpoint))
          invalid(
            'endpoint',
            'Use an https address on a public host, without a user name, password, query or fragment.',
          )
        if (input.token !== undefined && input.token.length >= 8 && endpoint.includes(input.token))
          invalid('token', 'The token is in the address too. Keep it in its own field only.')
        next.endpoint = endpoint
        audit.endpoint = endpoint
      }
      if (input.token !== undefined && input.reason.includes(input.token))
        invalid('token', 'The token is in the reason too. Keep it in its own field only.')
      const rebound =
        next.endpoint !== undefined && originOf(next.endpoint) !== originOf(before.endpoint)
      if (input.token !== undefined || (rebound && before.secretRef)) {
        if (input.token !== undefined) {
          if (!secrets.available)
            invalid(
              'token',
              "There's no secret store, so we can't keep a token. The data team sets one up with CL_SECRETS_DIR.",
            )
          const ref = await secrets.write({ token: input.token })
          hooks.onRollback(() => secrets.remove(ref))
          next.secretRef = ref
          audit.token = before.secretRef ? 'replaced' : 'set'
        } else {
          delete next.secretRef
          audit.token = 'removed'
        }
        const old = before.secretRef
        if (old) hooks.onCommit(() => secrets.remove(old))
      }
      let contact: { id: string; name: string } | null = row.contact_id
        ? { id: row.contact_id, name: row.contact_name ?? 'Someone' }
        : null
      if (input.dataContactId !== undefined) {
        if (input.dataContactId === null) contact = null
        else {
          const [person] = await tx.query<{ id: string; name: string }>(
            `select id::text, display_name as name from people
              where id = $1 and deactivated_at is null`,
            [input.dataContactId],
          )
          if (!person) invalid('dataContactId', "This person isn't in the workspace.")
          contact = person!
        }
        audit.dataContact = contact?.id ?? null
      }
      if (input.enabled !== undefined) {
        next.enabled = input.enabled
        audit.enabled = input.enabled
      }
      if (next.enabled) {
        if (!next.endpoint || !next.secretRef)
          invalid('enabled', 'Set the data endpoint and its token first.')
        if (!contact)
          invalid(
            'enabled',
            'Name a data contact first: the person who hears about a figure that looks wrong.',
          )
      }
      await tx.query(
        `update connectors set capabilities = jsonb_set(capabilities, '{figures}', $2::jsonb),
           data_contact_id = $3 where id = $1`,
        [row.id, JSON.stringify(next), contact?.id ?? null],
      )
      await recordAudit(tx, {
        action: 'figures.changed',
        subjectType: 'source',
        subjectId: row.id,
        details: { ...audit, reason: input.reason },
      })
      return sourceOf(
        {
          ...row,
          capabilities: { ...row.capabilities, figures: next },
          contact_id: contact?.id ?? null,
          contact_name: contact?.name ?? null,
        },
        true,
      )
    },

    /**
     * One figure for an answer, from the source the metric's definition comes from. The figure is
     * never stored and never changes the answer's state; a figure someone said doesn't fit a
     * context item comes with that item while their report is open, one the answer cites first.
     */
    async read(
      tx: Queryable,
      raw: ReadFigureInput,
      administrator: boolean,
    ): Promise<FigureRead> {
      if (raw.from > raw.to) invalid('to', 'The last day comes after the first.')
      const input = { ...raw, values: [...new Set(raw.values)].sort() }
      const keys = [
        input.metric,
        ...input.values,
        ...new Set(input.values.map((v) => `dim:${v.slice(4).split('/')[0]}`)),
      ]
      const terms = await tx.query<{
        key: string
        name: string
        aliases: string[]
        refs: string[]
      }>(
        `select t.key, t.name, t.aliases, t.definition_refs as refs
           from serving_vocabulary((select seq from live_edition)) t where t.key = any($1::text[])`,
        [keys],
      )
      const term = (key: string) => terms.find((t) => t.key === key)
      const metric = term(input.metric)
      if (!metric) return { state: 'none', reason: 'undefined', source: null }
      // The definitions behind the metric, each with the source that holds it.
      const defined = await tx.query<{ ref: string; source: string; name: string }>(
        `select d.ref, d.connector_id as source, d.name from definitions d
          where d.ref = any($1::text[]) and d.kind = 'metric' and d.missing_since_snapshot is null
            and d.visible_groups is null`,
        [metric.refs],
      )
      const sources = (await rows(tx)).filter((row) => defined.some((d) => d.source === row.id))
      const owners = new Set(defined.map((d) => d.source))
      if (!sources.length) return { state: 'none', reason: 'undefined', source: null }
      if (owners.size > 1 || sources.length > 1)
        return { state: 'none', reason: 'ambiguous', source: null }
      const row = sources[0]!
      const connector = capable(row.type)!
      const definition = defined.find((d) => d.source === row.id)!
      const prefix = connector.manifest.refPrefix
      // The prefix names the tool (CON-117): a ref under another prefix is not this tool's.
      if (!prefix || !definition.ref.startsWith(`${prefix}:`))
        return { state: 'none', reason: 'undefined', source: null }
      const source = refOf(row)
      const settings = row.capabilities.figures ?? {}
      if (!settings.enabled)
        return {
          state: 'off',
          source,
          link:
            administrator && settings.endpoint
              ? (URL.parse(settings.endpoint)?.origin ?? null)
              : null,
        }
      const token = await tokenOf(settings)
      if (!settings.endpoint || !token || !settings.secretRef)
        return { state: 'none', reason: 'failed', source, failure: 'not_set_up' }
      // The date and the dimensions come from the metric's own view in the tool.
      const view = definition.name.slice(0, Math.max(definition.name.lastIndexOf('.'), 0))
      const members = await tx.query<{ ref: string; name: string; type: string | null }>(
        `select d.ref, d.name, d.value_type as type from definitions d
          where d.connector_id = $1 and d.kind = 'dimension' and d.missing_since_snapshot is null
            and d.visible_groups is null and starts_with(d.name, $2)`,
        [row.id, `${view}.`],
      )
      const dates = members.filter((m) => m.type === 'time')
      if (dates.length !== 1) return { state: 'none', reason: 'no_date', source }
      const filters: FigureQuery['filters'][number][] = []
      const named: string[] = []
      const byDimension = new Map<string, string[]>()
      for (const value of input.values) {
        const dimension = `dim:${value.slice(4).split('/')[0]}`
        byDimension.set(dimension, [...(byDimension.get(dimension) ?? []), value])
      }
      for (const [dimension, values] of byDimension) {
        const refs = term(dimension)?.refs ?? []
        const member = members.find((m) => refs.includes(m.ref))
        if (!member) return { state: 'none', reason: 'no_split', source }
        const words = values.flatMap((v) => {
          const t = term(v)
          return t ? [t.name, ...t.aliases] : []
        })
        if (!words.length) return { state: 'none', reason: 'no_split', source }
        filters.push({ dimension: member.name, values: [...new Set(words)] })
        named.push(...values.flatMap((v) => term(v)?.name ?? []))
      }
      const days: Days = { from: input.from, to: input.to }
      const earlier = comparisonDays(days)
      const query: FigureQuery = {
        metric: definition.name,
        date: dates[0]!.name,
        from: days.from,
        to: days.to,
        filters,
      }
      let figure: FigureResult
      let compared: FigureResult | null
      try {
        ;[figure, compared] = await readCached(
          connector,
          row,
          { endpoint: settings.endpoint, token, secretRef: settings.secretRef },
          query,
          { ...query, from: earlier.from, to: earlier.to },
        )
      } catch (error) {
        if (error instanceof FigureReadError)
          return { state: 'none', reason: 'failed', source, failure: error.code }
        throw error
      }
      if (figure.value === null) return { state: 'none', reason: 'no_value', source }
      // A figure someone said doesn't fit a context item shows beside it while their report is
      // open: one the answer cites first, else the newest.
      const disputed = await tx.query<{ item_id: string }>(
        'select item_id from cl_figure_disputes($1, $2, $3::text[], $4::date, $5::date)',
        [row.id, input.metric, input.values, days.from, days.to],
      )
      const cited = disputed.find((d) => input.items?.includes(d.item_id)) ?? disputed[0]
      return {
        state: 'figure',
        source,
        value: figure.value,
        format: figure.format,
        from: days.from,
        to: days.to,
        comparison: compared ? { value: compared.value, ...earlier } : null,
        asOf: figure.asOf ?? now().toISOString(),
        queryInWords: queryWords({
          metric: metric.name,
          type: figure.aggregation ?? null,
          tool: source.tool,
          values: named,
          days,
        }),
        dataContact: contactOf(row),
        against: cited ? { itemId: cited.item_id } : null,
      }
    },
  }
}
export type FigureService = ReturnType<typeof createFigureSources>
