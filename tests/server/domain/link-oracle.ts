import type {
  LinkBundle,
  LinkItem,
  RawLink,
  Related,
  RelatedRequest,
} from '../../../src/domain/links.ts'

/*
  An independent oracle for `related`: no index, no shared helpers. It writes every edge out as
  one flat list, decides visibility from the rules as the requirements state them (FR-314,
  FR-333, FR-334), finds distances by repeated full scans, and then picks, orders and counts.
*/

/** A dimension's members in the views of the metrics, or all of them when none is. */
function relevantRefs(refs: readonly string[], metricRefs: readonly string[]) {
  const view = (ref: string) =>
    ref
      .slice(ref.indexOf(':') + 1)
      .split('.')
      .slice(0, -1)
      .join('.')
  const views = metricRefs.map(view)
  const relevant = refs.filter((ref) => views.includes(view(ref)))
  return refs.length > 1 && relevant.length ? relevant : refs
}

const order = [
  'replaces',
  'replaced_by',
  'conflicts_with',
  'applies_to',
  'mentions',
  'mentioned_by',
  'in_area',
]
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
type Edge = { from: string; to: string; rel: string; row: RawLink }
type Window = { start: string; end: string | null } | undefined
const overlap = (
  a: { start: string; end: string | null },
  w: { start: string; end: string | null },
) => (w.end === null || a.start < w.end) && (a.end === null || w.start < a.end)

