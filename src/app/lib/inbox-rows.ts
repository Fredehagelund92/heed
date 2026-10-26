import * as React from 'react'
import type { Inbox } from '@/api'
import { useInbox } from '@/api/queries'
import type { MentionNote, Subject } from '@/model/comments'
import type { InboxCard, Outcome, Waiting } from '@/model/inbox'
import type { Domains } from '@/model/people'
import { useDomains, useMe } from '@/lib/workspace'

// The Inbox's rows, shared by the Inbox and the sidebar's count, so "Needs you" means one thing.

export type InboxRow =
  | { kind: 'card'; card: InboxCard; done?: Outcome; note?: MentionNote }
  | { kind: 'waiting'; item: Waiting; note?: MentionNote }
  | { kind: 'mention'; subject: Subject; title: string; note: MentionNote }

export const rowId = (r: InboxRow) =>
  r.kind === 'card' ? r.card.id : r.kind === 'waiting' ? r.item.id : `m.${r.subject}`
export const rowTitle = (r: InboxRow) =>
  r.kind === 'card' ? r.card.title : r.kind === 'waiting' ? r.item.title : r.title
/** What needs you: an open card, and anything that mentions you that you haven't read. */
/** The Inbox's groups, in the order of need: what agents couldn't answer first, suggestions after. */
export const INBOX_GROUPS = [
  { id: 'gap', label: 'Not found' },
  { id: 'flag', label: 'Reported' },
  { id: 'look', label: 'Saved questions' },
  { id: 'mention', label: 'Mentioned you' },
  { id: 'check', label: 'Due for a check' },
  { id: 'suggestion', label: 'Suggestions' },
  { id: 'waiting', label: 'Waiting on others' },
  { id: 'done', label: 'Done' },
] as const

export type InboxGroup = (typeof INBOX_GROUPS)[number]['id']

export const groupOf = (r: InboxRow): InboxGroup =>
  r.kind === 'mention'
    ? 'mention'
    : r.kind === 'waiting'
      ? r.note
        ? 'mention'
        : 'waiting'
      : r.done && !r.note
        ? 'done'
        : r.card.type

const order = (r: InboxRow) => INBOX_GROUPS.findIndex((g) => g.id === groupOf(r))

export const needs = (r: InboxRow) => (r.kind === 'card' ? !r.done || !!r.note : !!r.note)

/**
 * Your Inbox: open cards, mentions of you, your suggestions waiting on others, and what is done.
 * `decided` is the Inbox's own view of what is decided, with a decision still being saved.
 */
export function useInboxRows(decided?: Record<string, Outcome>) {
  const me = useMe()
  const inbox = useInbox()
  const domains = useDomains()
  return React.useMemo(
    () => inboxRows(inbox, me.name, domains, decided),
    [inbox, me.name, domains, decided],
  )
}

/** The rows of a person's Inbox, from what the Inbox read says. */
export function inboxRows(
  inbox: Inbox,
  me: string,
  domains: Domains,
  decided?: Record<string, Outcome>,
) {
  const done = decided ?? inbox.done
  // The newest unread mention per thread; a mention brings its card, or your waiting suggestion, back to Needs you.
  const notes = new Map(inbox.mentions.map((n) => [n.subject, n]))
  const mine = inbox.cards.filter((c) => c.for === me)
  // What you sent this visit waits here too, until the owner decides.
  const sentNow: Waiting[] = inbox.sent
    .filter((x) => x.by === me)
    .map((x) => ({
      id: x.id,
      for: me,
      title: x.title,
      waitingFor: `${x.to}, owner of ${domains[x.domain]?.name ?? x.domain}`,
      domain: x.domain,
      sent: 'Today',
      card: x.id,
    }))
  const mineWaiting = [...sentNow, ...inbox.waiting.filter((w) => w.for === me)]
  const noteOn = (id: string) => notes.get(`review:${id}`)
  const open = mine.filter((c) => !done[c.id] || noteOn(c.id))
  const finished = mine.filter((c) => done[c.id] && !noteOn(c.id))
  const covered = new Set([
    ...mine.map((c) => `review:${c.id}`),
    ...mineWaiting.map((w) => `review:${w.card}`),
  ])
  const elsewhere = [...notes.values()].filter((n) => !covered.has(n.subject))
  const rows: InboxRow[] = [
    ...open.map((card) => ({
      kind: 'card' as const,
      card,
      done: done[card.id],
      note: noteOn(card.id),
    })),
    ...elsewhere.map((note) => ({
      kind: 'mention' as const,
      subject: note.subject,
      title: note.title,
      note,
    })),
    ...mineWaiting
      .map((item) => ({ kind: 'waiting' as const, item, note: notes.get(`review:${item.card}`) }))
      .sort((a, b) => Number(!!b.note) - Number(!!a.note)),
    ...finished.map((card) => ({ kind: 'card' as const, card, done: done[card.id] })),
  ]
  // By need, then as they came in.
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => order(a.r) - order(b.r) || a.i - b.i)
    .map((x) => x.r)
  return { needing: sorted.filter(needs), rows: sorted, waiting: mineWaiting }
}
