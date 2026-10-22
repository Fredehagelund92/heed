/**
 * The members of a definition source that are not vocabulary terms yet, each as the term an
 * administrator may propose for it (B1 of the pilot walk; FR-125, FR-136). Heed reads every
 * public member of the source, but scope, the catalogue and `get_facts` only know terms, so a
 * member reaches people once a term names it and an owner or administrator accepts it.
 *
 * Pure: the service and the mock binding suggest the same terms from the same members.
 */
import { agreedDomain } from './catalogue.ts'
import { viewOf } from './source-views.ts'
import { normalizeName, refView } from './vocabulary.ts'

/** A current member as the source last read it. */
export type CandidateMember = {
  /** `cube:orders.returns`. */
  ref: string
  /** The source that reads it, by id. */
  source: string
  kind: 'metric' | 'dimension' | 'group'
  /** `orders.returns`. */
  name: string
  /** The source's title: Cube prefixes the view's ("Orders Returns"). */
  title: string | null
  description: string | null
  valueType: string | null
  /** The domain the source gives it, or null. */
  areaHint: string | null
  /** The other names the model's authors give it (Cube's `meta.synonyms`). */
  synonyms: readonly string[]
  /**
   * Its own name when a view joins it with a prefix: `store_name` of `orders.store_store_name`.
   * Null when the name after the view is its own.
   */
  baseName: string | null
}

/** A live term or an open term proposal (`open`), with what it links. */
export type KnownTerm = {
  key: string
  kind: string
  name: string
  aliases: string[]
  areaId: string | null
  definitionRefs: string[]
  open: boolean
}

