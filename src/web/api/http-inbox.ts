/**
 * The http binding's reading of the Inbox and the review: the service's Inbox feed into the app's
 * cards, a review sheet into the review the screens draw, and the people and domains into the
 * workspace. Pure, so the rules are tested without a service.
 *
 * The service decides what needs care, whether a suggestion is ready, what counts as read and what
 * agents say before and after; this only says it in the app's shapes and words.
 */
import type { Card, Feed } from '@contract/inbox'
import type { ReviewSheet } from '@contract/review-path'
import type { Area } from '@domain/item'
import type { ClashRelation } from '@domain/clash-relations'
import { alertCardWords, alertRule, lookTitle } from '@domain/alerts'
import { hrefOf } from './http-alerts'
import { answerText, savedWhy } from '@domain/saved-check'
import { shiftDate } from '@domain/validity'
import type { Inbox, Workspace } from './client'
import { mentionIdOf, type Words } from './http-context'
import { commentWhen } from './http-map'
import type { Subject } from '@/model/comments'
import type { InboxCard, Outcome, Waiting } from '@/model/inbox'
import { kindLabel, type Fact, type Kind } from '@/model/items'
import { DEFINITIONS_TOOL } from '@/model/integrations'
import { describe, type Domain, type Domains, type Person } from '@/model/people'
import type { Block, ChangeKind, Relation, Review } from '@/model/review'
import { dateLabel, whenLabel } from '@/model/validity'

/* ---------- words for times ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const twoDigits = (n: number) => String(n).padStart(2, '0')

/** "Today, 09:12", "Yesterday, 16:40" or "20 Oct": when something happened, as the Inbox says it. */
export function whenWords(at: string, now: Date): string {
  const t = new Date(at)
  if (Number.isNaN(t.getTime())) return at
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(t)) / 86_400_000)
  const time = `${twoDigits(t.getHours())}:${twoDigits(t.getMinutes())}`
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  return `${t.getDate()} ${MONTHS[t.getMonth()]}`
}

/** A day the service gives ("2026-10-02", or a time on it) as people read it: "2 Oct 2026". */
const dayWords = (at: string) => (/^\d{4}-\d{2}-\d{2}/.test(at) ? dateLabel(at.slice(0, 10)) : at)

/* ---------- the workspace ---------- */

/**
 * The domains with their owners by name, and the people with what they own. Only the signed-in
 * person's admin role is known to a member: everyone else reads as a member until P8.
 */
export function workspaceOf(input: {
  areas: readonly Area[]
  people: readonly { id: string; name: string }[]
  me: { id: string; admin: boolean }
}): Pick<Workspace, 'domains' | 'people'> {
  const name = new Map(input.people.map((p) => [p.id, p.name]))
  const domains: Domain[] = input.areas.map((a) => ({
    id: a.id,
    name: a.name,
    owners: a.ownerIds.flatMap((id) => name.get(id) ?? []),
    covers: a.summary,
    text: a.description,
    ...(a.demo ? { sandbox: true } : {}),
  }))
  const byId: Domains = Object.fromEntries(domains.map((d) => [d.id, d]))
  const people: Person[] = input.people.map((p) => {
    const person: Person = {
      name: p.name,
      role: '',
      owns: input.areas.filter((a) => a.ownerIds.includes(p.id)).map((a) => a.id),
      admin: p.id === input.me.id && input.me.admin,
    }
    return { ...person, role: describe(person, byId) }
  })
  return { domains, people }
}

/* ---------- the Inbox ---------- */

/** Who sent a suggestion and how, in the mock's words: "a chat" or "editor". */
const viaOf = (channel: string) => (channel === 'form' ? 'editor' : 'a chat')

/** A context item a card names, as the quick view and Try it read it before the review loads. */
const draftStub: Fact = {
  id: '',
  title: '',
  summary: '',
  domain: '',
  kind: 'note',
  where: [],
  valid: {},
  when: whenLabel({}),
  status: 'Draft',
  checkedBy: '',
  checkedOn: '',
  source: '',
  quote: '',
  dontConclude: '',
}
const stubOf = (card: Extract<Card, { group: 'suggestion' }>): Fact => ({
  ...draftStub,
  id: card.itemId ?? card.id,
  title: card.title,
  domain: card.areaId,
})

