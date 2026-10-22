/**
 * The pure link resolver (FR-331 to FR-335): the links of a delivered item, and the neighbours of
 * an item, a vocabulary term or a domain for `get_related`. A link only says what a text refers
 * to. It never decides what get_facts delivers, and a link is shown only when its target passes
 * the same visibility rule as an item (FR-314). A pure function of its inputs: no clock, no I/O.
 */
import { noGroups, type ItemKind, type RiskLevel } from './item.ts'
import {
  compareIds,
  resolve,
  type EditionBundle,
  type ResolverItem,
  type Withheld,
} from './resolver.ts'
import { overlaps, type DateWindow } from './validity.ts'
import { relevantRefs, type Term } from './vocabulary.ts'

/** One link row of an item version in the served edition, as the database lists it. */
export type RawLink = {
  from_item: string
  rel: string
  to_kind: string
  to_id: string
  label: string | null
  /** For a mention of a term: the definition and its change mark when the version was written. */
  definition_ref?: string | null
  change_mark?: string | null
}
/** The state of a term's definition in the source, as the last successful read left it. */
export type DefinitionState = {
  ref: string
  missing: boolean
  renamedTo: string | null
  changeMark: string
}
/**
 * A vocabulary term with the state of its definitions, for link statuses (FR-333): one for each
 * of its `definitionRefs` that the source has read, in the same order.
 */
export type LinkTerm = Term & { definitions: readonly DefinitionState[] }
export type LinkItem = ResolverItem & { kind: ItemKind; title: string }
/** An item of an earlier edition that is no longer served: a link to it is a tombstone. */
export type RetiredItem = {
  id: string
  areaId: string
  audience: readonly string[] | null
  validity: { start: string; end: string | null }
  replacedBy: string | null
}
export type LinkBundle = Omit<EditionBundle, 'items'> & {
  items: readonly LinkItem[]
  terms: readonly LinkTerm[]
  links: readonly RawLink[]
  areas: readonly { id: string; name: string; team: string | null }[]
  refMarks: Readonly<Record<string, Readonly<Record<string, string>>>>
  retired: readonly RetiredItem[]
}

/** What a served link's target is now, as an agent reads it in a reply. */
export const servedLinkStatuses = [
  'current',
  'retired',
  'replaced',
  'source_missing',
  'source_changed',
  'unresolved',
] as const
export type LinkStatus = (typeof servedLinkStatuses)[number]
export type Link = {
  rel: string
  target: {
    type: string
    id: string
    label: string
    status: LinkStatus
    area?: string
    source_ref?: string
    replaced_by?: string
    renamed_to?: string
  }
}

/** Lookups over one bundle, built once per call so a large edition is not scanned per link. */
export type LinkIndex = {
  item(id: string): LinkItem | undefined
  retired(id: string): RetiredItem | undefined
  term(key: string): LinkTerm | undefined
  area(id: string): LinkBundle['areas'][number] | undefined
  /** Link rows written by an item. */
  from(id: string): readonly RawLink[]
  /** Link rows that point at an item, a term or an area. */
  to(id: string): readonly RawLink[]
  /** Served items of an area. */
  inArea(id: string): readonly LinkItem[]
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}
export function linkIndex(bundle: LinkBundle): LinkIndex {
  const items = new Map(bundle.items.map((i) => [i.id, i]))
  const retired = new Map(bundle.retired.map((i) => [i.id, i]))
  const terms = new Map(bundle.terms.map((t) => [t.key, t]))
  const areas = new Map(bundle.areas.map((a) => [a.id, a]))
  const from = group(bundle.links, (l) => l.from_item)
  const to = group(bundle.links, (l) => l.to_id)
  const inArea = group(bundle.items, (i) => i.areaId)
  return {
    item: (id) => items.get(id),
    retired: (id) => retired.get(id),
    term: (key) => terms.get(key),
    area: (id) => areas.get(id),
    from: (id) => from.get(id) ?? [],
    to: (id) => to.get(id) ?? [],
    inArea: (id) => inArea.get(id) ?? [],
  }
}

/**
 * FR-314: why the resolver would not deliver an item for its own scope, or null when it would.
 * `other` is an item no rule withholds by name: retired, or a proposal.
 */
