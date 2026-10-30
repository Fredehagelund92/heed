import { servedToAgents, type DomainId, type Fact } from '@/model/items'
import type { Domains } from '@/model/people'
import type { Definition } from '@/lib/definitions'
import { mentionId, mentionsIn, parseMentionId, plainText, type MentionKind } from '@/lib/mentions'
import type { AnswerLinks } from '@/model/ask'

// What an agent can follow from a context item, a definition or a domain: get_related, read-only.
// A link is an @ mention written in a text (both ways: links to, and linked from), or one of two
// relations an owner set: replaces, and disagrees with. Following is one step at a time, at most 50
// nodes, and never changes what an answer includes; a retired target is shown, never followed.
// Comments are never part of it. The switch "Let agents follow links" (lib/links-switch.ts) turns
// the tool off.

export type Rel = 'replaces' | 'replaced_by' | 'disagrees' | 'mentions' | 'mentioned_by'

/** One end of a link: the mention id ("context:itm_...", "metric:Orders"), its words, whether it is still there. */
export type LinkEnd = {
  id: string
  kind: MentionKind
  label: string
  retired: boolean
  domain?: DomainId
}
export type Link = { rel: Rel; to: LinkEnd; otherDomain: boolean }

export const DEPTH = 1
export const MAX_NODES = 50
/** The fixed order, so the same question gets the same links: the owner's relations first. */
const ORDER: Rel[] = ['replaces', 'replaced_by', 'disagrees', 'mentions', 'mentioned_by']

export const relLabel: Record<Rel, string> = {
  replaces: 'replaces',
  replaced_by: 'replaced by',
  disagrees: 'disagrees with',
  mentions: 'links to',
  mentioned_by: 'linked from',
}

type World = { facts: Fact[]; definitions: Definition[]; domains: Domains }

/** Where a mention points, as it stands now: its words, its domain, and whether it is retired. */
function end(id: string, label: string, w: World): LinkEnd {
  const { kind, key } = parseMentionId(id)
  if (kind === 'context') {
    const f = w.facts.find((x) => x.id === key)
    return {
      id,
      kind,
      label: f?.title ?? label,
      retired: !f || !servedToAgents(f),
      domain: f?.domain,
    }
  }
  if (kind === 'metric' || kind === 'dimension' || kind === 'term') {
    const d = w.definitions.find((x) => x.name.toLowerCase() === key.toLowerCase())
    return { id, kind, label: d?.name ?? label, retired: !d, domain: d?.domain }
  }
  if (kind === 'domain')
    return {
      id,
      kind,
      label: w.domains[key]?.name ?? label,
      retired: !w.domains[key],
      domain: key,
    }
  return { id, kind, label, retired: false }
}

const subjectDomain = (id: string, w: World): DomainId | undefined => end(id, '', w).domain
const textOf = (id: string, w: World) => {
  const { kind, key } = parseMentionId(id)
  if (kind === 'context') {
    const f = w.facts.find((x) => x.id === key)
    return f ? `${f.summary}\n\n${f.body ?? ''}` : ''
  }
  if (kind === 'term') return w.definitions.find((d) => d.name === key)?.definition ?? ''
  return ''
}

/** Every link of a context item, a definition or a domain, in the fixed order. */
export function linksOf(id: string, w: World): Link[] {
  const home = subjectDomain(id, w)
  const out: { rel: Rel; to: LinkEnd }[] = []
  const { kind, key } = parseMentionId(id)
  // The owners' relations, kept on the items: replaces (and, seen from the old one, replaced by), and disagrees with.
  if (kind === 'context') {
    const self = w.facts.find((f) => f.id === key)
    if (self?.replaces)
      out.push({ rel: 'replaces', to: end(mentionId('context', self.replaces), '', w) })
    for (const f of w.facts)
      if (f.replaces === key)
        out.push({ rel: 'replaced_by', to: end(mentionId('context', f.id), f.title, w) })
    if (self?.disagreesWith)
      out.push({ rel: 'disagrees', to: end(mentionId('context', self.disagreesWith), '', w) })
    for (const f of w.facts)
      if (f.disagreesWith === key && servedToAgents(f))
        out.push({ rel: 'disagrees', to: end(mentionId('context', f.id), f.title, w) })
  }
  for (const m of mentionsIn(textOf(id, w)))
    if (m.id !== id) out.push({ rel: 'mentions', to: end(m.id, m.label, w) })
  const mentionsHere = (text: string) => mentionsIn(text).some((m) => m.id === id)
  for (const f of w.facts)
    if (
      servedToAgents(f) &&
      mentionId('context', f.id) !== id &&
      mentionsHere(`${f.summary}\n\n${f.body ?? ''}`)
    )
      out.push({ rel: 'mentioned_by', to: end(mentionId('context', f.id), f.title, w) })
  for (const d of w.definitions)
    if (d.type === 'term' && mentionId('term', d.name) !== id && mentionsHere(d.definition))
      out.push({ rel: 'mentioned_by', to: end(mentionId('term', d.name), d.name, w) })
  // Each end once, at its first relation in the order.
  const seen = new Set<string>()
  return out
    .sort((a, b) => ORDER.indexOf(a.rel) - ORDER.indexOf(b.rel))
    .filter((l) => (seen.has(l.to.id) ? false : (seen.add(l.to.id), true)))
    .map((l) => ({ ...l, otherDomain: !!home && !!l.to.domain && l.to.domain !== home }))
}

export type Followed = { from: Fact; link: Link }

/**
 * What an agent follows after a look-up: one step from each item it got, to context items and
 * terms it didn't already get (a metric's meaning came with the look-up). A retired target is
 * listed and not followed. At most 50.
 */
export function follow(
  got: Fact[],
  w: World,
  enabled: boolean,
): { followed: Followed[]; notFollowed: Followed[] } {
  if (!enabled) return { followed: [], notFollowed: [] }
  const already = new Set(got.map((f) => mentionId('context', f.id)))
  const followed: Followed[] = []
  const notFollowed: Followed[] = []
  for (const f of got)
    for (const link of linksOf(mentionId('context', f.id), w)) {
      if (link.rel === 'mentioned_by' || link.rel === 'replaced_by' || already.has(link.to.id))
        continue
      if (link.to.kind !== 'context' && link.to.kind !== 'term') continue
      if (link.to.retired) notFollowed.push({ from: f, link })
      else if (followed.length < MAX_NODES) {
        followed.push({ from: f, link })
        already.add(link.to.id)
      }
    }
  return { followed, notFollowed }
}

/** Where a followed link led: the item's summary or the term's meaning, as the agent read it. */
function readAt(link: Link, w: World): string {
  const { kind, key } = parseMentionId(link.to.id)
  if (kind === 'context') return plainText(w.facts.find((x) => x.id === key)?.summary ?? '')
  return plainText(w.definitions.find((d) => d.name === key)?.definition ?? '')
}

/** What get_related follows from the items an answer has, as the answer carries it. */
export function answerLinks(sources: readonly string[], w: World, enabled: boolean): AnswerLinks {
  const got = sources.flatMap((id) => w.facts.find((f) => f.id === id) ?? [])
  const { followed, notFollowed } = follow(got, w, enabled)
  const one = ({ from, link }: Followed) => ({
    from: { id: from.id, title: from.title },
    rel: link.rel as 'replaces' | 'disagrees' | 'mentions',
    to: { id: link.to.id, label: link.to.label },
  })
  return {
    on: enabled,
    followed: followed.map((f) => ({ ...one(f), read: readAt(f.link, w) })),
    notFollowed: notFollowed.map(one),
  }
}