/**
 * A card's id in the app. A suggestion is named by its bare proposal id, as its discussion is
 * (`review:<proposal id>`), and so is a Not found card with a draft, which is reviewed like one;
 * the other cards keep the service's name.
 */
type NeedCard = Exclude<Card, { group: 'mention' }>

export const idOf = (card: NeedCard) =>
  card.group === 'suggestion'
    ? card.proposalId
    : card.group === 'gap' && card.draft
      ? card.draft
      : card.id

function cardOf(card: NeedCard, me: string, now: Date, person: (id: string) => string): InboxCard {
  const base = { id: idOf(card), domain: card.areaId, for: me, when: whenWords(card.at, now) }
  switch (card.group) {
    case 'suggestion': {
      const synced = card.synced
      const from = synced ? synced.source.tool : (card.from?.name ?? 'Someone')
      const agent = card.writtenBy === 'agent'
      return {
        ...base,
        type: 'suggestion',
        title: card.title,
        line: synced
          ? `New context from ${synced.source.tool}: ${synced.document.title}.`
          : agent
            ? `New context from an agent, sent with ${from}'s OK.`
            : card.action === 'retire'
              ? `${from} suggests archiving it.`
              : card.action === 'create'
                ? `New context from ${from}.`
                : `A change from ${from}.`,
        detail: '',
        primary: 'Review',
        secondary: [],
        ...(card.itemId ? { factId: card.itemId } : {}),
        ...(synced
          ? {
              source: {
                tool: synced.source.tool,
                folder: synced.scope,
                doc: synced.document.title,
                read: whenWords(synced.read.at, now),
              },
            }
          : {}),
        suggestion: {
          ...(card.itemId ? { factId: card.itemId } : {}),
          from,
          ...(agent ? { agent: 'An agent' } : {}),
          via: 'a chat',
          on: dayWords(card.at),
          changes: [],
          draft: stubOf(card),
        },
      }
    }
    case 'gap': {
      const times = card.times ?? 0
      return {
        ...base,
        type: 'gap',
        title: card.title,
        line:
          card.times === null
            ? 'Agents found nothing written down for this, fewer than 5 times this week.'
            : `Agents found nothing written down for this, ${times} times this week.`,
        detail: card.draft
          ? 'A draft is ready. Check every part before you publish.'
          : `Nothing is drafted yet: write what agents should know about ${card.title}.`,
        primary: card.draft ? 'Review' : 'Write context',
        secondary: ['Not something we write down'],
        gap: {
          scope: [card.title],
          times,
          belongs: `context about ${card.title}`,
          // The draft is reviewed under this card's id; the review reads what it says.
          ...(card.draft
            ? { draft: { ...draftStub, id: card.draft, title: card.title, domain: card.areaId } }
            : {}),
        },
      }
    }
    // A report names the context item the reported answer gave first, when the service knows the
    // answer, and a named report from Ask names who sent it; an agent's feedback keeps nobody.
    // With no item, the card says what was sent and offers its one decision.
    case 'flag': {
      const item = card.items[0]
      return {
        ...base,
        type: 'flag',
        title: item?.title ?? `An answer was reported as ${card.verdict}`,
        line: `Reported ${card.verdict}${card.note ? `: “${card.note}”` : '.'}`,
        detail: item
          ? 'Agents keep getting the context item until it is changed.'
          : 'Agents keep getting the same answer until its context is changed.',
        ...(item
          ? { primary: 'Open the context item', secondary: ['Not a problem'], factId: item.id }
          : { primary: 'Not a problem', secondary: [] }),
        flag: {
          reason: card.verdict,
          note: card.note ?? '',
          when: dayWords(card.at),
          by: card.by ? person(card.by) : '',
          via: card.source === 'ask' ? 'Ask' : 'an agent',
        },
      }
    }
    // Raised by an alert rule with a card of its own: one action, to where the rule points.
    case 'alert': {
      const words = alertCardWords[card.rule]
      return {
        ...base,
        type: 'alert',
        title: card.title,
        line: words.line,
        detail: words.detail,
        primary: words.open,
        secondary: [],
        alert: { rule: card.rule, name: alertRule(card.rule).name, href: hrefOf(card.subject) },
      }
    }
    // Raised by the saved-question alert: the domain's saved questions that answer worse now.
    case 'look': {
      const one = card.questions.length === 1
      return {
        ...base,
        type: 'look',
        title: lookTitle(card.questions.length),
        line: one
          ? 'It answers worse than when it was saved.'
          : 'They answer worse than when they were saved.',
        detail:
          'Agents get the new answer until someone fixes the item, or keeps the new answer as the saved one. Quality has before and now for each.',
        primary: 'Open in Quality',
        secondary: [],
        look: { questions: card.questions.map((q) => q.id) },
      }
    }
    case 'check': {
      const by = card.lastChecked.by
      const on = card.lastChecked.on
      // Due since a day, as the mock says it: "Since 2 Oct".
      const since = whenWords(card.at, now)
      return {
        ...base,
        when: since.startsWith('Today')
          ? 'Today'
          : `Since ${since.replace(/^Yesterday, .*/, 'yesterday')}`,
        type: 'check',
        title: card.title,
        line:
          card.reason === 'source'
            ? `${DEFINITIONS_TOOL} changed a definition it relies on, after this context item was checked.`
            : `Its check date passed on ${dayWords(card.at)}. Agents are told it may be out of date.`,
        detail:
          by && on
            ? `Last checked by ${by === me ? 'you' : by}, ${dayWords(on)}.`
            : 'Not checked yet.',
        primary: 'Still true',
        secondary: ['Edit', 'Archive'],
        factId: card.itemId,
      }
    }
  }
}