export function withholding(
  bundle: EditionBundle,
  item: ResolverItem,
  today: string,
  window?: DateWindow,
): Withheld['reason'] | 'other' | null {
  const result = resolve(
    { ...bundle, items: [item] },
    {
      scope: {
        status: 'resolved',
        scope: {
          metrics: item.scope.metrics,
          filters: Object.fromEntries(item.scope.dimensions.map((d) => [d, []])),
          window: window ?? {
            start: item.validity.start,
            end: item.validity.end ?? '9999-12-31',
          },
        },
      },
      today,
      sizeLimit: Number.MAX_SAFE_INTEGER,
      dependenciesAvailable: true,
      groups: noGroups,
      hiddenMetrics: [],
    },
  )
  if (result.items.length === 1) return null
  if (result.withheld[0]) return result.withheld[0].reason
  return 'other'
}

/** FR-314: an item may be shown when the resolver would deliver it for its own scope. */
export function canRead(
  bundle: EditionBundle,
  item: ResolverItem,
  today: string,
  window?: DateWindow,
): boolean {
  return withholding(bundle, item, today, window) === null
}

const areaShown = (bundle: LinkBundle, areaId: string) =>
  !bundle.stopped.all && !bundle.stopped.areas.includes(areaId)
/** A term is hidden while its area is stopped (FR-333: counted, not listed). */
export const termShown = (bundle: LinkBundle, term: LinkTerm) =>
  !bundle.stopped.all && (!term.areaId || areaShown(bundle, term.areaId))
/**
 * The states of the members that matter, by ref: a term's definitions in the views of the
 * item's metrics (`relevantRefs`), or all of them without an item. A ref the source never read
 * has none.
 */
function relevantStates(
  term: LinkTerm,
  index?: LinkIndex,
  from?: LinkItem,
): { ref: string; state: DefinitionState | undefined }[] {
  const metricRefs =
    from && index ? from.scope.metrics.flatMap((key) => index.term(key)?.definitionRefs ?? []) : []
  return relevantRefs(term.definitionRefs, metricRefs).map((ref) => ({
    ref,
    state: term.definitions.find((definition) => definition.ref === ref),
  }))
}
/** Without a link's own mark: unresolved, or missing in the source, or current. */
function definitionStatus(states: ReturnType<typeof relevantStates>): LinkStatus {
  return states.some(({ state }) => !state)
    ? 'unresolved'
    : states.some(({ state }) => state?.missing)
      ? 'source_missing'
      : 'current'
}

/** What one link row points at, as the caller may see it. */
type Resolved =
  | { kind: 'hidden' }
  | { kind: 'item'; item: LinkItem }
  | { kind: 'tombstone'; id: string; label: string; status: 'retired' | 'replaced'; by?: string }
  | {
      kind: 'term'
      term: LinkTerm
      status: LinkStatus
      label: string
      /** The words the item wrote for it, or its name. */
      written: string
      states: ReturnType<typeof relevantStates>
    }
  | { kind: 'area'; area: LinkBundle['areas'][number] }
  | { kind: 'unresolved'; type: string; id: string; label: string }

