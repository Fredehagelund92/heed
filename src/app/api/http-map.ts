/**
 * The http binding's reading of the service's answers into the shapes the screens read: the
 * library index into context items, the catalogue and the terms into definitions, a refused word
 * into the synonym box's reason, search everywhere into its groups, and the threads into comments. Pure, so the rules are tested without a service.
 */
import type { JSONContent } from '@tiptap/core'
import type {
  CatalogueTerm,
  LibraryItem,
  SearchResults,
  Term,
  TermRefusalData,
  Thread,
  ThreadComment,
} from '@contract/index'
import type {
  CommentItem,
  CommentReaction,
  CommentReply,
} from '@/components/templates/comment-box/types'
import type { Definition, SynonymCheck } from '@/lib/definitions'
import type { Comments, Subject } from '@/model/comments'
import type { Fact, Kind, Status } from '@/model/items'
import { shiftDate } from '@domain/validity'
import { dateLabel, whenLabel, type Validity } from '@/model/validity'
import type { SearchHits } from './client'

/** Who the answers name by id: people and the owners of each domain. */
export type Names = {
  person: (id: string) => string
  domainOwners: (areaId: string) => string[]
}

/** The service's `example` kind, which the app does not offer, is left out of its lists. */
const offered = <T extends { kind: string }>(row: T): row is T & { kind: Kind } =>
  row.kind !== 'example'

/** A row's status in the app's words: retired is Archived; accepted is Live, or Needs checking when its trust says so. */
export function statusOf(row: Pick<LibraryItem, 'status' | 'trust'>): Status {
  if (row.status === 'retired') return 'Archived'
  return row.trust === 'needs_check' ? 'Needs checking' : 'Live'
}

/**
 * The service's dates as the app's: its end is the first day the item no longer applies, so the
 * last day it applies is the day before. An open end of an issue that is still going on says so.
 */
export function validityOf(row: Pick<LibraryItem, 'validity' | 'reviewQuestion'>): Validity {
  return {
    from: row.validity.start,
    ...(row.validity.end ? { until: shiftDate(row.validity.end, -1) } : {}),
    ...(row.reviewQuestion === 'still_going_on' ? { ongoing: true } : {}),
  }
}

/**
 * Who answers for an item, by name, when it is not its domain's owners: the owners it has of its
 * own (`owners`, by id), or else its one owner when that is not one of the domain's.
 */
export function ownersOf(
  row: { owners: readonly string[]; ownerId: string; areaId: string },
  names: Names,
): string[] | undefined {
  const domain = names.domainOwners(row.areaId)
  if (row.owners.length) {
    const own = row.owners.map(names.person)
    return own.join() === domain.join() ? undefined : own
  }
  const owner = names.person(row.ownerId)
  return domain.includes(owner) ? undefined : [owner]
}

/**
 * The library index as context items. The index carries no text, source or quote: an item's page
 * reads those. Its owners show only when they are not its domain's.
 */
export function factsOf(rows: readonly LibraryItem[], names: Names): Fact[] {
  return rows.filter(offered).map((row) => {
    const valid = validityOf(row)
    const owners = ownersOf(row, names)
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      domain: row.areaId,
      kind: row.kind,
      where: row.chips,
      valid,
      when: whenLabel(valid),
      status: statusOf(row),
      checkedBy: row.lastChecked ? names.person(row.lastChecked.personId) : '',
      checkedOn: row.lastChecked ? dateLabel(row.lastChecked.on) : '',
      source: '',
      quote: '',
      dontConclude: '',
      ...(owners ? { owners } : {}),
    }
  })
}

/** The catalogue's metrics and dimensions as definitions: synced from the source, read-only here. */
export function definitionsOf(terms: readonly CatalogueTerm[]): Definition[] {
  return terms.map((term) => ({
    name: term.name,
    type: term.kind,
    definition: term.definition?.descriptionCopy ?? '',
    synced: true,
    ...(term.definition ? { tool: term.definition.tool } : {}),
    sourceNames: [...new Set(term.aliases)],
    ...(term.domain.areaId ? { domain: term.domain.areaId } : {}),
    ...(term.group ? { group: term.group.name } : {}),
    ...(term.definition?.changedAt
      ? { changed: dateLabel(term.definition.changedAt.slice(0, 10)) }
      : {}),
    updated: term.shelf.lastUpdated ? dateLabel(term.shelf.lastUpdated.slice(0, 10)) : '',
  }))
}

/**
 * The terms and synonyms written here as definitions, in the order they were written, so a
 * definition's other names read as they were added: a synonym names what it means.
 */
export function termDefinitionsOf(
  terms: readonly Term[],
  person: (id: string) => string,
): Definition[] {
  const written = [...terms].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name),
  )
  return written.map((term) => ({
    name: term.name,
    type: 'term',
    definition: term.meaning ?? '',
    ...(term.sameAs ? { sameAs: term.sameAs.name } : {}),
    synced: false,
    sourceNames: [],
    ...(term.areaId ? { domain: term.areaId } : {}),
    by: person(term.createdBy),
    updated: dateLabel(term.updatedAt.slice(0, 10)),
  }))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * A word the service refused because it already means something, as the synonym box says it: what
 * it means and who gave it that meaning. Null for any other failure.
 */