/** What the Inbox shows of the person's own suggestions that wait on an owner. */
function waitingOf(w: Feed['waiting'][number], me: string, domains: Domains, now: Date): Waiting {
  const owners = w.waitingFor
  const domain = w.areaId ?? ''
  const of = domains[domain]?.name ?? domain
  return {
    id: `waiting:${w.proposalId}`,
    for: me,
    title: w.title,
    waitingFor: owners.length
      ? `${owners.join(' or ')}, ${owners.length === 1 ? 'owner' : 'owners'} of ${of}`
      : `an owner of ${of}`,
    domain,
    sent: w.sentAt ? whenWords(w.sentAt, now) : '',
    card: w.proposalId,
  }
}

/**
 * The Inbox from the feed's All tab: every card that needs the person, what they decided in the
 * last two weeks, and what they sent that waits. A suggestion drafted for a Not found card is
 * reviewed from that card, so it is not a card of its own.
 */
export function inboxOf(
  feed: Feed,
  me: string,
  domains: Domains,
  now: Date,
  /** A person's name by their id: who sent a named report. */
  person: (id: string) => string = () => 'Someone',
): Omit<Inbox, 'sent'> {
  const drafts = new Set(feed.cards.flatMap((c) => (c.group === 'gap' && c.draft ? [c.draft] : [])))
  const cards = feed.cards.filter(
    (c): c is NeedCard =>
      c.group !== 'mention' && !(c.group === 'suggestion' && drafts.has(c.proposalId)),
  )
  const mentions = feed.cards.flatMap((c) =>
    c.group === 'mention'
      ? [
          {
            subject: c.subject as Subject,
            id: c.commentId,
            from: c.from.name ?? 'Someone',
            when: whenWords(c.at, now),
            excerpt: c.excerpt,
            title: c.title,
          },
        ]
      : [],
  )
  const done: Record<string, Outcome> = {}
  const opened: Record<string, boolean> = {}
  const reviewed: Record<string, boolean> = {}
  // A draft's own suggestion card says whether it was opened in the review and read.
  const draftCards = new Map(
    feed.cards.flatMap((c) =>
      c.group === 'suggestion' && drafts.has(c.proposalId) ? [[c.proposalId, c] as const] : [],
    ),
  )
  for (const c of cards) {
    const id = idOf(c)
    const draft = c.group === 'gap' && c.draft ? draftCards.get(c.draft) : undefined
    // A drafted Not found card is decided when its draft is: published, returned or archived.
    const decided = c.done ?? draft?.done
    if (decided) done[id] = { label: decided.outcome, at: whenWords(decided.at, now) }
    if (c.opened || draft?.opened) opened[id] = true
    if ((c.group === 'suggestion' && c.read) || draft?.read) reviewed[id] = true
  }
  return {
    cards: cards.map((c) => cardOf(c, me, now, person)),
    mentions,
    waiting: feed.waiting.map((w) => waitingOf(w, me, domains, now)),
    done,
    opened,
    reviewed,
    week: feed.week,
  }
}

