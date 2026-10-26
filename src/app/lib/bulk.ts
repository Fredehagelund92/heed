import type { Definition } from '@/lib/definitions'
import { kindLabel, type DomainId, type Fact, type Kind } from '@/model/items'
import { ownersOf, type Domains } from '@/model/people'

// What a change to many rows does, row by row, before anything happens: which rows it acts on, and
// which it leaves alone and why ("2 skipped: owned by Marketing"). Owners of an item's domain and
// admins change it. A draft (never published) can be deleted; a published item is archived, never
// deleted, so its history stays and agents simply stop getting it.

export type Me = { name: string; admin: boolean }

/** A row left alone: `why` in a few words for the line, `reason` in a sentence for its tooltip. */
export type Skip = { id: string; title: string; why: string; reason: string }
export type Plan<T> = { act: T[]; skipped: Skip[] }

export type FactAction =
  'archive' | 'delete' | 'domain' | 'kind' | 'owner-add' | 'owner-set' | 'check'

/** Owners of the item's domain and admins change an item. */
export const canChange = (f: Pick<Fact, 'domain'>, me: Me, domains: Domains) =>
  me.admin || !!domains[f.domain]?.owners.includes(me.name)

/** The domains someone can move items into: their own, or every one for an admin. */
export const movableTo = (me: Me, domains: Domains) =>
  Object.keys(domains).filter((d) => me.admin || domains[d]?.owners.includes(me.name))

const owned = (d: DomainId, domains: Domains) => ({
  why: `owned by ${domains[d]?.name}`,
  reason: `Only owners of ${domains[d]?.name} and admins can change it.`,
})

export function planFacts(
  action: FactAction,
  facts: Fact[],
  me: Me,
  domains: Domains,
  opts: { viewed?: Record<string, boolean>; domain?: DomainId; kind?: Kind; person?: Me } = {},
): Plan<Fact> {
  const act: Fact[] = []
  const skipped: Skip[] = []
  const skip = (f: Fact, s: { why: string; reason: string }) =>
    skipped.push({ id: f.id, title: f.title, ...s })
  for (const f of facts) {
    if (!canChange(f, me, domains)) {
      skip(f, owned(f.domain, domains))
      continue
    }
    const why = whyNot(action, f, domains, opts)
    if (why) skip(f, why)
    else act.push(f)
  }
  return { act, skipped }
}

function whyNot(
  action: FactAction,
  f: Fact,
  domains: Domains,
  opts: { viewed?: Record<string, boolean>; domain?: DomainId; kind?: Kind; person?: Me },
) {
  switch (action) {
    case 'archive':
      if (f.status === 'Archived')
        return { why: 'already archived', reason: 'It is archived already.' }
      if (f.status === 'Draft')
        return {
          why: 'a draft',
          reason: 'A draft was never published, so it is deleted, not archived.',
        }
      return
    case 'delete':
      if (f.status !== 'Draft')
        return { why: 'published', reason: 'Published items are archived, not deleted.' }
      return
    case 'domain':
      if (opts.domain && f.domain === opts.domain)
        return {
          why: `already in ${domains[opts.domain]?.name}`,
          reason: `It is in ${domains[opts.domain]?.name} already.`,
        }
      return
    case 'kind':
      if (opts.kind && f.kind === opts.kind)
        return {
          why: `already a ${kindLabel[opts.kind]}`,
          reason: `It is a ${kindLabel[opts.kind]} already.`,
        }
      return
    case 'owner-add':
    case 'owner-set': {
      const p = opts.person
      if (!p) return
      // An owner answers for an item, so they must be able to change it.
      if (!canChange(f, p, domains))
        return {
          why: `${p.name} doesn't own ${domains[f.domain]?.name}`,
          reason: `Only owners of ${domains[f.domain]?.name} and admins can own its items.`,
        }
      if (action === 'owner-add' && ownersOf(f, domains).includes(p.name))
        return { why: 'already an owner', reason: `${p.name} owns it already.` }
      if (action === 'owner-set' && ownersOf(f, domains).join() === p.name)
        return { why: 'already the owner', reason: `${p.name} is its only owner already.` }
      return
    }
    case 'check':
      if (f.status === 'Draft')
        return { why: 'a draft', reason: 'A draft is checked when it is published.' }
      if (f.status === 'Archived')
        return { why: 'archived', reason: "Agents don't get it, so there is nothing to check." }
      // As with publishing together: only what was opened counts as read.
      if (!opts.viewed?.[f.id])
        return { why: 'not opened yet', reason: 'Open it first: checking it means reading it.' }
      return
  }
}

