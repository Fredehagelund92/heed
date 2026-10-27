/**
 * Observability's counts as a reader may see them (FR-614, FR-620): what agents asked, as topics
 * and counts, never the words and never who asked. A count from one to just under the minimum
 * could point at a few people, so it is hidden; and no count is shown when a hidden one could be
 * worked out from it by subtraction. The service and the app's mock binding both run every count
 * they show through `disclose`, so the two bindings hide the same counts. Pure: callers pass the
 * minimum (`privacy.min_count`).
 */

/** The answer states a chart tells apart. Not checked is a failure, counted on Usage instead. */
export const shownStates = ['grounded', 'partial', 'conflict', 'stale', 'missing'] as const
export type ShownState = (typeof shownStates)[number]
export type StateCounts = Record<ShownState, number>
/** A count as a reader sees it: null when it is hidden. */
export type Shown = number | null
export type ShownCounts = Record<ShownState, Shown>

export const zeroCounts = (): StateCounts => ({
  grounded: 0,
  partial: 0,
  conflict: 0,
  stale: 0,
  missing: 0,
})
export const sumCounts = (c: StateCounts) => shownStates.reduce((n, s) => n + c[s], 0)
export function addCounts(a: StateCounts, b: StateCounts): StateCounts {
  const out = zeroCounts()
  for (const s of shownStates) out[s] = a[s] + b[s]
  return out
}

/**
 * One count that may be shown, and the ways it splits into finer counts shown with it: a topic
 * into its answer states, a topic over its months into each month, a domain into its topics.
 */
export type Quantity = {
  id: string
  value: number
  /**
   * A count that is never hidden to keep another one safe (everything asked, what found nothing):
   * finer counts are hidden instead. It is hidden only when it is small itself.
   */
  anchor?: boolean
  /**
   * The splits by which a total is worth keeping (a topic by its answer states, a domain by its
   * topics): finer counts are hidden first to keep it, and only when that does not close the gap
   * is it hidden itself. By any other split it is hidden itself.
   */
  keep?: number[]
  /** Never hidden to keep a total (what found nothing, in a topic): the total is hidden instead. */
  protect?: boolean
  /** Never shown, only reasoned about: a total a reader could add up from what is shown. */
  unpublished?: boolean
  parts: string[][]
  /**
   * The same count without the filter that narrows it (to one agent): what the filter leaves out
   * must not be a hidden count either, so the two views cannot be subtracted.
   */
  whole?: number
}

/**
 * The counts that may be shown, by id (FR-614, complementary suppression). A count from one to
 * just under the minimum is hidden. A reader can then work out more than is shown: a total from
 * every part of a split, and the one part left over from a total and the others. So, first, for
 * every count a reader can know, each split must leave out nothing, or at least the minimum: a
 * count that fails is hidden itself, a total worth keeping first has the smallest finer count that
 * closes the gap hidden, and an anchor is never hidden for it. Then no hidden count under the
 * minimum may be worked out at all: the way it was worked out is broken, a total before its parts
 * unless the total is worth keeping. Counts are only ever hidden, never shown again, so it ends.
 */