/* ---------- the review ---------- */

const kindWord: Record<string, ChangeKind> = {
  wording: 'Wording',
  formatting: 'Formatting',
  link: 'Link',
  order: 'Order',
  added: 'Added',
  removed: 'Removed',
  dates: 'Dates',
}

const fieldWord: Record<string, string> = {
  title: 'Title',
  text: 'What agents should know',
  kind: 'Kind',
  where: 'Where',
  when: 'When',
  checkDate: 'Check date',
  sources: 'Source',
  notToConclude: "Don't conclude",
  quote: 'Quote',
}
const fieldOf = (field: string) => fieldWord[field] ?? field

const markWord: Record<string, string> = {
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  code: 'Code',
}

type Run = Extract<ReviewSheet['diff']['blocks'][number], { runs: unknown }>['runs'][number]

/** A run of text with the app's marks: [-removed-], {+added+}, {*formatted|what changed*}. */
function markedOf(runs: readonly Run[], side?: 'before' | 'after'): string {
  return runs
    .map((r) => {
      if (r.t !== 'fmt') {
        if (r.t === 'same') return r.text
        if (r.t === 'add') return side === 'before' ? '' : `{+${r.text}+}`
        return side === 'after' ? '' : `[-${r.text}-]`
      }
      const note = [
        ...r.added.map((m) => markWord[m]),
        ...r.removed.map((m) => `no ${markWord[m]?.toLowerCase()}`),
      ].join(', ')
      return `{*${r.text}|${note}*}`
    })
    .join('')
}

/** The kind as people read it: "Event", "Warning", "Rule", "Guide". */
const kindName = (kind: string) => kindLabel[kind as Kind] ?? kind

/** A date window of the service (its end is the first day it no longer applies) in words. */
function spanWords(span: { from: string | null; until: string | null }) {
  return whenLabel({
    ...(span.from ? { from: span.from } : {}),
    ...(span.until ? { until: shiftDate(span.until, -1) } : {}),
  })
}

type ServerBlock = ReviewSheet['diff']['blocks'][number]

/** The days of a change of dates in one month, for its timeline; null when it spans more. */
function timelineOf(
  block: Extract<ServerBlock, { kind: 'dates' }>,
): Extract<Block, { kind: 'Dates' }>['span'] | undefined {
  const { before, after } = block
  const days = [after.from, before.until, after.until]
  if (days.some((d) => !d)) return undefined
  const [from, was, now] = days.map((d) => d!) as [string, string, string]
  const last = (d: string) => shiftDate(d, -1)
  const month = from.slice(0, 7)
  if (![last(was), last(now)].every((d) => d.slice(0, 7) === month)) return undefined
  const day = (d: string) => Number(d.slice(8, 10))
  return {
    from: day(from),
    was: day(last(was)),
    now: day(last(now)),
    month: MONTHS[Number(month.slice(5, 7)) - 1]!,
  }
}

/** Where a moved step came from, in words: "Moved up from step 2". */
function orderLabel(steps: readonly { from: number | null }[]) {
  const moved = steps.findIndex((s, i) => s.from !== null && s.from !== i + 1)
  if (moved < 0) return 'Moved'
  const from = steps[moved]!.from!
  return `Moved ${moved + 1 < from ? 'up' : 'down'} from step ${from}`
}

