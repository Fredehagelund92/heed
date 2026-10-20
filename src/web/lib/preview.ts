import type { Area, Person } from '@domain/item'
import type { CatalogueTerm, CatalogueTermDetail } from '@/api'
import type { LibrarySearch } from '@/lib/search-params'

/*
  The quick preview of a chip (the editor design, section 6; contract 5, the term hover card): what
  a chip points at, where its page is, and the short sentences its card says. Pure, so the card,
  the @ list's peek, the stories and the tests share one answer.

  A chip names its target in one of three spellings: the mention markup's key (`metric:orders`,
  `dim:market`, `val:market/norway`, `item:itm_1`, `area:commercial`), the library's `about`
  value (`orders`, `market:norway`), or a person's id. Each becomes one `PreviewTarget`.
*/

export type PreviewTarget =
  | { type: 'metric'; id: string }
  | { type: 'dim'; id: string }
  | { type: 'val'; dimension: string; value: string }
  | { type: 'item'; id: string }
  | { type: 'person'; id: string }

/** A stable key for a target, for React keys and the cache of the card. */
export function previewKey(target: PreviewTarget): string {
  switch (target.type) {
    case 'val':
      return `val:${target.dimension}/${target.value}`
    default:
      return `${target.type}:${target.id}`
  }
}

/**
 * The target of a mention or scope key in the markup's spelling. Null for what has no preview:
 * a domain (its chip goes to the domain's library), a metric group, a malformed key.
 */
export function previewTargetOf(key: string): PreviewTarget | null {
  const at = key.indexOf(':')
  if (at <= 0) return null
  const prefix = key.slice(0, at)
  const rest = key.slice(at + 1)
  if (!rest) return null
  if (prefix === 'metric') return { type: 'metric', id: rest }
  if (prefix === 'dim') return { type: 'dim', id: rest }
  if (prefix === 'item') return { type: 'item', id: rest }
  if (prefix === 'val') {
    const [dimension, value] = rest.split('/')
    return dimension && value ? { type: 'val', dimension, value } : null
  }
  return null
}

/**
 * The target of a library `about` value: a metric id (`orders`) or a dimension and a value
 * (`market:norway`). A dimension with any value (`market:*`) previews the dimension.
 */
export function previewTargetOfAbout(about: string): PreviewTarget | null {
  const at = about.indexOf(':')
  if (at < 0) return about ? { type: 'metric', id: about } : null
  const dimension = about.slice(0, at)
  const value = about.slice(at + 1)
  if (!dimension || !value) return null
  return value === '*' ? { type: 'dim', id: dimension } : { type: 'val', dimension, value }
}

/**
 * Where a chip opens, as router options: a metric to its catalogue page, a dimension to its page,
 * a value to its dimension's page with the value picked out, an item to its page. A person has no
 * page (there is no people directory), so null.
 */
export function previewPage(target: PreviewTarget) {
  switch (target.type) {
    case 'metric':
      return { to: '/catalogue/metric/$id', params: { id: target.id } } as const
    case 'dim':
      return { to: '/catalogue/dimension/$id', params: { id: target.id } } as const
    case 'val':
      return {
        to: '/catalogue/dimension/$id',
        params: { id: target.dimension },
        search: { value: target.value },
      } as const
    case 'item':
      return { to: '/library/$itemId', params: { itemId: target.id } } as const
    case 'person':
      return null
  }
}

export type PreviewPage = NonNullable<ReturnType<typeof previewPage>>

/**
 * The library's list of every item about a term, which is where a metric or a value chip went
 * before it had a catalogue page; the card keeps it as "Show the N items". A dimension has no
 * single list (an item names one of its values).
 */
export function previewListSearch(target: PreviewTarget): LibrarySearch | null {
  if (target.type === 'metric') return { about: target.id, ended: 'show' }
  if (target.type === 'val') return { about: `${target.dimension}:${target.value}`, ended: 'show' }
  return null
}

/** What the card calls the target's type, after the name. */
export const previewTypeNames: Record<PreviewTarget['type'], string> = {
  metric: 'Metric',
  // eslint-disable-next-line heed/plain-words -- the card is the Catalogue's entry, in its words
  dim: 'Dimension',
  val: 'Value',
  item: 'Fact',
  person: 'Person',
}

const count = (value: number) => value.toLocaleString('en')
const facts = (value: number) => `${count(value)} ${value === 1 ? 'fact' : 'facts'}`

/**
 * The card's one line about the library: "92 facts, 9 mention it. 7 need checking." for a metric,
 * "1,407 facts apply to a market, 179 mention it." for a dimension, "Nothing in the library is
 * about it yet." when nothing is.
 */
export function shelfLine(
  shelf: Pick<CatalogueTerm['shelf'], 'items' | 'mentionedBy'> & { needsALook?: number },
  dimensionName?: string,
): { strong: string; rest: string } {
  if (shelf.items === 0 && shelf.mentionedBy === 0)
    return { strong: '', rest: 'Nothing in the library is about it yet.' }
  const mention =
    shelf.mentionedBy > 0
      ? `, ${count(shelf.mentionedBy)} ${shelf.mentionedBy === 1 ? 'mentions' : 'mention'} it`
      : ''
  const applies = dimensionName ? ` apply to a ${dimensionName.toLocaleLowerCase('en')}` : ''
  const needs =
    shelf.needsALook && shelf.needsALook > 0
      ? ` ${count(shelf.needsALook)} ${shelf.needsALook === 1 ? 'needs' : 'need'} checking.`
      : ''
  return { strong: facts(shelf.items), rest: `${applies}${mention}.${needs}` }
}

/** "Metric · group Payments", "Dimension · 12 values", as the Catalogue says them. */
export function termMeta(term: Pick<CatalogueTerm, 'kind' | 'group'>, values?: number): string {
  if (term.kind === 'metric') return term.group ? `Metric · group ${term.group.name}` : 'Metric'
  return values === undefined
    ? // eslint-disable-next-line heed/plain-words -- the card is the Catalogue's entry, in its words
      'Dimension'
    : // eslint-disable-next-line heed/plain-words -- the card is the Catalogue's entry, in its words
      `Dimension · ${count(values)} ${values === 1 ? 'value' : 'values'}`
}

/** The first values of a dimension the card names, and how many more there are. */
export function firstValues(
  values: readonly { name: string }[],
  limit = 4,
): { shown: string[]; more: number } {
  return {
    shown: values.slice(0, limit).map((value) => value.name),
    more: Math.max(0, values.length - limit),
  }
}

/** One value of a dimension's catalogue detail, by id; null when the dimension does not hold it. */
export function valueOf(term: CatalogueTermDetail, valueId: string) {
  return term.values.find((value) => value.id === valueId) ?? null
}

/**
 * A person's role, from the domains they look after: "Owner of Commercial and Sandbox", or
 * null when they look after none. Heed has no people directory, so this is all a card says about
 * someone.
 */
export function personRole(person: Pick<Person, 'id'>, areas: readonly Area[]): string | null {
  const names = (list: Area[]) => {
    const words = list.map((area) => area.name)
    return words.length <= 1
      ? (words[0] ?? '')
      : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
  }
  const owners = personAreas(person, areas)
  return owners.length ? `Owner of ${names(owners)}` : null
}

/** The domains a person looks after as an owner, for the badges of their card. */
export function personAreas(person: Pick<Person, 'id'>, areas: readonly Area[]): Area[] {
  return areas.filter((area) => area.ownerIds.includes(person.id))
}
