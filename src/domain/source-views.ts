/**
 * What a definition source holds, by view (Sources, the connector contract in
 * docs/connectors.md). A member's view is its name up to the last dot: `payments` of
 * `orders.returns`. A member without a dot is in no view. Pure: the operations overview and
 * the mock binding compute the same answer from the same rule.
 */

/** A current member as the source last read it. */
export type SourceMember = {
  /** The member's name in the source, `orders.returns`. */
  name: string
  kind: 'metric' | 'dimension' | 'group'
  /** The domain the source names for it, or null. */
  areaHint: string | null
  /** The model file that defines its view, or null. */
  modelFile: string | null
  /** Its domain comes from the server's list of domain names, not from the model. */
  fromServer: boolean
}

export type SourceView = {
  name: string
  metrics: number
  dimensions: number
  /** The domains its members belong to, the most members first, then by id. */
  domains: string[]
  /** Its metrics without a domain (CON-516). */
  withoutDomain: number
  /** Its members whose domain comes from the server's list. */
  fromServer: number
  modelFile: string | null
}

/** The view a member is in, or null when its name has no dot. */
export function viewOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : null
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The views of the members given, by name. */
export function sourceViews(members: readonly SourceMember[]): SourceView[] {
  const views = new Map<string, SourceMember[]>()
  for (const member of members) {
    const view = viewOf(member.name)
    if (view !== null) views.set(view, [...(views.get(view) ?? []), member])
  }
  return [...views.entries()]
    .sort(([a], [b]) => byCodePoint(a, b))
    .map(([name, rows]) => {
      const domains = new Map<string, number>()
      for (const row of rows)
        if (row.areaHint) domains.set(row.areaHint, (domains.get(row.areaHint) ?? 0) + 1)
      return {
        name,
        metrics: rows.filter((row) => row.kind === 'metric').length,
        dimensions: rows.filter((row) => row.kind === 'dimension').length,
        domains: [...domains.entries()]
          .sort(([a, x], [b, y]) => y - x || byCodePoint(a, b))
          .map(([domain]) => domain),
        withoutDomain: rows.filter((row) => row.kind === 'metric' && row.areaHint === null).length,
        fromServer: rows.filter((row) => row.fromServer).length,
        modelFile: rows.find((row) => row.modelFile !== null)?.modelFile ?? null,
      }
    })
}
