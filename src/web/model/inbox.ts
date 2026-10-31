import type { AlertCardRule } from '@domain/alerts'
import type { DomainId, Fact } from './items'

// The Inbox as the app reads it (src/web/api): cards that need someone, what they sent that waits
// on others, and the setup checklist of a new install. Pure types and words.

/** A decision taken on a card: its outcome in a word or two, and when. */
export type Outcome = { label: string; at: string }

export type CardType = 'suggestion' | 'gap' | 'flag' | 'check' | 'look' | 'alert'

/** Each card by what happened, so the word explains itself. */
export const cardTypeLabel: Record<CardType, string> = {
  suggestion: 'Suggestion',
  gap: 'Not found',
  flag: 'Reported',
  check: 'Due for a check',
  look: 'Needs a look',
  alert: 'Alert',
}

export type FieldChange = { label: string; before: string; after: string }

export type Suggestion = {
  /** The context item it changes; none for a new one. */
  factId?: string
  from: string
  /** Set when an agent sent it, with the person's OK: the agent's name (FR-420). */
  agent?: string
  via: string
  on: string
  note?: string
  changes: FieldChange[]
  draft: Fact
}

export type InboxCard = {
  id: string
  type: CardType
  domain: DomainId
  /** Whose Inbox it lands in. */
  for: string
  when: string
  title: string
  line: string
  detail: string
  primary: string
  secondary: string[]
  factId?: string
  suggestion?: Suggestion
  /**
   * Not found: the scope agents asked about and how often (never their words, which are not
   * kept), and the item drafted for it, so the owner reviews a draft instead of a blank page.
   */
  gap?: { scope: string[]; times: number; belongs: string; draft?: Fact; acrossMonths?: string }
  /** A report someone sent on purpose from a conversation: kept with their words, and their name. */
  flag?: { reason: 'wrong' | 'unclear'; note: string; when: string; by: string; via: string }
  /** Raised by the saved-question alert: the questions that answer worse now, from Quality's one list. */
  look?: { questions: string[] }
  /**
   * Raised by an alert rule with a card of its own: the rule, its name, and where its one action
   * goes (a topic's answer panel, Overview, Usage, or an integration).
   */
  alert?: { rule: AlertCardRule; name: string; href: string }
  /** Created by a sync from a document, never by a person. */
  source?: { tool: string; folder: string; doc: string; read: string }
}

export type Waiting = {
  id: string
  for: string
  title: string
  waitingFor: string
  domain: DomainId
  sent: string
  /** The suggestion's card in the owner's Inbox, where its comments hang. */
  card: string
}

export type SetupStep = { id: string; title: string; description: string; action: string }
