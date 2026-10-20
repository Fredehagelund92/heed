import { limits } from './proposal-rules.ts'

/*
  How to write a context item, for any AI that drafts one for a person. The assistant's
  instructions, its create_draft tool and the MCP tool draft_context all carry these same words,
  so what the three ask for cannot drift apart. The limits are the attribute table's
  (./proposal-rules.ts). Each tool says in its own input how to flag uncertain dates.
*/

/** The rules, one sentence each, in the order a draft is written. */
export const draftingRules = [
  `The summary is what agents read first: at most ${limits.summary} characters, in plain words, saying what happened, where and when, so that it stands alone.`,
  'Detail, caveats and what the item does not mean go in the body and in what not to conclude, never in the summary.',
  'Claim no cause unless the source states one.',
  'Name metrics and markets as the person does: the product matches their names to its own, so never invent a key.',
  'When the person is unsure of the date or gives none, draft anyway with your best start date, flag the dates as uncertain and say what you assumed; ask only for what you cannot fill.',
  'One fact per item: two things that happened are two items.',
] as const

/** The rules as one paragraph, for an instruction or a tool description. */
export const draftingGuide = `How to write a draft: ${draftingRules.join(' ')}`

/** The summary's length as the format check counts it: in characters (code points). */
export const summaryLength = (summary: string) => [...summary].length

/**
 * Why a summary cannot be saved as it is, in words an AI can act on, or null when it fits. The
 * draft is refused rather than cut, so the writer shortens it and nothing is lost.
 */
export function summaryProblem(summary: string | undefined): string | null {
  if (summary === undefined) return null
  const length = summaryLength(summary)
  if (length <= limits.summary) return null
  return `The summary has ${length} characters; it may have at most ${limits.summary}. Shorten it to what happened, where and when, and move the detail, caveats and what it does not mean into the body.`
}