export function disclose(quantities: readonly Quantity[], minimum: number): Set<string> {
  const byId = new Map(quantities.map((q) => [q.id, q]))
  const quantity = (id: string) => {
    const q = byId.get(id)
    if (!q) throw new Error(`No count ${id}`)
    return q
  }
  const parents = new Map<string, string[]>()
  for (const q of quantities)
    for (const split of q.parts)
      for (const p of split) parents.set(p, [...(parents.get(p) ?? []), q.id])
  const fine = (n: number) => n === 0 || n >= minimum
  const shown = new Set(
    quantities
      .filter(
        (q) =>
          !q.unpublished && fine(q.value) && (q.whole === undefined || fine(q.whole - q.value)),
      )
      .map((q) => q.id),
  )

  // What a reader can work out from what is shown: a total whose parts of a split are all known,
  // and the one part of a split left over when the total and every other part are known.
  let known = new Set<string>()
  function close() {
    known = new Set(shown)
    for (let changed = true; changed;) {
      changed = false
      for (const q of quantities)
        for (const split of q.parts) {
          if (!split.length) continue
          const unknown = split.filter((id) => !known.has(id))
          if (!unknown.length && !known.has(q.id)) {
            known.add(q.id)
            changed = true
          } else if (unknown.length === 1 && known.has(q.id)) {
            known.add(unknown[0]!)
            changed = true
          }
        }
    }
    memo.clear()
  }

  // What a reader can add up for a count: its value when it is known, else the most its known
  // parts add up to. Kept until a count under it changes.
  // A small count worked out but not shown is a leak mended on its own: here it counts as unknown.
  const memo = new Map<string, number>()
  const counts = (id: string) => shown.has(id) || (known.has(id) && fine(quantity(id).value))
  function covered(id: string): number {
    const seen = memo.get(id)
    if (seen !== undefined) return seen
    const q = quantity(id)
    let result = q.value
    if (!counts(id)) {
      result = 0
      for (const split of q.parts)
        if (split.length)
          result = Math.max(
            result,
            split.reduce((n, p) => n + covered(p), 0),
          )
    }
    memo.set(id, result)
    return result
  }
  /** Forgets what was added up for a count and every count over it. */
  function forget(id: string) {
    const stack = [id]
    const seen = new Set<string>()
    while (stack.length) {
      const at = stack.pop()!
      if (seen.has(at)) continue
      seen.add(at)
      memo.delete(at)
      stack.push(...(parents.get(at) ?? []))
    }
  }
  const coveredBy = (split: readonly string[]) => split.reduce((n, id) => n + covered(id), 0)
  const hide = (id: string) => {
    shown.delete(id)
    close()
    return true
  }

  /** Every count under a split. */
  function under(split: readonly string[]): Quantity[] {
    const out: Quantity[] = []
    const seen = new Set<string>()
    const stack = [...split]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const q = quantity(id)
      out.push(q)
      for (const s of q.parts) stack.push(...s)
    }
    return out
  }
  const isLeaf = (q: Quantity) => !q.parts.some((s) => s.length)
  const order = (a: Quantity, b: Quantity) => a.value - b.value || (a.id < b.id ? -1 : 1)

  /** Whether a count could be worked out again if it were hidden: from its parts, or its total. */
  function derivable(q: Quantity): boolean {
    if (q.parts.some((split) => split.length && split.every(counts))) return true
    return (parents.get(q.id) ?? []).some(
      (p) =>
        counts(p) &&
        quantity(p).parts.some(
          (split) => split.includes(q.id) && split.every((id) => id === q.id || counts(id)),
        ),
    )
  }

  /**
   * Hides the smallest count under a split whose hiding opens the gap. With `any`, a protected count
   * may go too, and when no single count opens it, the smallest with everything shown under it.
   */
  function hideUnder(split: readonly string[], any: boolean): boolean {
    const before = coveredBy(split)
    const candidates = under(split)
      .filter((q) => shown.has(q.id) && q.value > 0 && !q.anchor && (any || !q.protect))
      .sort(order)
    // First a count hidden on its own: nothing beside or under it gives it back.
    for (const q of candidates) {
      if (derivable(q)) continue
      // A trial: what the split adds up to without it, as far as the parts under it say.
      shown.delete(q.id)
      known.delete(q.id)
      forget(q.id)
      const opens = coveredBy(split) < before
      shown.add(q.id)
      known.add(q.id)
      forget(q.id)
      if (opens) return hide(q.id)
    }
    // Then, at any cost, one that something would give back: hidden with what gives it back.
    for (const q of any ? candidates : []) {
      if (!derivable(q)) continue
      const was = new Set(shown)
      hide(q.id)
      for (let tries = 0; tries < 3 && counts(q.id); tries++) if (!unravel(q)) break
      if (!counts(q.id) && coveredBy(split) < before) return true
      for (const id of was) shown.add(id)
      close()
    }
    const [first] = candidates
    if (!first || !any) return false
    for (const q of [first, ...under(first.parts.flat())]) if (!q.anchor) shown.delete(q.id)
    close()
    return true
  }

  /**
   * The smallest shown count of a list that may be hidden: one that nothing would give back first,
   * then protected ones last.
   */
  const smallest = (ids: readonly string[]) =>
    [...new Set(ids)]
      .map(quantity)
      .filter((p) => shown.has(p.id) && p.value > 0 && !p.anchor)
      .map((p) => ({ p, back: derivable(p) }))
      .sort(
        (a, b) =>
          Number(a.back) - Number(b.back) ||
          Number(!!a.p.protect) - Number(!!b.p.protect) ||
          order(a.p, b.p),
      )[0]?.p

  /**
   * Breaks how a hidden count was worked out: from every part of one of its own splits (the
   * smallest of them goes), or from a total and every other part of a split (the total goes,
   * unless it is worth keeping; a total that was worked out itself is broken first; then the
   * smallest other part that nothing would give back, else the total after all).
   */
  function unravel(q: Quantity, seen = new Set<string>()): boolean {
    if (seen.has(q.id)) return false
    seen.add(q.id)
    const workedOut = (ids: readonly string[]) =>
      ids
        .map(quantity)
        .filter((x) => known.has(x.id) && !shown.has(x.id) && x.value > 0)
        .sort(order)
    for (const split of q.parts) {
      if (!split.length || !split.every(counts)) continue
      const part = smallest(split)
      if (part) return hide(part.id)
      for (const o of workedOut(split)) if (unravel(o, seen)) return true
    }
    for (const p of (parents.get(q.id) ?? []).map(quantity)) {
      if (!counts(p.id)) continue
      for (const [index, split] of p.parts.entries()) {
        if (!split.includes(q.id) || split.some((id) => id !== q.id && !counts(id))) continue
        const others = split.filter((id) => id !== q.id)
        if (shown.has(p.id) && !p.anchor && !p.keep?.includes(index)) return hide(p.id)
        // A total that was worked out itself: stop that first, before a part that shows goes.
        if (!shown.has(p.id) && unravel(p, seen)) return true
        const other = smallest(others)
        if (other && !derivable(other)) return hide(other.id)
        // Every part beside it would come back: the total goes after all, worth keeping or not.
        if (shown.has(p.id) && !p.anchor) return hide(p.id)
        if (other) return hide(other.id)
        // A part of 0 given away the rest: hiding it leaves two that could be anything.
        const zero = others.map(quantity).find((x) => shown.has(x.id) && !x.anchor)
        if (zero && !shown.has(q.id)) return hide(zero.id)
        for (const o of workedOut(others)) if (unravel(o, seen)) return true
      }
    }
    return false
  }

  /** Mends a count that gives a hidden one away; false when it is safe, or nothing more can be done. */
  function mend(q: Quantity, workedOut: boolean): boolean {
    if (!known.has(q.id)) return false
    // A count under the minimum that is not shown, but can be worked out from what is.
    if (!shown.has(q.id) && !fine(q.value)) return workedOut && unravel(q)
    for (const [index, split] of q.parts.entries()) {
      if (!split.length) continue
      const left = q.value - coveredBy(split)
      if (left === 0 || left >= minimum) continue
      if (!shown.has(q.id)) {
        // Worked out, not shown, and it would give a hidden part away: stop it being worked out.
        if (workedOut && unravel(q)) return true
        continue
      }
      if (q.anchor) {
        if (hideUnder(split, false)) return true
        // A count under it that was worked out: stop that before hiding a protected one.
        const workedOut = under(split)
          .filter((x) => known.has(x.id) && !shown.has(x.id) && x.value > 0)
          .sort(order)
        for (const x of workedOut) if (unravel(x)) return true
        // A protected count goes only when nothing else closes the gap.
        if (hideUnder(split, true)) return true
        // Nothing finer is left to hide: keep two of its finest counts hidden.
        const finest = under(split).filter(isLeaf)
        if (finest.filter((l) => !known.has(l.id)).length >= 2) continue
        const zero = finest.filter((l) => shown.has(l.id)).sort(order)[0]
        if (zero) return hide(zero.id)
        continue
      }
      // A protected total (what found nothing) may hide protected counts under it to stay.
      if (
        q.keep?.includes(index) &&
        (hideUnder(split, false) || (q.protect && hideUnder(split, true)))
      )
        return true
      return hide(q.id)
    }
    return false
  }

  // Finest first, then again until nothing changes: hiding a count may leave another one that was
  // worked out from it unsafe, so every count is mended until all are safe.
  const depth = new Map<string, number>()
  const depthOf = (id: string): number => {
    const seen = depth.get(id)
    if (seen !== undefined) return seen
    const q = quantity(id)
    const d = isLeaf(q) ? 0 : 1 + Math.max(...q.parts.flat().map(depthOf))
    depth.set(id, d)
    return d
  }
  const ordered = [...quantities].sort(
    (a, b) => depthOf(a.id) - depthOf(b.id) || (a.id < b.id ? -1 : 1),
  )
  close()
  // First every total over its parts, then what can still be worked out from them: a count hidden
  // for a total often breaks a way of working another one out, which then costs nothing more.
  for (const workedOut of [false, true])
    for (let changed = true; changed;) {
      changed = false
      for (const q of ordered) while (mend(q, workedOut)) changed = true
    }
  return shown
}