/** One change of the service's difference as the block the review draws. */
function blockOf(b: ServerBlock, words?: Words): Block {
  const field = fieldOf(b.field)
  switch (b.kind) {
    case 'wording':
      return 'runs' in b
        ? { kind: 'Wording', field, text: markedOf(b.runs) }
        : { kind: 'Wording', field, text: `[-${kindName(b.before)}-]{+${kindName(b.after)}+}` }
    case 'added':
    case 'removed': {
      const kind = b.kind === 'added' ? 'Added' : 'Removed'
      if ('text' in b) return { kind, field, text: b.text }
      if ('parts' in b) return { kind, field, text: b.parts.join(', ') }
      if ('url' in b) return { kind, field, text: b.quote ? `${b.url}: “${b.quote}”` : b.url }
      return { kind, field, text: spanWords({ from: b.from, until: b.until }) }
    }
    case 'formatting': {
      if ('items' in b)
        return {
          kind: 'Formatting',
          field,
          label:
            b.change.now === 'number'
              ? 'Bulleted list became a numbered list'
              : 'Numbered list became a bulleted list',
          text: '',
          list: {
            ordered: b.change.now === 'number',
            was: b.change.was === 'bullet' ? 'bullets' : 'numbers',
            items: b.items,
          },
        }
      const c = b.change
      const label =
        c.what === 'marks'
          ? [
              ...c.added.map((m) => `${markWord[m]} added`),
              ...c.removed.map((m) => `${markWord[m]} removed`),
            ].join(', ')
          : c.what === 'list'
            ? c.now === 'number'
              ? 'Bulleted list became a numbered list'
              : 'Numbered list became a bulleted list'
            : 'The layout changed'
      return { kind: 'Formatting', field, label, text: markedOf(b.runs) }
    }
    case 'link':
      return 'mention' in b
        ? {
            kind: 'Link',
            field,
            text: '',
            mention: mentionOf(b.mention, words),
          }
        : { kind: 'Link', field, text: b.text, before: b.before ?? '', after: b.after ?? '' }
    case 'order':
      return {
        kind: 'Order',
        field,
        label: orderLabel(b.steps),
        steps: b.steps.map((s) => ({ text: s.text, ...(s.from === null ? {} : { from: s.from }) })),
      }
    case 'dates': {
      const span = timelineOf(b)
      return {
        kind: 'Dates',
        field,
        before: spanWords(b.before),
        after: spanWords(b.after),
        ...(span ? { span } : {}),
      }
    }
  }
}

/**
 * A link added or removed, as the review names it: by the app's mention id, and a term written in
 * Definitions by its word, as Related names it, so Try it says where the answer would follow it.
 */
function mentionOf(
  m: { target: string; label: string; change: 'added' | 'removed' },
  words: Words | undefined,
): { id: string; label: string; change: 'added' | 'removed' } {
  const id = (words && mentionIdOf(m.target, words)) || m.target
  const term = m.target.startsWith('term:') && words ? words.termName(m.target.slice(5)) : undefined
  return { id, label: term ?? m.label, change: m.change }
}

/** A source's address, short: the last part of its path, with its anchor. */
function pageOf(url: string) {
  try {
    const u = new URL(url)
    return `${u.pathname.split('/').filter(Boolean).at(-1) ?? u.host}${u.hash}`
  } catch {
    return url
  }
}

/** A page's host, as a source is named in a sentence: "status.example". */
function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The values that moved, pulled out of the change: "Number 312 to 340", "Source page". */
function movedOf(values: ReviewSheet['diff']['values']): Review['moved'] {
  return values.flatMap((v) => {
    if (v.after === null) return []
    if (v.what === 'source')
      return [
        {
          label: 'Source page',
          ...(v.before ? { before: pageOf(v.before) } : {}),
          after: pageOf(v.after),
        },
      ]
    const label =
      v.what === 'number'
        ? 'Number'
        : v.field === 'when'
          ? 'End date'
          : v.before === null
            ? 'New date'
            : 'Date'
    return [
      {
        label,
        ...(v.before === null ? {} : { before: dayWords(v.before) }),
        after: dayWords(v.after),
      },
    ]
  })
}