function resolveRow(
  bundle: LinkBundle,
  index: LinkIndex,
  from: LinkItem,
  row: RawLink,
  today: string,
  window?: DateWindow,
): Resolved {
  if (row.to_kind === 'item') {
    const linked = index.item(row.to_id)
    if (linked)
      return canRead(bundle, linked, today, window)
        ? { kind: 'item', item: linked }
        : { kind: 'hidden' }
    const retired = index.retired(row.to_id)
    if (
      !retired ||
      retired.audience !== null ||
      !areaShown(bundle, retired.areaId) ||
      bundle.stopped.items.includes(retired.id) ||
      (window && !overlaps(retired.validity, window))
    )
      return { kind: 'hidden' }
    // A tombstone gives the author's own words and never the target's content (FR-333).
    const label = row.label ?? 'Retired item'
    const replacement = retired.replacedBy ? index.item(retired.replacedBy) : undefined
    return replacement && canRead(bundle, replacement, today, window)
      ? { kind: 'tombstone', id: retired.id, label, status: 'replaced', by: replacement.id }
      : { kind: 'tombstone', id: retired.id, label, status: 'retired' }
  }
  if (row.to_kind === 'area') {
    const area = index.area(row.to_id)
    return area && areaShown(bundle, area.id) ? { kind: 'area', area } : { kind: 'hidden' }
  }
  const term = index.term(row.to_id)
  if (!term)
    return {
      kind: 'unresolved',
      type: row.to_kind,
      id: row.to_id,
      label: row.label ?? row.to_id,
    }
  if (!termShown(bundle, term)) return { kind: 'hidden' }
  // The mark the item saw: a mention records its own, scope uses the reviewed references.
  // A mention of a term repointed since (a repaired rename) has no comparable mark. Only the
  // members that matter to the item's metrics count (CON-209).
  const states = relevantStates(term, index, from)
  const approvedMark = (ref: string) =>
    row.rel === 'mentions'
      ? row.definition_ref === ref
        ? (row.change_mark ?? undefined)
        : undefined
      : bundle.refMarks[from.id]?.[ref]
  const known = definitionStatus(states)
  const status =
    known === 'current' &&
    states.some(({ ref, state }) => {
      const approved = approvedMark(ref)
      return approved !== undefined && state?.changeMark !== approved
    })
      ? 'source_changed'
      : known
  return {
    kind: 'term',
    term,
    status,
    label: status === 'current' ? term.name : (row.label ?? term.name),
    written: row.label ?? term.name,
    states,
  }
}
/** Every item is in its area: the one link that is not stored as a row. */
const areaRow = (item: LinkItem): RawLink => ({
  from_item: item.id,
  rel: 'in_area',
  to_kind: 'area',
  to_id: item.areaId,
  label: null,
})
function statusOf(resolved: Exclude<Resolved, { kind: 'hidden' }>): LinkStatus {
  return resolved.kind === 'tombstone' || resolved.kind === 'term'
    ? resolved.status
    : resolved.kind === 'unresolved'
      ? 'unresolved'
      : 'current'
}

const linkOrder = [
  'replaces',
  'replaced_by',
  'conflicts_with',
  'applies_to',
  'mentions',
  'in_area',
  'mentioned_by',
]
/**
 * The outgoing links of an item, in a fixed order (FR-327), and how many were withheld because
 * the caller may not see their target or its domain is stopped (FR-333, FR-334).
 */
export function outgoing(
  bundle: LinkBundle,
  item: LinkItem,
  today: string,
  window?: DateWindow,
  index: LinkIndex = linkIndex(bundle),
): { links: Link[]; withheld: number } {
  const links: Link[] = []
  let withheld = 0
  for (const row of [...index.from(item.id), areaRow(item)]) {
    const resolved = resolveRow(bundle, index, item, row, today, window)
    if (resolved.kind === 'hidden') {
      withheld++
      continue
    }
    const status = statusOf(resolved)
    const target: Link['target'] =
      resolved.kind === 'item'
        ? {
            type: 'item',
            id: resolved.item.id,
            label: resolved.item.title,
            status,
            area: resolved.item.areaId,
          }
        : resolved.kind === 'tombstone'
          ? {
              type: 'item',
              id: resolved.id,
              label: resolved.label,
              status,
              ...(resolved.by ? { replaced_by: resolved.by } : {}),
            }
          : resolved.kind === 'area'
            ? { type: 'area', id: resolved.area.id, label: resolved.area.name, status }
            : resolved.kind === 'unresolved'
              ? { type: resolved.type, id: resolved.id, label: resolved.label, status }
              : termTarget(resolved.term, status, resolved.label, resolved.states)
    links.push({ rel: row.rel, target })
  }
  links.sort(
    (a, b) =>
      linkOrder.indexOf(a.rel) - linkOrder.indexOf(b.rel) || compareIds(a.target.id, b.target.id),
  )
  return {
    links: links.filter(
      (l, i) => !links.slice(0, i).some((p) => p.rel === l.rel && p.target.id === l.target.id),
    ),
    withheld,
  }
}
function termTarget(
  term: LinkTerm,
  status: LinkStatus,
  label: string,
  states: ReturnType<typeof relevantStates> = relevantStates(term),
): Link['target'] {
  const renamedTo = states.find(({ state }) => state?.missing && state.renamedTo)?.state?.renamedTo
  const [sourceRef] = term.definitionRefs
  return {
    type: term.kind,
    id: term.key,
    label,
    status,
    // A pointer to the source, never a calculation; only for a target in service (FR-331).
    ...(status === 'current' && sourceRef ? { source_ref: sourceRef } : {}),
    ...(renamedTo && status === 'source_missing' ? { renamed_to: renamedTo } : {}),
  }
}

