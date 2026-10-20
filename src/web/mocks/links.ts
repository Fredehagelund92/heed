import type { Area, ContextItem, Vocabulary } from '../../domain/item.ts'
import { mentionsInFields, type Mention } from '../../domain/mentions.ts'
import type {
  IncomingLink,
  ItemLinks,
  LinkTargetType,
  OutgoingLink,
} from '../../contract/schemas.ts'
import { INCOMING_LINKS_MAX } from '../../contract/limits.ts'

/**
 * Typed links between fixture items, worked out the way the service reads them from its mention
 * table: a mention points at a vocabulary key, an item or an area, and never changes scope.
 */

type Reference = { areas: Area[]; vocabulary: Vocabulary }

const mentionsOf = (item: ContextItem): Mention[] =>
  mentionsInFields({ summaryMarkup: item.summaryMarkup, bodyMarkup: item.bodyMarkup })

/** True when the item's summary or body mentions `target`, for example `metric:orders`. */
export function mentions(item: ContextItem, target: string): boolean {
  return mentionsOf(item).some((mention) => mention.target === target)
}

function targetOf(
  key: string,
  byId: Map<string, ContextItem>,
  { areas, vocabulary }: Reference,
): { type: LinkTargetType; name: string | undefined; retired?: boolean } {
  const [prefix, rest = ''] = key.split(/:(.*)/s)
  switch (prefix) {
    case 'metric':
      return { type: 'metric', name: vocabulary.metrics.find((m) => m.id === rest)?.name }
    case 'dim':
      return { type: 'dimension', name: vocabulary.dimensions.find((d) => d.id === rest)?.name }
    case 'val': {
      const [dimension, value] = rest.split('/')
      const values = vocabulary.dimensions.find((d) => d.id === dimension)?.values ?? []
      return { type: 'dimension_value', name: values.find((v) => v.id === value)?.name }
    }
    case 'item': {
      const item = byId.get(rest)
      return { type: 'item', name: item?.title, retired: item?.status === 'retired' }
    }
    default:
      return { type: 'area', name: areas.find((area) => area.id === rest)?.name }
  }
}

const newestFirst = (a: ContextItem, b: ContextItem) =>
  b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** What an item mentions, and which items mention it (one row per item, its first mention). */
export function linksOf(items: ContextItem[], id: string, reference: Reference): ItemLinks | null {
  const byId = new Map(items.map((item) => [item.id, item]))
  const item = byId.get(id)
  if (!item) return null
  const outgoing: OutgoingLink[] = mentionsOf(item).map((mention) => {
    const target = targetOf(mention.target, byId, reference)
    return {
      field: mention.field,
      position: mention.position,
      words: mention.label,
      target: {
        type: target.type,
        key: mention.target,
        name: target.name ?? mention.label,
        status: target.retired ? 'retired' : 'current',
      },
    }
  })
  const incoming: IncomingLink[] = items
    .filter((source) => source.id !== id && mentions(source, `item:${id}`))
    .sort(newestFirst)
    .map((source) => {
      const first = mentionsOf(source).find((mention) => mention.target === `item:${id}`)!
      return {
        field: first.field,
        position: first.position,
        words: first.label,
        source: { id: source.id, kind: source.kind, title: source.title, status: source.status },
      }
    })
  return {
    mentions: outgoing,
    mentionedBy: { rows: incoming.slice(0, INCOMING_LINKS_MAX), total: incoming.length },
  }
}