/* ---------- topics ---------- */

/** A topic's counts for a view: one exact scope (domain, metrics, values, month). */
export type TopicCounts = {
  id: string
  /** The domain it is about, or null for none. */
  domain: string | null
  /** Its scope without the month: the months of one subject read as one row. */
  subject: string
  counts: StateCounts
  /** The same topic over every agent, when the view narrows to one. */
  whole?: StateCounts
}

export type ShownTopic = { id: string; total: Shown; counts: ShownCounts }
export type ShownGroup = {
  key: string
  domain: string | null
  topics: string[]
  /** What it adds up to, or null when that would give a hidden count away. */
  total: Shown
  /** What its shown topics add up to: "13+" when the total is hidden. */
  atLeast: number
  counts: ShownCounts
}
export type ShownDomain = { domain: string | null; total: Shown; atLeast: number }

/** A bar of a chart: a day, or a week of a longer range, by answer state. */
export type Bar = { start: string; days: number; counts: StateCounts; whole?: StateCounts }

/** The numbers Overview leads with and the chart under them, for every domain or one. */
export type Chart = { bars: readonly Bar[]; domain?: string | null }

export type TopicView = {
  topics: (ShownTopic & { atLeast: number })[]
  /** Each subject: its topics, the months of one scope, joined. */
  subjects: ShownGroup[]
  domains: ShownDomain[]
  /** With a chart: everything it counts, by answer state, and each bar. */
  asked: Shown
  counts: ShownCounts
  bars: { start: string; days: number; counts: ShownCounts }[]
}