/* ---------- terms ---------- */

/** A term is changed by an admin, an owner of its domain, or the person who wrote it. */
export const canChangeTerm = (d: Pick<Definition, 'domain' | 'by'>, me: Me, domains: Domains) =>
  me.admin || (!!d.domain && !!domains[d.domain]?.owners.includes(me.name)) || d.by === me.name

/** Only terms change here: a synced metric or dimension is left alone, with the tool that owns it. */
export function planTerms(
  action: 'delete' | 'domain',
  defs: Definition[],
  me: Me,
  domains: Domains,
  opts: { tool: string; domain?: DomainId },
): Plan<Definition> {
  const act: Definition[] = []
  const skipped: Skip[] = []
  for (const d of defs) {
    const skip = (why: string, reason: string) =>
      skipped.push({ id: d.name, title: d.name, why, reason })
    if (d.synced)
      skip(
        `synced from ${opts.tool}`,
        `Metrics and dimensions are read-only here: change them in ${opts.tool}.`,
      )
    else if (!canChangeTerm(d, me, domains))
      skip(
        d.domain ? `owned by ${domains[d.domain]?.name}` : 'written by someone else',
        d.domain
          ? `Only owners of ${domains[d.domain]?.name} and admins can change it.`
          : `Only ${d.by} and admins can change it.`,
      )
    else if (action === 'domain' && opts.domain && d.domain === opts.domain)
      skip(
        `already in ${domains[opts.domain]?.name}`,
        `It is in ${domains[opts.domain]?.name} already.`,
      )
    else act.push(d)
  }
  return { act, skipped }
}

/* ---------- what the bar and the toasts say ---------- */

/** "2 skipped: owned by Marketing", or with several reasons "3 skipped: 2 owned by Marketing, 1 published". */
export function skippedLine(skipped: Skip[]) {
  if (!skipped.length) return ''
  const groups = new Map<string, number>()
  for (const s of skipped) groups.set(s.why, (groups.get(s.why) ?? 0) + 1)
  if (groups.size === 1) return `${skipped.length} skipped: ${skipped[0]!.why}`
  return `${skipped.length} skipped: ${[...groups].map(([why, n]) => `${n} ${why}`).join(', ')}`
}

/** "4 archived", or after a failure "3 of 4 archived, 1 failed". */
export function doneLine(verb: string, done: number, failed: number) {
  return failed ? `${done} of ${done + failed} ${verb}, ${failed} failed` : `${done} ${verb}`
}

/** "1 item", "3 items"; "1 draft", "2 drafts". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Deleting more than this many asks for the number to be typed, so a large delete is never one slip. */
export const TYPE_ABOVE = 10
export const needsTyping = (n: number) => n > TYPE_ABOVE

/* ---------- export ---------- */

const line = (label: string, value: string) => (value ? `- ${label}: ${value}\n` : '')

/** The items as Markdown, one section each, the way a person or an agent reads them. */
export function toMarkdown(facts: Fact[], domains: Domains) {
  return (
    `# Context\n\n` +
    facts
      .map(
        (f) =>
          `## ${f.title}\n\n${f.summary}\n\n` +
          line('Domain', domains[f.domain]?.name ?? '') +
          line('Kind', kindLabel[f.kind]) +
          line('Status', f.status) +
          line('Applies to', f.where.join(', ')) +
          line('When', f.when) +
          line('Owners', ownersOf(f, domains).join(', ')) +
          line('Checked', f.checkedBy && `${f.checkedBy}, ${f.checkedOn}`) +
          line('Source', f.source) +
          line("Don't conclude", f.dontConclude),
      )
      .join('\n')
  )
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** The items as a spreadsheet: one row each. */
export function toCsv(facts: Fact[], domains: Domains) {
  const head = [
    'Title',
    'Domain',
    'Kind',
    'Status',
    'Applies to',
    'When',
    'Owners',
    'Checked by',
    'Checked on',
    'Source',
    'What agents should know',
  ]
  const rows = facts.map((f) => [
    f.title,
    domains[f.domain]?.name ?? '',
    kindLabel[f.kind],
    f.status,
    f.where.join(', '),
    f.when,
    ownersOf(f, domains).join(', '),
    f.checkedBy,
    f.checkedOn,
    f.source,
    f.summary,
  ])
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'
}

/** Saves text as a file the browser downloads. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
