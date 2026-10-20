import type { MentionPart } from '@domain/mentions'

/*
  The question being typed in the Ask composer (Heed composer, stage 2): its words and the chips
  in them. A chip is a term of the vocabulary (`metric:net_revenue`, `val:market/norway`,
  `dim:market`), an accepted item (`item:itm_...`), a domain (`area:...`) or the question's dates
  (`dates:2026-01-01/2026-12-31`), and keeps the words it
  stands for, so the question reads as a sentence when it is copied or sent. Pure, so the editor,
  the plain box it falls back to, the send and the tests read a draft the same way. It imports nothing at run time, so the shell's
  New chat can read a draft without the vocabulary's search.
*/

/** The question as words and chips, in order. A chip's `target` is a mention target or a dates target. */
export type AskDraft = readonly MentionPart[]

export const emptyDraft: AskDraft = []

/** A draft of words alone, as the plain box and a question brought back with Up type it. */
export const textDraft = (text: string): AskDraft => (text ? [{ kind: 'text', text }] : [])

/** What stands in for a chip in the words Heed reads: a mark that is neither a letter nor a space. */
export const CHIP_MARK = '￼'

const DATES = 'dates:'
/** The chip target of a question's dates, both days included. */
export const datesTarget = (from: string, to: string) => `${DATES}${from}/${to}`
/** The days of a dates chip, or null for a term. */
export function datesOf(target: string): { from: string; to: string } | null {
  if (!target.startsWith(DATES)) return null
  const [from, to] = target.slice(DATES.length).split('/')
  return from && to ? { from, to } : null
}

/** The question as it is sent and copied: its words, each chip as the words it stands for. */
export const draftText = (draft: AskDraft) =>
  draft.map((part) => (part.kind === 'text' ? part.text : part.label)).join('')

/**
 * The words Heed reads for what the chips leave: each chip is one mark, so a name is never read
 * across a chip and every place in it is the place in the editor's paragraph.
 */
export const draftReading = (draft: AskDraft) =>
  draft.map((part) => (part.kind === 'text' ? part.text : CHIP_MARK)).join('')

/** Whether the draft has a chip of the question's dates. */
export const hasDatesChip = (draft: AskDraft) =>
  draft.some((part) => part.kind === 'mention' && datesOf(part.target) !== null)