/** "2 wording changes and a link": what changes, for the one sentence over the change. */
function summaryOf(sheet: ReviewSheet): string {
  const { diff } = sheet
  if (sheet.mode === 'retire') return `Archives a context item: ${sheet.proposal.title}.`
  if (sheet.mode === 'new') {
    const text = sheet.source.after.split('\n\n')[0] ?? ''
    const first = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? `${sheet.proposal.title}.`
    return `New context: ${first}`
  }
  if (diff.only === 'formatting') return 'Tidies the layout. The words are the same.'
  if (diff.only === 'order') return 'Changes the order. The words are the same.'
  const parts = diff.counts.map(({ kind, n }) => {
    const many = n > 1
    switch (kind) {
      case 'wording':
        return many ? `rewords ${n} places` : 'rewords one place'
      case 'formatting':
        return 'changes the formatting'
      case 'link':
        return many ? `changes ${n} links` : 'changes a link'
      case 'order':
        return 'changes the order'
      case 'added':
        return many ? `adds ${n} parts` : 'adds a part'
      case 'removed':
        return many ? `removes ${n} parts` : 'removes a part'
      case 'dates':
        return 'changes when it applies'
    }
  })
  if (!parts.length) return 'Nothing agents get changes.'
  const words =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]!
  const moved = movedOf(diff.values)
    .filter((m) => m.before && m.label !== 'Source page')
    .map((m) => `${m.before} to ${m.after}`)
  const sentence = `${words.charAt(0).toUpperCase()}${words.slice(1)}`
  return moved.length ? `${sentence}: ${moved.join(', ')}.` : `${sentence}.`
}

/** What the review needs that the screens do not: the service's ids, to decide on it. */
export type SheetRef = {
  proposalId: string
  revision: number
  itemVersionId: string | null
  /** The live items it clashes with: Publish answers for each. */
  clashes: string[]
  /** A Not found card's draft: what agents asked about, in words, and its domain. */
  gap: { scope: string; areaId: string } | null
}

export const refOf = (sheet: ReviewSheet): SheetRef => ({
  proposalId: sheet.proposal.id,
  revision: sheet.proposal.revision,
  itemVersionId: sheet.proposal.itemVersionId,
  clashes: sheet.clashes.map((c) => c.itemId),
  gap:
    sheet.gapId && sheet.proposal.areaId
      ? { scope: sheet.tryIt.question, areaId: sheet.proposal.areaId }
      : null,
})

/** An owner's answer to a clash, in the app's words. */
const relationOf = {
  replaces: 'replaces',
  disagrees: 'disagree',
  unrelated: 'unrelated',
} as const satisfies Record<ClashRelation, Relation>

/** The plain words of the suggested text, for a clash's side by side. */
const firstParagraph = (markdown: string) => markdown.split('\n\n')[0] ?? ''