/*
  get_related (FR-332). A node is an item, a vocabulary term or a domain. Edges are the stored
  links, always from the item that wrote them: `mentions`, `applies_to` (scope), `replaces`,
  `conflicts_with`, and `in_area`. Seen from a node, a relation names how a neighbour connects:
  `mentions` and `replaces` point away from an item, `mentioned_by` and `replaced_by` point at
  it, and the other three need no direction because their ends have different types (or, for a
  conflict, are symmetric). No link is inferred: no similarity, sibling or transitive edge.
*/
export const relations = [
  'replaces',
  'replaced_by',
  'conflicts_with',
  'applies_to',
  'mentions',
  'mentioned_by',
  'in_area',
] as const
export type Relation = (typeof relations)[number]
/** Every item of a domain is not a neighbour worth following unless asked for: no `in_area`. */
export const defaultRelations: readonly Relation[] = relations.filter((r) => r !== 'in_area')
export const relatedLimits = { maxDepth: 2, maxNodes: 50, defaultNodes: 20 } as const

export type EdgeRel = 'mentions' | 'applies_to' | 'replaces' | 'conflicts_with' | 'in_area'
export type RelatedEdge = { from: string; to: string; rel: EdgeRel; status: LinkStatus }
/** An item in service: what search shows, never its body. */
export type ItemNode = {
  type: 'item'
  id: string
  kind: ItemKind
  label: string
  summary: string
  area: string
  validity: { start: string; end: string | null }
  risk: RiskLevel
  freshness: 'verified' | 'unverified'
  status: 'current'
}
/** A retired or replaced item: the author's words only (FR-333). */
export type TombstoneNode = {
  type: 'item'
  id: string
  label: string
  status: 'retired' | 'replaced'
  replaced_by?: string
}
/** A vocabulary term, a domain, or a target no longer served. */
export type TargetNode = Link['target']
export type RelatedNode = ItemNode | TombstoneNode | TargetNode
export type RelatedRequest = {
  id: string
  relations?: readonly Relation[] | undefined
  depth: number
  today: string
  /** Neighbour items must overlap these dates (end exclusive), as links in get_facts do. */
  window?: DateWindow | undefined
}
export type Related =
  | { found: false }
  | {
      found: true
      root: RelatedNode
      /** In the fixed order (FR-327); each node once, at its shortest distance. */
      nodes: (RelatedNode & { distance: number })[]
      /** Edges among the root and the nodes; `after` is the list position of the later end. */
      edges: (RelatedEdge & { after: number })[]
      /** Visible neighbours of the root by relation, before any page or cap (FR-334). */
      counts: Partial<Record<Relation, number>>
      /** Distinct neighbours the caller may not see, or whose domain is stopped. */
      withheld: number
    }

const relationRank = (r: string) => (relations as readonly string[]).indexOf(r)
const riskRank: Record<RiskLevel, number> = { low: 0, normal: 1, high: 2 }
export const isItemNode = (node: RelatedNode): node is ItemNode =>
  node.type === 'item' && node.status === 'current' && 'risk' in node
/** The relation a stored edge answers to, seen from its source item (forward) or its target. */
function relationOf(rel: string, forward: boolean): Relation | null {
  switch (rel) {
    case 'mentions':
      return forward ? 'mentions' : 'mentioned_by'
    case 'replaces':
      return forward ? 'replaces' : 'replaced_by'
    case 'conflicts_with':
    case 'applies_to':
    case 'in_area':
      return rel
    default:
      return null
  }
}

