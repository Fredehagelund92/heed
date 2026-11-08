import * as z from 'zod'
import { windowWords } from '../../../domain/dates.ts'
import { kindFilters } from '../../../domain/mcp-text.ts'
import type { RecordsItem, RecordsKind } from '../../../domain/records.ts'
import { isCalendarDate, shiftDate } from '../../../domain/validity.ts'

/*
  Ask's records tool (FR-720.3): the Context list counted, listed and ranked by code, never by a
  model. It reads the items the person's own Context list gives them (published and archived,
  never a draft, a suggestion or a deleted item, never one an audience rule hides), so every
  count is one that page shows them, and each count says what it is out of. Pure: the items, the
  domains and the names come in.
*/

export const kindNames = Object.keys(kindFilters) as (keyof typeof kindFilters)[]
const kindOf = Object.fromEntries(
  Object.entries(kindFilters).map(([name, kind]) => [kind, name]),
) as Record<RecordsKind, keyof typeof kindFilters>

const day = z
  .string()
  .refine(isCalendarDate, 'A calendar day, as YYYY-MM-DD.')
  .describe('A day, as YYYY-MM-DD.')
export const statuses = ['live', 'due', 'archived'] as const
const statusWords: Record<(typeof statuses)[number], string> = {
  live: 'live',
  due: 'due for a check',
  archived: 'archived',
}
const dateFields = ['published', 'changed', 'checked', 'archived'] as const
const sorts = ['last_checked', 'published', 'changed', 'review_date', 'title'] as const
const groupings = ['domain', 'kind', 'status', 'metric', 'value'] as const

export const recordsInput = z.strictObject({
  kinds: z
    .array(z.enum(kindNames))
    .max(4)
    .optional()
    .describe(
      'Only items of these kinds: event, warning, rule or guide. Every kind when left out.',
    ),
  status: z
    .array(z.enum(statuses))
    .max(3)
    .optional()
    .describe(
      'live (published and not due), due (published, its check date passed or its definition changed) or archived. Every status when left out; live and due together are the published items.',
    ),
  domain: z.string().min(1).max(80).optional().describe('A domain by its name, such as Sales.'),
  about: z
    .array(z.string().min(1).max(80))
    .max(6)
    .optional()
    .describe(
      'Metric or market names, such as Orders or Norway: only items about each kind named (any of the metrics, and any of the markets).',
    ),
  dated: z
    .strictObject({
      field: z
        .enum(dateFields)
        .describe('published (first published), changed, checked (last checked) or archived'),
      from: day,
      to: day.describe('The last day, included.'),
    })
    .optional()
    .describe('Only items whose date of this kind falls on these days.'),
  show: z
    .enum(['count', 'list'])
    .default('list')
    .describe('count: the numbers only. list: the numbers and the items, in order.'),
  group_by: z
    .enum(groupings)
    .optional()
    .describe(
      'Count by domain, kind, status, metric, or market (or another dimension value) as well.',
    ),
  sort_by: z
    .enum(sorts)
    .default('title')
    .describe(
      'The order of the list: by last check, first published, last changed, check date or title.',
    ),
  order: z.enum(['oldest_first', 'newest_first']).default('newest_first'),
  limit: z.number().int().min(1).max(25).default(10),
})
export type RecordsInput = z.output<typeof recordsInput>

/** What the records tool reads: the person's Context list and the names it knows. */
export type RecordsTable = {
  items: readonly RecordsItem[]
  areas: readonly { id: string; name: string }[]
  /** A metric or market key's name, for the groups. */
  nameOf: (key: string) => string
  /** Whether the person's Definitions show this key; a hidden one is never named. */
  isShown: (key: string) => boolean
  /** The keys these names name, or why one names nothing known. */
  keysOf: (names: readonly string[]) => { keys: string[]; unknown: string[] }
}

const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : null)
const dateOf = (i: RecordsItem, field: (typeof dateFields)[number]) =>
  ({
    published: i.publishedAt,
    changed: i.changedAt,
    checked: i.checkedAt,
    archived: i.archivedAt,
  })[field]
const sortKey = (i: RecordsItem, by: (typeof sorts)[number]) =>
  by === 'title'
    ? i.title.toLowerCase()
    : by === 'review_date'
      ? i.reviewDate
      : by === 'last_checked'
        ? i.checkedAt
        : by === 'published'
          ? i.publishedAt
          : i.changedAt

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** What a count is out of, in words: "published context items in Sales you may read". */
function populationWords(
  chosen: readonly (typeof statuses)[number][] | undefined,
  count: number,
  area: string | null,
) {
  const set = new Set(chosen?.length ? chosen : statuses)
  const items = count === 1 ? 'context item' : 'context items'
  const where = `${area ? ` in ${area}` : ''} you may read`
  if (set.size === 3) return `${items}${where}`
  if (set.size === 2 && set.has('live') && set.has('due')) return `published ${items}${where}`
  const before = [...set].filter((s) => s !== 'due').map((s) => statusWords[s])
  const due = set.has('due') ? ` ${before.length ? 'or ' : ''}due for a check` : ''
  return `${before.join(' or ')}${before.length ? ' ' : ''}${items}${due}${where}`
}

/**
 * The records the input asks for: how many items fit every filter, out of how many the person
 * may read in the same domain and status, how they group, and the first of them in order.
 */