/** A review sheet as the review draws it, under the id of its card. */
export function reviewOf(
  sheet: ReviewSheet,
  cardId: string,
  /** For a Not found card's draft: how often agents found nothing this week, under the minimum null. */
  gap?: { times: number | null },
  /** The vocabulary and the terms, which a link added or removed is named by. */
  words?: Words,
): Review {
  const { diff, proposal } = sheet
  const rewrite = diff.blocks.find(
    (b): b is Extract<ServerBlock, { kind: 'wording'; runs: unknown }> =>
      b.kind === 'wording' && 'runs' in b && b.rewrite,
  )
  // Drafted for a Not found card by the drafting helper: nobody wrote it, so it is the queue's own.
  const drafted = sheet.gapId !== null && sheet.writtenBy !== null
  const from = drafted
    ? 'Drafted for you'
    : sheet.synced
      ? sheet.synced.source.tool
      : (sheet.from?.name ?? 'Someone')
  // The page it was drafted from: a new item's source is an added block, a change's a moved value.
  const page =
    diff.blocks.flatMap((b) =>
      b.kind === 'added' && b.field === 'sources' && 'url' in b ? [b.url] : [],
    )[0] ?? diff.values.find((v) => v.what === 'source' && v.after)?.after
  const say = (a: ReviewSheet['tryIt']['before']) => ({ state: a.state, text: a.say })
  const reach = sheet.reach?.questions ?? 0
  return {
    id: cardId,
    title: proposal.title,
    from,
    ...(sheet.writtenBy === 'agent' ? { agent: 'An agent' } : {}),
    via: viaOf(proposal.channel),
    on: dayWords(proposal.submittedAt ?? proposal.createdAt),
    ...(sheet.synced
      ? {
          synced: {
            tool: sheet.synced.source.tool,
            folder: sheet.synced.scope,
            doc: sheet.synced.document.title,
            read: whenWords(sheet.synced.read.at, new Date()),
            quote: sheet.synced.quote,
          },
        }
      : {}),
    ...(sheet.note ? { note: sheet.note } : {}),
    mode: sheet.mode,
    ...(drafted
      ? {
          drafted: {
            questions: gap?.times ?? reach,
            scope: sheet.tryIt.question,
            from: page ? `the page at ${hostOf(page)}` : 'the context around it',
          },
        }
      : {}),
    summary: summaryOf(sheet),
    counts: diff.counts.map((c) => ({ kind: kindWord[c.kind]!, n: c.n })),
    moved: movedOf(diff.values),
    blocks: diff.blocks.filter((b) => b !== rewrite).map((b) => blockOf(b, words)),
    unchanged: diff.unchanged.map(fieldOf),
    ...(diff.only === 'formatting' ? { formattingOnly: true } : {}),
    ...(rewrite
      ? {
          rewrite: {
            field: fieldOf(rewrite.field),
            before: markedOf(rewrite.runs, 'before'),
            after: markedOf(rewrite.runs, 'after'),
            changes: rewrite.changes,
          },
        }
      : {}),
    ...(sheet.claims
      ? {
          claims: {
            sentence: sheet.claims.sentence,
            rows: sheet.claims.rows.map((row) => ({
              claim: row.claim,
              source: row.source ?? 'not in the sentence',
              same: row.verdict,
            })),
          },
        }
      : {}),
    // Every live item it overlaps, each answered on its own, with the answer it already has.
    ...(sheet.clashes.length
      ? {
          clash: {
            mine: firstParagraph(sheet.source.after),
            items: sheet.clashes.map((c) => ({
              factId: c.itemId,
              title: c.title,
              theirs: c.summary,
              ...(c.relation ? { relation: relationOf[c.relation] } : {}),
            })),
          },
        }
      : {}),
    ...(sheet.mode === 'retire' && proposal.itemId
      ? {
          retire: {
            factId: proposal.itemId,
            reason: sheet.note ?? '',
            used: reach,
            checkFirst: '',
            // Its sender took it back in the comments: said with their words, as the thread has them.
            ...(sheet.withdrawn
              ? {
                  withdrawn: {
                    by: sheet.withdrawn.by.name ?? from,
                    when: commentWhen(sheet.withdrawn.at, new Date()),
                    quote: sheet.withdrawn.quote,
                  },
                }
              : {}),
          },
        }
      : {}),
    tryIt: {
      question: sheet.tryIt.question,
      before: say(sheet.tryIt.before),
      after: say(sheet.tryIt.after),
      reach,
    },
    source: { before: sheet.source.before, after: sheet.source.after },
    ready: {
      ok: sheet.readiness.ok,
      bulk: sheet.readiness.bulk,
      title: sheet.readiness.title,
      text: sheet.readiness.text,
    },
    readMs: sheet.readMs,
    saved: sheet.saved.map((x) => ({
      id: x.id,
      result: x.result,
      why: savedWhy({ reason: x.reason, saved: x.live, now: x.draft, expect: x.expectItems }),
      before: answerText(x.live),
      now: answerText(x.draft),
    })),
  }
}