export function refusalOf(error: unknown): Exclude<SynonymCheck, { ok: true }> | null {
  if (!isRecord(error) || error.status !== 409 || !isRecord(error.data)) return null
  const refusal = error.data.refusal as TermRefusalData | undefined
  if (!isRecord(refusal) || typeof error.message !== 'string') return null
  return {
    ok: false,
    why: refusal.code,
    reason: error.message,
    holder: refusal.holder,
    ...(refusal.by ? { by: refusal.by } : {}),
  }
}

/** Search everywhere's groups in the app's words. */
export function hitsOf(results: SearchResults): SearchHits {
  return {
    items: results.items
      .filter(offered)
      .map((row) => ({ id: row.id, title: row.title, kind: row.kind, domain: row.areaId })),
    definitions: results.definitions.map((d) => ({
      name: d.name,
      type: d.kind,
      sourceNames: [...new Set(d.aliases)],
    })),
    domains: results.domains,
    people: results.people.map((p) => ({ name: p.name })),
  }
}

/* ---------- comments ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A comment's time as the Inbox writes times, in the reader's own time zone: "Just now",
 * "Today, 09:40", "Yesterday, 14:20", "21 Oct", and the year when it is another year's.
 */
export function commentWhen(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  if (now.getTime() - at.getTime() < 60_000) return 'Just now'
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  const date = `${at.getDate()} ${MONTHS[at.getMonth()]}`
  return at.getFullYear() === now.getFullYear() ? date : `${date} ${at.getFullYear()}`
}

/** Who the comments name: a person's name by id, and an id by name, for the mentions. */
export type People = { name: (id: string) => string; idOf: (name: string) => string | undefined }

/** Maps every mention of a person in a comment, leaving the rest as it is. */
function mapMentions(node: JSONContent, f: (mention: JSONContent) => JSONContent): JSONContent {
  if (node.type === 'mention') return f(node)
  return node.content ? { ...node, content: node.content.map((c) => mapMentions(c, f)) } : node
}

/**
 * A comment as the service keeps it: a mention names its person by id. A mention of a name the
 * workspace doesn't know stays the words the author saw.
 */
export function bodyToService(content: JSONContent, people: People): Record<string, unknown> {
  return mapMentions(content, (m) => {
    const id = String(m.attrs?.id ?? '')
    const label = String(m.attrs?.label ?? '')
    const person = id.startsWith('person:') ? people.idOf(id.slice('person:'.length)) : undefined
    return person
      ? { type: 'mention', attrs: { id: `person:${person}`, label } }
      : { type: 'text', text: `@${label}` }
  })
}

/** A comment as the app reads it: a mention of a person by their name, as it is now. */
export function bodyFromService(body: Record<string, unknown>, people: People): JSONContent {
  return mapMentions(body, (m) => {
    const id = String(m.attrs?.id ?? '')
    const name = id.startsWith('person:') ? people.name(id.slice('person:'.length)) : ''
    const label = name || String(m.attrs?.label ?? '')
    return { type: 'mention', attrs: { id: `person:${label}`, label } }
  })
}

const reactionsOf = (list: Thread['reactions'], people: People): CommentReaction[] =>
  list.map((r) => ({ emoji: r.emoji, by: r.by.map((p) => p.name ?? people.name(p.personId)) }))

function commentOf(c: Omit<ThreadComment, 'replies'>, people: People, now: Date): CommentReply {
  return {
    id: c.id,
    author: c.author.name ?? people.name(c.author.personId),
    when: commentWhen(c.at, now),
    content: bodyFromService(c.body, people),
    ...(c.reactions.length ? { reactions: reactionsOf(c.reactions, people) } : {}),
    ...(c.editedAt ? { edited: true } : {}),
    ...(c.deleted ? { deleted: true } : {}),
    ...(c.returned ? { returned: true } : {}),
  }
}

/**
 * The service's threads as the app reads comments, for the person signed in (`me`, by name): the
 * new replies are theirs, and so is what they have read of the comments that mention them.
 */
export function commentsOf(
  threads: readonly Thread[],
  people: People,
  me: string,
  now: Date,
): Comments {
  const out: Comments = { threads: {}, reactions: {}, newReplies: {}, mentionSeen: {} }
  for (const t of threads) {
    const subject = t.subject as Subject
    out.threads[subject] = t.comments.map((c): CommentItem => ({
      ...commentOf(c, people, now),
      ...(c.replies.length ? { replies: c.replies.map((r) => commentOf(r, people, now)) } : {}),
    }))
    if (t.reactions.length) out.reactions[subject] = reactionsOf(t.reactions, people)
    if (t.newReply)
      out.newReplies[subject] = {
        from: t.newReply.from.name ?? people.name(t.newReply.from.personId),
        when: commentWhen(t.newReply.at, now),
        excerpt: t.newReply.excerpt,
      }
    if (!t.mentions.length) out.mentionSeen[`${subject}|${me}`] = true
  }
  return out
}