function itemNode(item: LinkItem, today: string): ItemNode {
  const unverified =
    item.checkFlag !== null || (item.reviewDate !== null && item.reviewDate < today)
  return {
    type: 'item',
    id: item.id,
    kind: item.kind,
    label: item.title,
    summary: item.summary,
    area: item.areaId,
    validity: item.validity,
    risk: item.riskLevel,
    freshness: unverified ? 'unverified' : 'verified',
    status: 'current',
  }
}
type Shown = Exclude<Resolved, { kind: 'hidden' }>
function nodeOf(resolved: Shown, today: string): RelatedNode {
  switch (resolved.kind) {
    case 'item':
      return itemNode(resolved.item, today)
    case 'tombstone':
      return {
        type: 'item',
        id: resolved.id,
        label: resolved.label,
        status: resolved.status,
        ...(resolved.by ? { replaced_by: resolved.by } : {}),
      }
    case 'area':
      return { type: 'area', id: resolved.area.id, label: resolved.area.name, status: 'current' }
    case 'unresolved':
      return { type: resolved.type, id: resolved.id, label: resolved.label, status: 'unresolved' }
    case 'term': {
      // A changed definition is a property of each link (its edge), not of the term itself,
      // and a node is the term with all its members, whichever item reached it.
      const status = definitionStatus(relevantStates(resolved.term))
      return termTarget(
        resolved.term,
        status,
        status === 'current' ? resolved.term.name : resolved.written,
      )
    }
  }
}

type Step = { node: RelatedNode; relation: Relation; expandable: boolean }

/**
 * The neighbours of a node in the wanted relations. Neighbour items must be visible within the
 * window; hidden neighbours are only collected, by id, so they can be counted (FR-333).
 */
function neighbours(
  bundle: LinkBundle,
  index: LinkIndex,
  node: RelatedNode,
  request: RelatedRequest,
  wanted: ReadonlySet<Relation>,
  hidden: Set<string>,
): Step[] {
  const steps: Step[] = []
  const item = isItemNode(node) ? index.item(node.id) : undefined
  if (item)
    for (const row of [...index.from(item.id), areaRow(item)]) {
      const relation = relationOf(row.rel, true)
      if (!relation || !wanted.has(relation) || row.to_id === item.id) continue
      const resolved = resolveRow(bundle, index, item, row, request.today, request.window)
      if (resolved.kind === 'hidden') hidden.add(row.to_id)
      else
        steps.push({
          node: nodeOf(resolved, request.today),
          relation,
          expandable: resolved.kind !== 'tombstone' && resolved.kind !== 'unresolved',
        })
    }
  // Rows that point at this node. Their writer must be visible itself.
  const incoming =
    node.type === 'area'
      ? [...index.to(node.id), ...index.inArea(node.id).map(areaRow)]
      : index.to(node.id)
  for (const row of incoming) {
    const relation = relationOf(row.rel, false)
    if (!relation || !wanted.has(relation) || row.from_item === node.id) continue
    const source = index.item(row.from_item)
    if (!source) continue
    if (canRead(bundle, source, request.today, request.window))
      steps.push({ node: itemNode(source, request.today), relation, expandable: true })
    else hidden.add(source.id)
  }
  return steps
}

function rootOf(
  bundle: LinkBundle,
  index: LinkIndex,
  id: string,
  today: string,
): RelatedNode | null {
  const item = index.item(id)
  if (item) return canRead(bundle, item, today) ? itemNode(item, today) : null
  const term = index.term(id)
  if (term)
    return termShown(bundle, term)
      ? termTarget(term, definitionStatus(relevantStates(term)), term.name)
      : null
  const area = index.area(id.startsWith('area:') ? id.slice(5) : id)
  return area && areaShown(bundle, area.id)
    ? { type: 'area', id: area.id, label: area.name, status: 'current' }
    : null
}

/**
 * The neighbours of an item, a term or a domain, at most `depth` steps away (FR-332). A start the
 * caller may not see is not found, exactly like one that does not exist (FR-334). Each node is
 * listed once, at its shortest distance, in a fixed order: distance, relation, higher risk, newer
 * start, id. Paging and size caps are the caller's.
 */
