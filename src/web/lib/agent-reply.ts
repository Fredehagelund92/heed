import type { PreviewReply } from '@/api/client'
import type { ClaimLevel, ItemKind } from '@domain/item'
import { ownCaveat } from '@domain/proposal-rules'

/*
  "What an agent will see": the reply of get_facts for a draft, as proposals.preview returns it
  (FR-214), in the words and fields the card shows.
*/

export type ReplyItem = {
  id: string
  kind: ItemKind
  title: string
  summary: string
  /** The text below the summary, as the agent receives it (Markdown, mentions as their words). */
  body: string | null
  /** The stored, half-open window: `end` is the day after the last day (NFR-048). */
  validity: { start: string; end: string | null }
  claimLevel: ClaimLevel
  /** False when a definition changed or its review date passed: the agent says so. */
  verified: boolean
  evidence: { url: string; quote: string; date: string }[]
  /**
   * What the contributor said not to conclude, when they wrote their own (FR-104). The
   * default, "cause not proven", is what the claim level already says, so it reads as null.
   */
  notToConclude: string | null
  /** "Applies to market: Norway only." for a partial match. */
  appliesNote: string | null
  /** The version an agent gets. */
  version: number
  /**
   * How it was reviewed before it was served, as the agent reads it (FR-326): the day, the role
   * ("the owner of Commercial") and the edition. Null for a version not accepted yet.
   */
  reviewed: ServedStamp | null
}

/** A served review as an agent receives it: the day it was accepted, by which role, in which edition. */
export type ServedStamp = { acceptedOn: string; by: string; edition: string }

export type AgentReply =
  | { status: 'matched' | 'conflict'; edition: string | null; items: ReplyItem[]; cut: boolean }
  | { status: 'no_match'; edition: string | null }
  | { status: 'need_more_detail'; edition: string | null }
  | { status: 'check_failed'; edition: string | null; message: string | null }

/**
 * A reply's words for people: the vocabulary keys an agent reads ("Applies to dim:product:
 * val:product/climbing only.") become the names they stand for ("Applies to Product: Climbing only.").
 * A key without a name reads as its last part.
 */
export function namedKeys(text: string, nameOf: (key: string) => string | undefined): string {
  return text.replace(/\b(?:metric|dim|val|group):[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?/g, (key) => {
    const named = nameOf(key)
    if (named) return named
    const last =
      key
        .slice(key.indexOf(':') + 1)
        .split('/')
        .pop() ?? key
    const words = last.replaceAll('_', ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  })
}

function readItem(
  item: NonNullable<PreviewReply['items']>[number],
  nameOf: (key: string) => string | undefined,
): ReplyItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    body: item.body?.trim() ? item.body : null,
    validity: item.validity,
    claimLevel: item.claim_level,
    verified: item.freshness !== 'unverified',
    evidence: item.evidence.map(({ url, quote, read_on }) => ({ url, quote, date: read_on })),
    notToConclude: ownCaveat(item.not_to_conclude),
    appliesNote: item.applies_note ? namedKeys(item.applies_note, nameOf) : null,
    version: item.version,
    reviewed: item.reviewed
      ? {
          acceptedOn: item.reviewed.accepted_on,
          by: item.reviewed.accepted_by,
          edition: item.reviewed.in_edition,
        }
      : null,
  }
}

/**
 * Reads a preview reply into what the card shows. `nameOf` names the vocabulary keys in its notes;
 * a key it does not know reads as its last part.
 */
export function readAgentReply(
  result: PreviewReply,
  nameOf: (key: string) => string | undefined = () => undefined,
): AgentReply {
  const edition = result.edition ?? null
  switch (result.status) {
    case 'matched':
    case 'conflict':
      return {
        status: result.status,
        edition,
        items: (result.items ?? []).map((item) => readItem(item, nameOf)),
        cut: result.check_report.cut,
      }
    case 'no_match':
    case 'need_more_detail':
      return { status: result.status, edition }
    case 'check_failed':
      return { status: 'check_failed', edition, message: result.instructions ?? null }
  }
}
