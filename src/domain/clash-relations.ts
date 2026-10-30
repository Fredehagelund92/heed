/*
  How a suggestion relates to a live item it clashes with (FR-225), and the words for each answer.
  Its own file, with no imports, so the web app's review model reads the words without the rest of
  the Ready line (readiness.ts) in its first load.
*/
/** How a suggestion relates to a live item it clashes with (FR-225). */
export const clashRelations = ['replaces', 'disagrees', 'unrelated'] as const
export type ClashRelation = (typeof clashRelations)[number]

/** Each answer as the review offers it, and what it does when the suggestion is published. */
export const relationWords: Record<ClashRelation, { label: string; hint: string }> = {
  replaces: { label: 'This replaces it', hint: 'The live item is archived when you publish.' },
  disagrees: { label: 'These disagree', hint: 'Both stay; agents say context disagrees.' },
  unrelated: { label: 'Unrelated', hint: 'Both stay; they apply to different things.' },
}
