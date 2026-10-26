import * as React from 'react'
import {
  domainIds,
  domains,
  markets,
  people,
  servedToAgents,
  type Fact,
  type Kind,
} from '@/data/world'
import { useDefinitions, type Definition } from '@/lib/definitions'
import { useFacts } from '@/lib/store'
import { useDomains } from '@/lib/domains'
import { storageKey } from '@/lib/brand'

// What an '@' can point at, kept free of the editor so lists, pages and the Inbox can read
// mentions without loading it. A mention is stored as `kind:key` with the words the author saw
// ("context:itm_norway_stop", "Online sales to Norway stopped..."). In markdown it is the editor's
// own token, [@ id="..." label="..."]. A mention is navigation only: agents read the label as
// plain words and never follow it, and it never changes who can see what.

export type MentionKind =
  'domain' | 'metric' | 'dimension' | 'term' | 'context' | 'market' | 'person'

export type Mentionable = {
  /** `kind:key`, as stored. */
  id: string
  kind: MentionKind
  label: string
  /** The quiet second word in the picker: a domain, a role, a type. */
  hint?: string
  /** A context item's kind, for its icon. */
  contextKind?: Kind
  /** Another name for a definition: a synonym. */
  synonym?: boolean
}

export type MentionRef = { id: string; label: string }

/** The picker's groups, in this order, each with the kinds it holds. */
export const GROUPS: { label: string; kinds: MentionKind[] }[] = [
  { label: 'Domains', kinds: ['domain'] },
  { label: 'Definitions', kinds: ['metric', 'dimension', 'term'] },
  { label: 'Context items', kinds: ['context'] },
  { label: 'Markets', kinds: ['market'] },
  { label: 'People', kinds: ['person'] },
]

/** What each place lets you mention. */
export const SCOPE_KINDS: MentionKind[] = [
  'domain',
  'metric',
  'dimension',
  'term',
  'context',
  'market',
]
export const LINK_KINDS: MentionKind[] = ['domain', 'metric', 'dimension', 'term', 'context']
export const PEOPLE_KINDS: MentionKind[] = ['person']

export const mentionId = (kind: MentionKind, key: string) => `${kind}:${key}`
export function parseMentionId(id: string): { kind: MentionKind; key: string } {
  const i = id.indexOf(':')
  return { kind: id.slice(0, i) as MentionKind, key: id.slice(i + 1) }
}

/* ---------- what there is to mention ---------- */

// `version` is the domains' edit count: a new one means names or texts changed.
function build(facts: Fact[], definitions: Definition[], version = 0): Mentionable[] {
  void version
  return [
    // A domain's row says what it covers, in its owners' words.
    ...domainIds.map((d) => ({
      id: mentionId('domain', d),
      kind: 'domain' as const,
      label: domains[d].name,
      hint: domains[d].covers || 'Domain',
    })),
    ...definitions.map((d) => ({
      id: mentionId(d.type, d.name),
      kind: d.type,
      label: d.name,
      hint: d.sameAs
        ? `Another name for ${d.sameAs}`
        : d.domain
          ? domains[d.domain].name
          : undefined,
      synonym: !!d.sameAs,
    })),
    ...facts.filter(servedToAgents).map((f) => ({
      id: mentionId('context', f.id),
      kind: 'context' as const,
      label: f.title,
      hint: domains[f.domain].name,
      contextKind: f.kind,
    })),
    ...markets.map((m) => ({
      id: mentionId('market', m),
      kind: 'market' as const,
      label: m,
      hint: 'Market',
    })),
    ...people
      .filter((p) => !p.invited)
      .map((p) => ({
        id: mentionId('person', p.name),
        kind: 'person' as const,
        label: p.name,
        hint: p.role,
      })),
  ]
}

/** Everything that can be mentioned right now, edits included. */
export function useMentionables(): Mentionable[] {
  const facts = useFacts()
  const definitions = useDefinitions()
  // A renamed or new domain changes what can be mentioned.
  const domainsVersion = useDomains()
  return React.useMemo(
    () => build(facts, definitions, domainsVersion),
    [facts, definitions, domainsVersion],
  )
}