/**
 * What a reader may see of a view's topics and its chart (FR-614), in one pass, so no count shown
 * on one can be subtracted from another: each topic and its answer states, each subject over its
 * months, each domain, and with a chart, what it counts (everything, or one domain) by answer
 * state and each bar. Everything asked is always counted (Overview leads with it), and what found
 * nothing is kept before anything finer, so the share that found something can be read; the
 * counts under them are hidden as far as needed to keep a hidden one from being worked out. A
 * topic keeps its total before its answer states, a domain its total before its topics, and an
 * answer state its total before a bar's; a subject's total is hidden before its months ("13+"). A
 * topic asked fewer than the minimum shows no count at all. For a view of one kind of agent,
 * `whole` is the same count over every agent: what the filter leaves out may not be a hidden
 * count either.
 */
export function topicView(rows: readonly TopicCounts[], minimum: number, chart?: Chart): TopicView {
  const domains = [...new Set(rows.map((r) => r.domain))]
  const subjects = new Map<string, TopicCounts[]>()
  for (const r of rows) subjects.set(r.subject, [...(subjects.get(r.subject) ?? []), r])
  const quantities: Quantity[] = []
  const add = (q: Quantity) => quantities.push(q)
  const domainKey = (d: string | null) => `d:${d ?? ''}`
  // A subject asked about one month is that topic.
  const subjectId = (key: string, s?: ShownState) => {
    const list = subjects.get(key)!
    const base = list.length === 1 ? `t:${list[0]!.id}` : `s:${key}`
    return s ? `${base}:${s}` : base
  }
  const whole = (r: TopicCounts, s?: ShownState) =>
    r.whole ? (s ? r.whole[s] : sumCounts(r.whole)) : undefined
  const sum = (list: readonly TopicCounts[], s?: ShownState) =>
    list.reduce((n, r) => n + (s ? r.counts[s] : sumCounts(r.counts)), 0)
  const sumWhole = (list: readonly TopicCounts[], s?: ShownState) =>
    list.every((r) => r.whole) ? list.reduce((n, r) => n + whole(r, s)!, 0) : undefined

  // A topic alone in its subject shows how it was answered; a month of a subject over several
  // shows its total only, and its subject how it was answered, so no month's answer states can
  // be subtracted from its subject's.
  const alone = (r: TopicCounts) => subjects.get(r.subject)!.length === 1
  for (const r of rows) {
    add({
      id: `t:${r.id}`,
      value: sumCounts(r.counts),
      whole: whole(r),
      keep: [0],
      parts: alone(r) ? [shownStates.map((s) => `t:${r.id}:${s}`)] : [],
    })
    if (alone(r))
      for (const s of shownStates)
        add({
          id: `t:${r.id}:${s}`,
          value: r.counts[s],
          whole: whole(r, s),
          protect: s === 'missing',
          parts: [],
        })
  }
  for (const [key, list] of subjects) {
    if (list.length === 1) continue
    add({
      id: `s:${key}`,
      value: sum(list),
      whole: sumWhole(list),
      keep: [1],
      parts: [list.map((r) => `t:${r.id}`), shownStates.map((s) => `s:${key}:${s}`)],
    })
    for (const s of shownStates)
      add({
        id: `s:${key}:${s}`,
        value: sum(list, s),
        whole: sumWhole(list, s),
        protect: s === 'missing',
        parts: [],
      })
  }
  const subjectsOf = (d: string | null) =>
    [...subjects.entries()].filter(([, list]) => list[0]!.domain === d).map(([k]) => k)
  for (const d of domains) {
    const mine = rows.filter((r) => r.domain === d)
    add({
      id: domainKey(d),
      value: sum(mine),
      whole: sumWhole(mine),
      keep: [0],
      parts: [subjectsOf(d).map((k) => subjectId(k))],
    })
  }
  // What the chart counts: every domain, or one. Its answer states split by bar, and by the
  // subjects under it; everything asked splits by state, and by domain or subject.
  const scoped = chart && chart.domain !== undefined
  const inScope = scoped ? rows.filter((r) => r.domain === chart.domain) : rows
  const scopeSubjects = [...subjects.keys()].filter(
    (k) => !scoped || subjects.get(k)![0]!.domain === chart.domain,
  )
  const bars = chart?.bars ?? []
  const barWhole = (s: ShownState) =>
    bars.length && bars.every((b) => b.whole)
      ? bars.reduce((n, b) => n + b.whole![s], 0)
      : undefined
  const head = scoped ? domainKey(chart.domain!) : 'all'
  if (!scoped)
    add({
      id: 'all',
      value: sum(rows),
      whole: sumWhole(rows),
      anchor: true,
      parts: [domains.map(domainKey), ...(chart ? [shownStates.map((s) => `h:${s}`)] : [])],
    })
  else {
    const index = quantities.findIndex((q) => q.id === head)
    if (index >= 0)
      quantities[index] = {
        ...quantities[index]!,
        anchor: true,
        parts: [...quantities[index]!.parts, shownStates.map((s) => `h:${s}`)],
      }
    else add({ id: head, value: 0, anchor: true, parts: [shownStates.map((s) => `h:${s}`)] })
  }
  for (const s of shownStates) {
    const bySubject = scopeSubjects.map((k) => subjectId(k, s))
    if (!chart) {
      // Without a chart only what found nothing is counted over everything.
      if (s === 'missing')
        add({ id: 'h:missing', value: sum(rows, s), anchor: true, parts: [bySubject] })
      continue
    }
    add({
      id: `h:${s}`,
      value: sum(inScope, s),
      whole: sumWhole(inScope, s) ?? barWhole(s),
      // What found nothing is Overview's own number: finer counts are hidden to keep it, and it
      // goes only when everything asked less what found nothing would be a hidden count. The other
      // states are only what the bars add up to, never shown as a number of their own.
      ...(s === 'missing' ? { keep: [0, 1], protect: true } : { unpublished: true }),
      parts: [bars.map((_, i) => `b:${i}:${s}`), bySubject],
    })
    bars.forEach((b, i) =>
      add({ id: `b:${i}:${s}`, value: b.counts[s], whole: b.whole?.[s], parts: [] }),
    )
  }

  const shown = disclose(quantities, minimum)
  const value = (id: string, v: number): Shown => (shown.has(id) ? v : null)
  const cellsOf = (id: string, counts: StateCounts) => {
    const out = {} as ShownCounts
    for (const s of shownStates) out[s] = value(`${id}:${s}`, counts[s])
    return out
  }
  /** What the shown counts of a total add up to: its value, else the most its shown parts say. */
  const leastOf = (total: Shown, counts: ShownCounts) =>
    total ?? shownStates.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const none = (): ShownCounts => ({
    grounded: null,
    partial: null,
    conflict: null,
    stale: null,
    missing: null,
  })
  const topics = rows.map((r): ShownTopic & { atLeast: number } => {
    const total = value(`t:${r.id}`, sumCounts(r.counts))
    const counts = alone(r) ? cellsOf(`t:${r.id}`, r.counts) : none()
    return { id: r.id, total, counts, atLeast: leastOf(total, counts) }
  })
  const byId = new Map(topics.map((t) => [t.id, t]))
  const atLeast = (list: readonly TopicCounts[]) =>
    list.reduce((n, r) => n + byId.get(r.id)!.atLeast, 0)
  return {
    topics,
    subjects: [...subjects.entries()].map(([key, list]): ShownGroup => {
      if (list.length === 1) {
        const { id, total, counts, atLeast } = byId.get(list[0]!.id)!
        return { key, domain: list[0]!.domain, topics: [id], total, counts, atLeast }
      }
      const total = value(`s:${key}`, sum(list))
      const counts = cellsOf(
        `s:${key}`,
        (() => {
          const c = zeroCounts()
          for (const s of shownStates) c[s] = sum(list, s)
          return c
        })(),
      )
      return {
        key,
        domain: list[0]!.domain,
        topics: list.map((r) => r.id),
        total,
        atLeast: Math.max(atLeast(list), leastOf(total, counts)),
        counts,
      }
    }),
    domains: domains.map((d): ShownDomain => {
      const mine = rows.filter((r) => r.domain === d)
      return { domain: d, total: value(domainKey(d), sum(mine)), atLeast: atLeast(mine) }
    }),
    asked: chart ? value(head, sum(inScope)) : null,
    counts: cellsOf(
      'h',
      (() => {
        const c = zeroCounts()
        for (const st of shownStates) c[st] = sum(inScope, st)
        return c
      })(),
    ),
    bars: bars.map((b, i) => ({
      start: b.start,
      days: b.days,
      counts: cellsOf(`b:${i}`, b.counts),
    })),
  }
}

