/*
  The nouns Ask's answers name (FR-720): a metric, a dimension, a value of a dimension, a domain
  and a person, each by the id a typed mention writes: `metric:orders`, `dimension:channel`,
  `value:channel/web_shop`, `domain:area_sales`, `person:<id>`. The vocabulary's own keys
  (`metric:orders`, `dim:channel`, `val:channel/web_shop`) map to them one to one, so a value
  always says which dimension it is of. Nothing here knows a dimension, a domain or a person by
  name: every workspace's own definitions draw the same way.
*/

export const nounKinds = ['metric', 'dimension', 'value', 'domain', 'person'] as const
export type NounKind = (typeof nounKinds)[number]

/** A vocabulary key as the id a typed mention writes: `dim:x` is `dimension:x`, `val:x/y` is `value:x/y`. */
export function nounId(key: string): string {
  if (key.startsWith('dim:')) return `dimension:${key.slice(4)}`
  if (key.startsWith('val:')) return `value:${key.slice(4)}`
  return key
}

/** A metric's, dimension's or value's typed id as its vocabulary key; null for any other id. */
export function termKeyOf(id: string): string | null {
  if (id.startsWith('metric:')) return id
  if (id.startsWith('dimension:')) return `dim:${id.slice('dimension:'.length)}`
  if (id.startsWith('value:')) return `val:${id.slice('value:'.length)}`
  return null
}

/** The kind a typed id names, or null when it is no noun's. */
export function nounKindOf(id: string): NounKind | null {
  const kind = id.slice(0, id.indexOf(':'))
  return (nounKinds as readonly string[]).includes(kind) ? (kind as NounKind) : null
}

/** The dimension a value's id is of: `value:channel/web_shop` is of `dimension:channel`. */
export const dimensionOf = (id: string): string | null =>
  id.startsWith('value:') ? `dimension:${id.slice('value:'.length).split('/')[0]}` : null

/**
 * A hue for a dimension, from its id, the same every time and in every workspace: no dimension
 * has a hue of its own, so none is special. 0 to 359.
 */
export function dimensionHue(id: string): number {
  let h = 0
  for (const c of id.replace(/^dimension:/, '')) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