export type TermCandidate = {
  /** The source that reads the members it links, by id. */
  source: string
  key: string
  kind: 'metric' | 'dimension'
  name: string
  aliases: string[]
  /**
   * Every member the term links once accepted: a metric's one, or each view's member of a
   * dimension's name (strict merge by name: one dimension, many Cube names).
   */
  definitionRefs: string[]
  /** The members the live term of this key links already; empty for a new term. */
  linked: string[]
  /**
   * A metric's domain is the one the source gives it. A dimension whose views lie in several
   * domains (market, brand, device) is shared and belongs to none, so an administrator looks
   * after it (CON-206); a dimension of one domain's views takes that domain.
   */
  areaId: string | null
  /** The views that have its members, by name. */
  views: string[]
  description: string | null
  valueType: string | null
  /**
   * Whether to propose it unless someone says otherwise: not a date or time (the item's dates
   * cover those) and not an id. Linking more members to a live term always is.
   */
  suggested: boolean
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The part of a member's name after its view: `returns` of `orders.returns`. */
export const memberOf = (name: string) => name.slice(name.lastIndexOf('.') + 1)

/** A key part: lower-case letters, digits and `_` (the vocabulary's key rule). */
export function keyPart(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const words = (text: string) => text.replace(/_+/g, ' ').trim()
const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** A member's own name: after its view, and after the prefix a view joined it with. */
export const ownName = (member: Pick<CandidateMember, 'name' | 'baseName'>) =>
  member.baseName ?? memberOf(member.name)

/** A name in words as Cube titles it when the model gives no title: "Brand Brand Name". */
const titled = (text: string) =>
  words(text)
    .split(' ')
    .map((word) => capitalized(word))
    .join(' ')

/**
 * A member's name as people read it: its title without the view's title in front ("Orders
 * Returns" is "Returns"), or its own name in words ("sum_cost" is "Sum cost"). A member a view
 * joins with a prefix reads as its own name: Cube titles `orders.store_store_name` "Orders
 * Store Store Name", which reads "Store name"; a title the authors gave loses the join's words.
 */
export function memberName(member: Pick<CandidateMember, 'name' | 'title' | 'baseName'>): string {
  const view = viewOf(member.name)
  const afterView = memberOf(member.name)
  const title = member.title?.trim()
  if (!title) return capitalized(words(ownName(member)))
  const prefix = view ? words(view).toLowerCase() : ''
  const rest = (
    prefix && title.toLowerCase().startsWith(`${prefix} `) ? title.slice(prefix.length + 1) : title
  ).trim()
  if (member.baseName) {
    if (rest === titled(afterView)) return capitalized(words(member.baseName))
    const join = words(afterView.slice(0, afterView.length - member.baseName.length)).toLowerCase()
    if (join && rest.toLowerCase().startsWith(`${join} `))
      return capitalized(rest.slice(join.length + 1).trim())
  }
  return capitalized(rest || words(afterView))
}

const isTime = (valueType: string | null) => valueType === 'time'
const isId = (member: string) => /(^|_)id$/i.test(member)

/** The one domain the members' views agree on, or none. */
const domainOf = (members: readonly CandidateMember[]) =>
  agreedDomain(members.map((member) => member.areaHint))

/**
 * One candidate per metric, and one per dimension name however many views have it, for the
 * members no live term or open proposal links yet. Dimensions merge strictly by name: every
 * view's member with the same name after the view is one dimension. A live dimension that links
 * some of them, or that has the name's key, is offered again with the rest linked too, unless a
 * proposal for it waits for a decision. Members of one name that several terms link were split by
 * hand and stay so. A metric key another view already uses takes the view's name in front, and
 * so does a metric name that another candidate or a live or proposed metric already has: the
 * vocabulary refuses two metrics of one name.
 */
export function termCandidates(
  members: readonly CandidateMember[],
  known: readonly KnownTerm[],
): TermCandidate[] {
  const linkedBy = new Map<string, KnownTerm[]>()
  for (const term of known)
    for (const ref of term.definitionRefs) linkedBy.set(ref, [...(linkedBy.get(ref) ?? []), term])
  const keys = new Set(known.map((term) => term.key))
  const waiting = new Set(known.filter((term) => term.open).map((term) => term.key))
  const memberByRef = new Map(members.map((member) => [member.ref, member]))
  const sorted = [...members].sort((a, b) => byCodePoint(a.ref, b.ref))
  const candidates: TermCandidate[] = []

  const dimensions = new Map<string, CandidateMember[]>()
  for (const member of sorted)
    if (member.kind === 'dimension') {
      const part = keyPart(ownName(member))
      if (part) dimensions.set(part, [...(dimensions.get(part) ?? []), member])
    }
  for (const [part, shared] of dimensions) {
    const unlinked = shared.filter((member) => !linkedBy.has(member.ref))
    if (!unlinked.length) continue
    const owners = [
      ...new Map(
        shared.flatMap((member) => linkedBy.get(member.ref) ?? []).map((t) => [t.key, t]),
      ).values(),
    ]
    const key = owners.length ? owners[0]!.key : `dim:${part}`
    if (owners.length > 1 || waiting.has(key)) continue
    const live = owners[0] ?? known.find((term) => term.key === key && !term.open)
    if (keys.has(key) && !live) continue
    if (live) {
      // A live dimension of this name links the rest too, one member in each view.
      if (live.kind !== 'dimension') continue
      const views = new Set(live.definitionRefs.map(refView))
      const adds = unlinked.filter((member) => !views.has(viewOf(member.name)))
      if (!adds.length) continue
      const definitionRefs = [...live.definitionRefs, ...adds.map((member) => member.ref)].sort(
        byCodePoint,
      )
      const linkedMembers = definitionRefs.flatMap((ref) => memberByRef.get(ref) ?? [])
      candidates.push({
        source: adds[0]!.source,
        key: live.key,
        kind: 'dimension',
        name: live.name,
        aliases: live.aliases,
        definitionRefs,
        linked: [...live.definitionRefs],
        areaId: live.areaId ?? domainOf(linkedMembers),
        views: [...new Set(linkedMembers.flatMap((member) => viewOf(member.name) ?? []))],
        description: adds[0]!.description,
        valueType: adds[0]!.valueType,
        suggested: true,
      })
      continue
    }
    const first = shared[0]!
    keys.add(key)
    candidates.push({
      source: first.source,
      key,
      kind: 'dimension',
      name: memberName(first),
      aliases: [],
      definitionRefs: shared.map((member) => member.ref),
      linked: [],
      areaId: domainOf(shared),
      views: [...new Set(shared.flatMap((member) => viewOf(member.name) ?? []))],
      description: first.description,
      valueType: first.valueType,
      suggested: !isTime(first.valueType) && !isId(ownName(first)),
    })
  }

  // A metric name another view's metric, or a known metric, already has takes its view's name
  // after it.
  const metricNames = new Set(
    known.flatMap((term) =>
      term.kind === 'metric' ? [term.name, ...term.aliases].map(normalizeName) : [],
    ),
  )
  for (const member of sorted) {
    if (member.kind !== 'metric' || linkedBy.has(member.ref)) continue
    const part = keyPart(ownName(member))
    const view = viewOf(member.name)
    const key = [`metric:${part}`, `metric:${keyPart(`${view ?? ''}_${part}`)}`].find(
      (candidate) => !keys.has(candidate),
    )
    if (!part || !key) continue
    keys.add(key)
    const plain = memberName(member)
    const name = metricNames.has(normalizeName(plain)) && view ? `${plain} (${words(view)})` : plain
    metricNames.add(normalizeName(name))
    candidates.push({
      source: member.source,
      key,
      kind: 'metric',
      name,
      aliases: [],
      definitionRefs: [member.ref],
      linked: [],
      areaId: member.areaHint,
      views: view ? [view] : [],
      description: member.description,
      valueType: member.valueType,
      suggested: !isId(ownName(member)),
    })
  }
  withSynonyms(candidates, members, known)
  // Metrics first, then dimensions, each by name.
  return candidates.sort(
    (a, b) =>
      Number(a.kind === 'dimension') - Number(b.kind === 'dimension') ||
      a.name.localeCompare(b.name, 'en'),
  )
}

/** The most other names one term has (the contract's limit). */
const ALIASES_MAX = 20

/**
 * Gives each candidate the other names its members' authors gave them (Cube's `meta.synonyms`,
 * FR-107), after the ones a live term has. An other name goes to one term only: one that another
 * term or candidate of the kind already goes by, or that two candidates would share ("country"
 * on three different members), is left out, so a proposal never clashes over it. An owner adds
 * it by hand to the term it belongs to.
 */
function withSynonyms(
  candidates: TermCandidate[],
  members: readonly CandidateMember[],
  known: readonly KnownTerm[],
) {
  const byRef = new Map(members.map((member) => [member.ref, member]))
  const own = (candidate: TermCandidate) =>
    new Set([candidate.name, ...candidate.aliases].map(normalizeName))
  const offered = new Map<TermCandidate, Map<string, string>>()
  const offeredBy = new Map<string, number>()
  for (const candidate of candidates) {
    const names = new Map<string, string>()
    const mine = own(candidate)
    for (const ref of candidate.definitionRefs)
      for (const synonym of byRef.get(ref)?.synonyms ?? []) {
        const name = normalizeName(synonym)
        if (name && !mine.has(name) && !names.has(name)) names.set(name, synonym)
      }
    offered.set(candidate, names)
    for (const name of names.keys()) {
      const counted = `${candidate.kind}|${name}`
      offeredBy.set(counted, (offeredBy.get(counted) ?? 0) + 1)
    }
  }
  for (const candidate of candidates) {
    const elsewhere = new Set(
      [
        ...known.filter((term) => term.kind === candidate.kind && term.key !== candidate.key),
        ...candidates.filter((other) => other.kind === candidate.kind && other !== candidate),
      ].flatMap((term) => [term.name, ...term.aliases].map(normalizeName)),
    )
    const added = [...offered.get(candidate)!]
      .filter(([name]) => offeredBy.get(`${candidate.kind}|${name}`) === 1 && !elsewhere.has(name))
      .map(([, synonym]) => synonym)
    candidate.aliases = [...candidate.aliases, ...added].slice(0, ALIASES_MAX)
  }
}

/**
 * Dimension values from a pasted list, one per line: the name, then any other names after
 * commas ("Norway, Norge"). Blank lines and repeats are left out; a line whose name
 * makes no key is returned in `unreadable`.
 */
export function pastedValues(
  dimensionKey: string,
  text: string,
): {
  values: { key: string; name: string; aliases: string[] }[]
  unreadable: string[]
} {
  const dimension = dimensionKey.slice(dimensionKey.indexOf(':') + 1)
  const values = new Map<string, { key: string; name: string; aliases: string[] }>()
  const unreadable: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const [name = '', ...aliases] = line.split(',').map((part) => part.trim())
    if (!name) continue
    const part = keyPart(name)
    if (!part) {
      unreadable.push(line.trim())
      continue
    }
    const key = `val:${dimension}/${part}`
    if (!values.has(key))
      values.set(key, {
        key,
        name,
        aliases: [...new Set(aliases.filter((alias) => alias && alias !== name))],
      })
  }
  return { values: [...values.values()], unreadable }
}