/**
 * How a topic was answered, as far as a reader can see: each answer state that shows as more than 0
 * or is hidden, on a subject whose count shows at all. A hidden count says no more than that.
 */
export const answersOf = (s: {
  total: number | null
  atLeast: number
  counts: Record<ShownState, number | null>
}) => (s.total === null && s.atLeast === 0 ? [] : shownStates.filter((k) => s.counts[k] !== 0))

/**
 * What was asked in the range before (Overview's comparison): everything, and what found nothing,
 * kept only when what found something is not a hidden count. For a view of one kind of agent,
 * `whole` is the same over every agent.
 */
export function beforeView(counts: StateCounts, minimum: number, whole?: StateCounts) {
  const fine = (n: number) => n === 0 || n >= minimum
  const asked = sumCounts(counts)
  const found = asked - counts.missing
  const all = whole && sumCounts(whole)
  const askedShown = fine(asked) && (all === undefined || fine(all - asked))
  const missingShown =
    fine(counts.missing) &&
    fine(found) &&
    (whole === undefined ||
      (fine(whole.missing - counts.missing) && fine(all! - whole.missing - found)))
  return { asked: askedShown ? asked : null, missing: missingShown ? counts.missing : null }
}

/**
 * Days into the bars of a range's chart: a bar a day for 7 and 30 days, a week a bar for 90,
 * counted back from the last day, so the oldest week may be a few days short.
 */