export function relatedOracle(bundle: LinkBundle, request: RelatedRequest): Related {
  const window: Window = request.window
  const wanted = request.relations ?? order.filter((r) => r !== 'in_area')
  const areaOk = (id: string) => !bundle.stopped.all && !bundle.stopped.areas.includes(id)
  const unverified = (item: LinkItem) =>
    item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < request.today)
  // As for a question about the item's own metrics: the item's own domain decides its stop.
  const itemOk = (item: LinkItem, w: Window) =>
    item.status === 'accepted' &&
    item.audience.kind === 'everyone' &&
    areaOk(item.areaId) &&
    !bundle.stopped.items.includes(item.id) &&
    !(item.riskLevel === 'high' && unverified(item)) &&
    (!w || overlap(item.validity, w))
  const findItem = (id: string) => bundle.items.find((i) => i.id === id)
  const termOk = (key: string) => {
    const term = bundle.terms.find((t) => t.key === key)!
    return !bundle.stopped.all && (term.areaId === null || areaOk(term.areaId))
  }

  const edges: Edge[] = []
  for (const row of bundle.links)
    edges.push({ from: row.from_item, to: row.to_id, rel: row.rel, row })
  for (const item of bundle.items)
    edges.push({
      from: item.id,
      to: item.areaId,
      rel: 'in_area',
      row: { from_item: item.id, rel: 'in_area', to_kind: 'area', to_id: item.areaId, label: null },
    })

  type Target =
    | { visible: false }
    | { visible: true; node: Record<string, unknown>; status: string; expand: boolean }
  /** The target end of an edge, seen from its writer. */
  function target(edge: Edge, w: Window): Target {
    const row = edge.row
    if (row.to_kind === 'item') {
      const item = findItem(row.to_id)
      if (item)
        return itemOk(item, w)
          ? { visible: true, node: itemNode(item), status: 'current', expand: true }
          : { visible: false }
      const old = bundle.retired.find((r) => r.id === row.to_id)
      if (
        !old ||
        old.audience !== null ||
        !areaOk(old.areaId) ||
        bundle.stopped.items.includes(old.id) ||
        (w && !overlap(old.validity, w))
      )
        return { visible: false }
      const by = old.replacedBy ? findItem(old.replacedBy) : undefined
      const status = by && itemOk(by, w) ? 'replaced' : 'retired'
      return {
        visible: true,
        status,
        expand: false,
        node: {
          type: 'item',
          id: old.id,
          label: row.label ?? 'Retired item',
          status,
          ...(status === 'replaced' ? { replaced_by: by!.id } : {}),
        },
      }
    }
    if (row.to_kind === 'area') {
      const area = bundle.areas.find((a) => a.id === row.to_id)
      return area && areaOk(area.id)
        ? { visible: true, status: 'current', expand: true, node: areaNode(area.id) }
        : { visible: false }
    }
    const term = bundle.terms.find((t) => t.key === row.to_id)
    if (!term)
      return {
        visible: true,
        status: 'unresolved',
        expand: false,
        node: {
          type: row.to_kind,
          id: row.to_id,
          label: row.label ?? row.to_id,
          status: 'unresolved',
        },
      }
    if (!termOk(term.key)) return { visible: false }
    // Only the members in the views of the item's metrics count, or all without one there.
    const from = bundle.items.find((item) => item.id === edge.from)
    const metricRefs = (from?.scope.metrics ?? []).flatMap(
      (key) => bundle.terms.find((t) => t.key === key)?.definitionRefs ?? [],
    )
    const refs = relevantRefs(term.definitionRefs, metricRefs)
    const own = ownStatus(term.key, refs)
    let status = own
    if (own === 'current')
      for (const ref of refs) {
        const mark =
          row.rel === 'mentions'
            ? row.definition_ref === ref
              ? row.change_mark
              : null
            : bundle.refMarks[edge.from]?.[ref]
        const definition = term.definitions.find((d) => d.ref === ref)
        if (mark && definition && definition.changeMark !== mark) status = 'source_changed'
      }
    // A node is the term with all its members, whichever item reached it.
    const node = termNode(term.key)
    if (node.status !== 'current') node.label = row.label ?? term.name
    return { visible: true, status, expand: true, node }
  }
  function ownStatus(key: string, refs?: readonly string[]) {
    const term = bundle.terms.find((t) => t.key === key)!
    const states = (refs ?? term.definitionRefs).map((ref) =>
      term.definitions.find((d) => d.ref === ref),
    )
    if (states.some((state) => state === undefined)) return 'unresolved'
    if (states.some((state) => state?.missing)) return 'source_missing'
    return 'current'
  }
  function termNode(key: string, refs?: readonly string[]): Record<string, unknown> {
    const term = bundle.terms.find((t) => t.key === key)!
    const status = ownStatus(key, refs)
    const node: Record<string, unknown> = {
      type: term.kind,
      id: term.key,
      label: term.name,
      status,
    }
    if (status === 'current' && term.definitionRefs[0]) node.source_ref = term.definitionRefs[0]
    const renamed = (refs ?? term.definitionRefs)
      .map((ref) => term.definitions.find((d) => d.ref === ref))
      .find((d) => d?.missing && d.renamedTo)?.renamedTo
    if (status === 'source_missing' && renamed) node.renamed_to = renamed
    return node
  }
  function itemNode(item: LinkItem): Record<string, unknown> {
    return {
      type: 'item',
      id: item.id,
      kind: item.kind,
      label: item.title,
      summary: item.summary,
      area: item.areaId,
      validity: item.validity,
      risk: item.riskLevel,
      freshness: unverified(item) ? 'unverified' : 'verified',
      status: 'current',
    }
  }
  function areaNode(id: string): Record<string, unknown> {
    return {
      type: 'area',
      id,
      label: bundle.areas.find((a) => a.id === id)!.name,
      status: 'current',
    }
  }

  // The start.
  const rootId = request.id.startsWith('area:') ? request.id.slice(5) : request.id
  let root: Record<string, unknown> | null = null
  const rootItem = findItem(request.id)
  if (rootItem) root = itemOk(rootItem, undefined) ? itemNode(rootItem) : null
  else if (bundle.terms.some((t) => t.key === request.id))
    root = termOk(request.id) ? termNode(request.id) : null
  else if (bundle.areas.some((a) => a.id === rootId))
    root = areaOk(rootId) ? areaNode(rootId) : null
  if (!root) return { found: false }
  const rootKey = root.id as string

  type Candidate = {
    id: string
    node: Record<string, unknown>
    relation: string
    from: string
    expand: boolean
  }
  const isCurrentItem = (id: string) => {
    const item = findItem(id)
    return !!item && itemOk(item, id === rootKey ? undefined : window)
  }
  /** Every way out of a node, one full scan of the edge list. */
  function around(id: string, hidden: Set<string>): Candidate[] {
    const out: Candidate[] = []
    for (const edge of edges) {
      if (edge.from === id && isCurrentItem(id) && edge.to !== id) {
        const relation =
          edge.rel === 'mentions' ? 'mentions' : edge.rel === 'replaces' ? 'replaces' : edge.rel
        if (!wanted.includes(relation as never)) continue
        const t = target(edge, window)
        if (!t.visible) hidden.add(edge.to)
        else out.push({ id: edge.to, node: t.node, relation, from: id, expand: t.expand })
      }
      if (edge.to === id && edge.from !== id) {
        if (edge.rel === 'in_area' && !bundle.areas.some((a) => a.id === id)) continue
        const relation =
          edge.rel === 'mentions'
            ? 'mentioned_by'
            : edge.rel === 'replaces'
              ? 'replaced_by'
              : edge.rel
        if (!wanted.includes(relation as never)) continue
        const writer = findItem(edge.from)
        if (!writer) continue
        if (!itemOk(writer, window)) hidden.add(writer.id)
        else out.push({ id: writer.id, node: itemNode(writer), relation, from: id, expand: true })
      }
    }
    return out
  }

  const hidden = new Set<string>()
  const best = new Map<string, Candidate & { distance: number }>()
  const counts: Record<string, Set<string>> = {}
  let frontier = [{ id: rootKey, expand: true }]
  for (let distance = 1; distance <= request.depth; distance++) {
    const found: (Candidate & { distance: number })[] = []
    for (const node of frontier.filter((f) => f.expand))
      for (const c of around(node.id, hidden)) {
        if (c.id === rootKey) continue
        if (distance === 1) (counts[c.relation] ??= new Set()).add(c.id)
        if (!best.has(c.id)) found.push({ ...c, distance })
      }
    const chosen = new Map<string, Candidate & { distance: number }>()
    for (const c of found) {
      const prior = chosen.get(c.id)
      const label = c.node.label as string
      const better =
        !prior ||
        order.indexOf(c.relation) < order.indexOf(prior.relation) ||
        (c.relation === prior.relation &&
          (c.from < prior.from || (c.from === prior.from && label < (prior.node.label as string))))
      if (better) chosen.set(c.id, c)
    }
    for (const [id, c] of chosen) best.set(id, c)
    frontier = [...chosen.values()].map((c) => ({ id: c.id, expand: c.expand }))
  }

  const risk = { low: 0, normal: 1, high: 2 }
  const keyOf = (n: Record<string, unknown>) =>
    n.type === 'item' && n.status === 'current'
      ? { r: risk[n.risk as 'low'], s: (n.validity as { start: string }).start }
      : { r: -1, s: '' }
  const listed = [...best.values()].sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance
    if (a.relation !== b.relation) return order.indexOf(a.relation) - order.indexOf(b.relation)
    const ka = keyOf(a.node),
      kb = keyOf(b.node)
    if (ka.r !== kb.r) return kb.r - ka.r
    if (ka.s !== kb.s) return cmp(kb.s, ka.s)
    return cmp(a.id, b.id)
  })
  const ids = [rootKey, ...listed.map((l) => l.id)]
  const pos = (id: string) => ids.indexOf(id) - 1
  const out: (Record<string, unknown> & { after: number })[] = []
  for (const edge of edges) {
    if (!ids.includes(edge.from) || !ids.includes(edge.to) || edge.from === edge.to) continue
    if (!findItem(edge.from)) continue
    const names =
      edge.rel === 'mentions'
        ? ['mentions', 'mentioned_by']
        : edge.rel === 'replaces'
          ? ['replaces', 'replaced_by']
          : [edge.rel]
    if (!names.some((n) => wanted.includes(n as never))) continue
    if (out.some((e) => e.from === edge.from && e.to === edge.to && e.rel === edge.rel)) continue
    const t = target(edge, edge.to === rootKey ? undefined : window)
    if (!t.visible) continue
    out.push({
      from: edge.from,
      to: edge.to,
      rel: edge.rel,
      status: t.status,
      after: Math.max(pos(edge.from), pos(edge.to)),
    })
  }
  out.sort(
    (a, b) =>
      a.after - b.after ||
      order.indexOf(a.rel as string) - order.indexOf(b.rel as string) ||
      cmp(a.from as string, b.from as string) ||
      cmp(a.to as string, b.to as string),
  )
  for (const id of ids) hidden.delete(id)
  return {
    found: true,
    root: root as never,
    nodes: listed.map((l) => ({ ...l.node, distance: l.distance })) as never,
    edges: out as never,
    counts: Object.fromEntries(Object.entries(counts).map(([r, s]) => [r, s.size])),
    withheld: hidden.size,
  }
}