/** The current target of a mention, or undefined when it was deleted, archived or renamed away. */
export function useMentionTarget(id: string): Mentionable | undefined {
  const all = useMentionables()
  return all.find((m) => m.id === id)
}

/* ---------- recent first ---------- */

const RECENT_KEY = storageKey('mention-recent')
let recent: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
})()

export const recentMentions = () => recent

export function rememberMention(id: string) {
  recent = [id, ...recent.filter((r) => r !== id)].slice(0, 8)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    // Storage can be blocked; recent stays for this visit.
  }
}

/* ---------- search ---------- */

export type MentionGroup = { label: string; items: Mentionable[] }

/** How well a label matches: its start, then a word's start, then anywhere. */
function rank(label: string, q: string) {
  const l = label.toLowerCase()
  if (l.startsWith(q)) return 0
  if (l.split(/[\s-]+/).some((w) => w.startsWith(q))) return 1
  if (l.includes(q)) return 2
  return -1
}

/**
 * The picker's results: recent first while nothing is typed, then each group. Typing filters by
 * the label and keeps the best matches (and the recent ones) at the top of each group. With
 * nothing typed, each group shows its first few; typing shows every match, and the list scrolls.
 */
export function searchMentions(
  all: Mentionable[],
  kinds: MentionKind[],
  query: string,
): MentionGroup[] {
  const q = query.trim().toLowerCase()
  const allowed = all.filter((m) => kinds.includes(m.kind))
  const isRecent = (m: Mentionable) => recent.indexOf(m.id)
  if (!q) {
    const rec = recent
      .map((id) => allowed.find((m) => m.id === id))
      .filter(Boolean)
      .slice(0, 4) as Mentionable[]
    const groups = GROUPS.map((g) => ({
      label: g.label,
      items: allowed.filter((m) => g.kinds.includes(m.kind) && !rec.includes(m)).slice(0, 5),
    }))
    return [{ label: 'Recent', items: rec }, ...groups].filter((g) => g.items.length)
  }
  // Best match first: the start of the label, then recent, then the shorter label ("Norway" before
  // "Norway launch campaign..."). Groups keep their items together, the group with the best match on top.
  const score = (m: Mentionable) => {
    const r = rank(m.label, q)
    if (r < 0) return -1
    const seen = isRecent(m)
    return r * 1000 + (seen >= 0 ? seen : 50) * 10 + Math.min(m.label.length, 99) / 100
  }
  return GROUPS.map((g) => ({
    label: g.label,
    items: allowed
      .filter((m) => g.kinds.includes(m.kind) && score(m) >= 0)
      .sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label)),
  }))
    .filter((g) => g.items.length)
    .sort((a, b) => score(a.items[0]) - score(b.items[0]))
}

/* ---------- mentions in stored text ---------- */

const TOKEN = /\[@ ([^\]]*)\]/g

function attrs(s: string): MentionRef {
  const get = (k: string) => s.match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`))?.[1] ?? ''
  return { id: get('id'), label: get('label') }
}

/** The token the editor writes for a mention. */
export const mentionToken = (m: MentionRef) => `[@ id="${m.id}" label="${m.label}"]`

/** Stored text as runs of words and mentions. */
export function mentionParts(md: string): (string | MentionRef)[] {
  const out: (string | MentionRef)[] = []
  let at = 0
  for (const m of md.matchAll(TOKEN)) {
    if (m.index > at) out.push(md.slice(at, m.index))
    out.push(attrs(m[1]))
    at = m.index + m[0].length
  }
  if (at < md.length) out.push(md.slice(at))
  return out
}

/** Every mention in stored text. */
export const mentionsIn = (md: string | undefined) =>
  md ? mentionParts(md).filter((p): p is MentionRef => typeof p !== 'string') : []

/** The words an agent reads: each mention becomes the label its author saw, nothing more. */
export const plainText = (md: string) => md.replace(TOKEN, (_, a: string) => attrs(a).label)