export function barsOf<T extends { day: string; counts: StateCounts }>(
  days: readonly T[],
  range: number,
): { start: string; days: number; counts: StateCounts }[] {
  if (range !== 90) return days.map((d) => ({ start: d.day, days: 1, counts: { ...d.counts } }))
  const out: { start: string; days: number; counts: StateCounts }[] = []
  for (let end = days.length; end > 0; end -= 7) {
    const week = days.slice(Math.max(0, end - 7), end)
    const counts = zeroCounts()
    for (const d of week) for (const s of shownStates) counts[s] += d.counts[s]
    out.unshift({ start: week[0]!.day, days: week.length, counts })
  }
  return out
}

/**
 * A count over several kinds of agent or tool (FR-410): each one hidden from one to just under
 * the minimum. The total is shown only when it gives none of them away, unless it is `known`
 * anyway (Usage's tool calls add up to it): then more parts are hidden instead, so what the hidden
 * ones add up to is never a small count.
 */
export function shownParts(
  values: readonly number[],
  minimum: number,
  { known = false }: { known?: boolean } = {},
) {
  const parts = values.map((v, i) => ({ id: `p:${i}`, value: v, parts: [] as string[][] }))
  const total = values.reduce((a, b) => a + b, 0)
  const shown = disclose(
    [...parts, { id: 'all', value: total, anchor: known, parts: [parts.map((p) => p.id)] }],
    minimum,
  )
  return {
    parts: values.map((v, i): Shown => (shown.has(`p:${i}`) ? v : null)),
    total: shown.has('all') ? total : null,
  }
}