export function related(bundle: LinkBundle, request: RelatedRequest): Related {
  if (
    !Number.isInteger(request.depth) ||
    request.depth < 1 ||
    request.depth > relatedLimits.maxDepth
  )
    throw new Error('Depth must be 1 or 2')
  const index = linkIndex(bundle)
  const root = rootOf(bundle, index, request.id, request.today)
  if (!root) return { found: false }
  const wanted = new Set(request.relations ?? defaultRelations)
  const hidden = new Set<string>()
  const perRelation = new Map<Relation, Set<string>>()
  type Reached = Step & { distance: number; from: string }
  // Among several ways to a node at its shortest distance, the first relation in the fixed order
  // wins, then the lower id of the node it came from; the node's words follow that way.
  const earlier = (a: Reached, b: Reached) =>
    relationRank(a.relation) - relationRank(b.relation) ||
    compareIds(a.from, b.from) ||
    compareIds(a.node.label, b.node.label)
  const reached = new Map<string, Reached>()
  let frontier: RelatedNode[] = [root]
  for (let distance = 1; distance <= request.depth; distance++) {
    const next = new Map<string, Reached>()
    for (const node of frontier)
      for (const step of neighbours(bundle, index, node, request, wanted, hidden)) {
        const id = step.node.id
        if (id === root.id) continue
        if (distance === 1)
          perRelation.set(step.relation, (perRelation.get(step.relation) ?? new Set()).add(id))
        if (reached.has(id)) continue
        const candidate = { ...step, distance, from: node.id }
        const known = next.get(id)
        if (!known || earlier(candidate, known) < 0) next.set(id, candidate)
      }
    for (const [id, value] of next) reached.set(id, value)
    frontier = [...next.values()].filter((r) => r.expandable).map((r) => r.node)
  }
  const sortKey = (node: RelatedNode) =>
    isItemNode(node)
      ? { risk: riskRank[node.risk], start: node.validity.start }
      : { risk: -1, start: '' }
  const listed = [...reached.values()].sort((a, b) => {
    const ka = sortKey(a.node),
      kb = sortKey(b.node)
    return (
      a.distance - b.distance ||
      relationRank(a.relation) - relationRank(b.relation) ||
      kb.risk - ka.risk ||
      compareIds(kb.start, ka.start) ||
      compareIds(a.node.id, b.node.id)
    )
  })
  const position = new Map<string, number>([[root.id, -1]])
  listed.forEach((r, i) => position.set(r.node.id, i))
  // Every stored link starts at a served item, so the edges among listed nodes are the outgoing
  // links of the listed items (and the root) whose other end is listed too.
  const edges: (RelatedEdge & { after: number })[] = []
  for (const [id, from] of position) {
    const item = index.item(id)
    if (!item) continue
    const seen = new Set<string>()
    for (const row of [...index.from(id), areaRow(item)]) {
      const to = position.get(row.to_id)
      const forward = relationOf(row.rel, true),
        backward = relationOf(row.rel, false)
      if (to === undefined || row.to_id === id || seen.has(`${row.rel}|${row.to_id}`)) continue
      if (!(forward && wanted.has(forward)) && !(backward && wanted.has(backward))) continue
      // Both ends are listed; the row gives the link's status. The root may lie outside the
      // window, which only applies to neighbours.
      const resolved = resolveRow(
        bundle,
        index,
        item,
        row,
        request.today,
        row.to_id === root.id ? undefined : request.window,
      )
      if (resolved.kind === 'hidden') continue
      seen.add(`${row.rel}|${row.to_id}`)
      edges.push({
        from: id,
        to: row.to_id,
        rel: row.rel as EdgeRel,
        status: statusOf(resolved),
        after: Math.max(from, to),
      })
    }
  }
  edges.sort(
    (a, b) =>
      a.after - b.after ||
      relationRank(a.rel) - relationRank(b.rel) ||
      compareIds(a.from, b.from) ||
      compareIds(a.to, b.to),
  )
  for (const id of reached.keys()) hidden.delete(id)
  hidden.delete(root.id)
  return {
    found: true,
    root,
    nodes: listed.map((r) => ({ ...r.node, distance: r.distance })),
    edges,
    counts: Object.fromEntries([...perRelation].map(([r, ids]) => [r, ids.size])),
    withheld: hidden.size,
  }
}