export function queryRecords(input: RecordsInput, table: RecordsTable) {
  const area = input.domain
    ? table.areas.find((a) => a.name.toLowerCase() === input.domain!.toLowerCase().trim())
    : undefined
  if (input.domain && !area)
    return {
      error: `No domain is called "${input.domain}". The domains are ${table.areas.map((a) => a.name).join(', ')}.`,
    }
  const { keys, unknown } = table.keysOf(input.about ?? [])
  if (unknown.length) return { error: unknown.join(' ') }
  const metrics = keys.filter((k) => k.startsWith('metric:'))
  const values = keys.filter((k) => k.startsWith('val:'))
  const kinds = new Set((input.kinds ?? []).map((k) => kindFilters[k]))
  const status = new Set(input.status ?? [])
  const window = input.dated && { start: input.dated.from, end: shiftDate(input.dated.to, 1) }
  // The population a count is out of: the domain and the statuses asked for.
  const population = table.items.filter(
    (i) => (!area || i.areaId === area.id) && (!status.size || status.has(i.status)),
  )
  const matching = population.filter((i) => {
    if (kinds.size && !kinds.has(i.kind)) return false
    if (metrics.length && !metrics.some((m) => i.metrics?.includes(m))) return false
    if (values.length && !values.some((v) => i.values?.includes(v))) return false
    if (window) {
      const on = isoDay(dateOf(i, input.dated!.field))
      if (!on || on < window.start || on >= window.end) return false
    }
    return true
  })
  const sorted = [...matching].sort((a, b) => {
    const [x, y] = [sortKey(a, input.sort_by), sortKey(b, input.sort_by)]
    // An item with no date of the kind sorted by goes last, whichever the order.
    if (x === y) return a.title.localeCompare(b.title, 'en') || (a.id < b.id ? -1 : 1)
    if (x === null) return 1
    if (y === null) return -1
    const before = x < y ? -1 : 1
    return input.sort_by === 'title' || input.order === 'oldest_first' ? before : -before
  })
  const areaName = (id: string) => table.areas.find((a) => a.id === id)?.name ?? id
  const groups = input.group_by ? groupsOf(matching, input.group_by, table, areaName) : undefined
  const listed = input.show === 'list' ? sorted.slice(0, input.limit) : []
  const out = populationWords(input.status, population.length, area?.name ?? null)
  return {
    count: matching.length,
    outOf: { count: population.length, of: out },
    /** "2 of 13 published context items in Sales you may read", by code. */
    counted: `${matching.length.toLocaleString('en-GB')} of ${population.length.toLocaleString('en-GB')} ${out}`,
    byStatus: Object.fromEntries(
      statuses.map((s) => [s, matching.filter((i) => i.status === s).length]),
    ) as Record<(typeof statuses)[number], number>,
    filters: {
      domain: area?.name ?? null,
      kinds: input.kinds ?? [...kindNames],
      status: input.status ?? [...statuses],
      about: keys.map(table.nameOf),
      period: window ? `${input.dated!.field} ${windowWords(window)}` : null,
    },
    ...(groups ? { groups } : {}),
    items: listed.map((i, at) => ({
      rank: at + 1,
      id: i.id,
      title: i.title,
      kind: kindOf[i.kind],
      domain: areaName(i.areaId),
      status: statusWords[i.status],
      published: isoDay(i.publishedAt),
      changed: isoDay(i.changedAt),
      lastChecked: isoDay(i.checkedAt),
      checkDate: i.reviewDate,
      archived: isoDay(i.archivedAt),
    })),
    more: input.show === 'list' ? Math.max(0, sorted.length - listed.length) : 0,
    order:
      input.show === 'list'
        ? `by ${input.sort_by.replace('_', ' ')}${input.sort_by === 'title' ? '' : `, ${input.order.replace('_', ' ')}`}`
        : null,
    notSeen: 'Drafts, suggestions and deleted items are not context yet, so none is counted.',
  }
}

/** The matching items counted by one part; an item that names several counts under each. */
function groupsOf(
  items: readonly RecordsItem[],
  by: (typeof groupings)[number],
  table: RecordsTable,
  areaName: (id: string) => string,
) {
  const counts = new Map<string, number>()
  const add = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1)
  const none = by === 'metric' ? 'no metric named' : 'no market or value named'
  for (const i of items) {
    if (by === 'domain') add(areaName(i.areaId))
    else if (by === 'kind') add(kindOf[i.kind])
    else if (by === 'status') add(statusWords[i.status])
    else {
      const keys = (by === 'metric' ? (i.metrics ?? []) : (i.values ?? [])).filter(table.isShown)
      if (!keys.length) add(none)
      for (const key of keys) add(table.nameOf(key))
    }
  }
  return {
    by,
    ...(by === 'metric' || by === 'value'
      ? {
          note: `An item that names several counts under each, so the groups add up to more than ${plural(items.length, 'item', 'items')}.`,
        }
      : {}),
    // The items that name none come last, whatever their count.
    rows: [...counts]
      .sort(
        (a, b) =>
          Number(a[0] === none) - Number(b[0] === none) ||
          b[1] - a[1] ||
          a[0].localeCompare(b[0], 'en'),
      )
      .map(([name, count]) => ({ name, count })),
  }
}
