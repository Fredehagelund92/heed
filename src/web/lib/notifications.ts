import type { InboxItem } from '@/api'
import { isStreamTopic, type StreamTopic } from '@/api/live'
import { parseEditionLabel } from '@/lib/editions'
import { formatDay } from '@/lib/library'

/*
  What each event says to a person (slice W7): who did what, and to which subject, built from the
  actor, the topic and the subject's state, for the notifications list and its announcements.
  Events carry ids and states only, so the words come from here, never from the service. Every
  topic the service posts has words (a unit test reads the service's code to keep it so),
  including the ones that only refresh screens, so an activity feed can reuse them. The words
  follow the proposal timeline's (proposal-activity.ts).

  The subject is not woven into the sentence: titles are often whole sentences themselves ("Online
  sales to Norway stopped on 4 August 2026 after a new customs rule."), so the list shows what
  happened on one line and the subject's title under it.
*/

/** One notification as the list draws it. */
export type NotificationLine = Pick<InboxItem, 'kind' | 'state' | 'title' | 'actor' | 'subject'>

export type Sentence = {
  /** Who acted, or null for the system (a definition that changed in the source). */
  actor: string | null
  /** What happened, after the actor: "asked for changes". A whole sentence without an actor. */
  action: string
  /** The subject's title, or what it is when the person may no longer see it; empty for none. */
  subject: string
}

type Phrase = (line: NotificationLine) => string

const decided: Record<string, string> = {
  accepted: 'accepted the proposal',
  changes_requested: 'asked for changes',
  rejected: 'rejected the proposal',
}

const sourceStates: Record<string, string> = {
  source_changed: 'A definition this fact uses changed at its source',
  source_missing: 'A definition this fact uses is gone from its source',
}

/** The words of every topic. The actor, when there is one, comes first. */
export const topicPhrases: Record<StreamTopic, Phrase> = {
  'stream.ready': () => 'Live updates are on',
  'stream.reset': () => 'Live updates started again',
  'proposal.created': () => 'started a draft',
  'proposal.saved': () => 'saved a draft',
  'proposal.discarded': () => 'discarded a draft',
  'proposal.submitted': () => 'sent a proposal for review',
  'proposal.checked': () => 'We checked a proposal',
  'proposal.claimed': () => 'claimed the review',
  'proposal.handed_over': () => 'handed the review to you',
  'proposal.edited': () => 'edited the proposal',
  'proposal.commented': () => 'commented',
  'proposal.withdrawn': () => 'withdrew the proposal',
  'proposal.approved': () => 'accepted the proposal. It needs one more yes before AI apps get it',
  'proposal.decided': ({ state }) => decided[state ?? ''] ?? 'decided on the proposal',
  'edition.published': () => 'updated what AI apps get',
  'item.flagged': ({ state }) =>
    sourceStates[state ?? ''] ?? 'A definition this fact uses changed at its source',
  'item.unflagged': () => 'The definitions this fact uses are fine again',
  'item.links_stale': () => 'Links in this fact point to definitions that changed',
  'vocabulary.domain_changed': () => 'Its source moved this name to another domain',
  'serving.changed': () => 'changed what AI apps get',
  'eval.scorecard': () => 'New answer test results are ready',
  'gap.verified': () => 'A question that had no answer now gets one',
  'area.deleted': () =>
    'deleted the domain. We withdrew its open proposals and kept your drafts in it',
  'inbox.changed': () => 'Your notifications changed',
}

/** Topics whose words name no person, even when the event records one. */
const systemTopics = new Set<string>([
  'stream.ready',
  'stream.reset',
  'proposal.checked',
  'item.flagged',
  'item.unflagged',
  'item.links_stale',
  'vocabulary.domain_changed',
  'eval.scorecard',
  'gap.verified',
  'inbox.changed',
])

/** Topics about no subject a person can open. */
const subjectless = new Set<string>([
  'stream.ready',
  'stream.reset',
  'eval.scorecard',
  'inbox.changed',
  'serving.changed',
])

/**
 * What a subject is called when its title is not shown: the person may no longer see it, or it has
 * no title on the service (a gap's title is its topic, named from the vocabulary in the page).
 */
const subjectNouns: Record<string, string> = {
  proposal: 'A proposal you can no longer see',
  item: 'A fact you can no longer see',
  vocabulary: 'A name in the Catalogue',
  gap: 'A gap in a domain you own',
  area: 'A domain',
}

/**
 * A new edition as the day it was made ("7 October 2026"): the label is for the Editions page,
 * and this list shows everywhere.
 */
function editionDay(label: string): string {
  const parts = parseEditionLabel(label)
  return parts ? formatDay(parts.day, 'long') : ''
}

export function notificationSentence(line: NotificationLine): Sentence {
  const known = isStreamTopic(line.kind)
  const action = isStreamTopic(line.kind) ? topicPhrases[line.kind](line) : 'Something changed'
  const subject = subjectless.has(line.kind)
    ? ''
    : line.subject.type === 'edition'
      ? editionDay(line.subject.id)
      : (line.title ?? subjectNouns[line.subject.type] ?? '')
  return {
    actor: !known || systemTopics.has(line.kind) ? null : (line.actor?.name ?? 'Someone'),
    action,
    subject,
  }
}

/** The sentence as plain text, for an announcement or an accessible name. */
export function sentenceText({ actor, action, subject }: Sentence): string {
  const happened = actor ? `${actor} ${action}` : action
  return subject ? `${happened}: ${subject}` : happened
}

/**
 * The sentence with what the reviewer wrote, quoted after it: one stop between them, since a title
 * that is a whole sentence already ends with its own.
 */
export function sentenceWithNote(sentence: Sentence, note: string | null): string {
  const said = sentenceText(sentence)
  if (!note) return said
  return `${said}${/[.!?]$/.test(said) ? '' : '.'} “${note}”`
}

/**
 * Where a notification leads: the proposal, the item, the term or the edition it is about, the
 * gap in the Workbench (only the area's owners and deputies hear of one), or for a deleted
 * domain the person's proposals, where their drafts in it wait. Every signed-in person
 * hears of a new edition, but only those who may open Editions get a link to it.
 */
export type NotificationTarget =
  | { to: '/proposals/$proposalId'; params: { proposalId: string } }
  | { to: '/library/$itemId'; params: { itemId: string } }
  | { to: '/catalogue/metric/$id'; params: { id: string } }
  | { to: '/catalogue/dimension/$id'; params: { id: string } }
  | { to: '/editions/$label'; params: { label: string } }
  | { to: '/health'; search: { open: `gap:${string}` } }
  | { to: '/proposals' }

export function notificationTarget(
  subject: NotificationLine['subject'],
  opensEditions: boolean,
): NotificationTarget | null {
  switch (subject.type) {
    case 'proposal':
      return { to: '/proposals/$proposalId', params: { proposalId: subject.id } }
    case 'item':
      return { to: '/library/$itemId', params: { itemId: subject.id } }
    case 'edition':
      return opensEditions ? { to: '/editions/$label', params: { label: subject.id } } : null
    case 'gap':
      return { to: '/health', search: { open: `gap:${subject.id}` } }
    // A deleted domain (FR-814): its authors find their withdrawn proposals and kept drafts.
    case 'area':
      return { to: '/proposals' }
    case 'vocabulary': {
      const [kind, id] = subject.id.split(':')
      if (!id) return null
      if (kind === 'metric') return { to: '/catalogue/metric/$id', params: { id } }
      if (kind === 'dim') return { to: '/catalogue/dimension/$id', params: { id } }
      return null
    }
    default:
      return null
  }
}
