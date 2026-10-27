/*
  The Inbox's rules (docs/product.md, section 5): cards grouped by need, in the mockup's order,
  what each card's one decision is, and the steps of a new workspace's setup checklist. Pure:
  the service reads the records, this says how they line up.
*/

/**
 * The groups, in the order of need: what agents couldn't answer first, then what people reported,
 * saved questions that answer worse, comments that mention the person, items due for a check, and
 * suggestions last. Under All: what the person sent that waits on others, and what is done.
 */
export const cardGroups = [
  'gap',
  'flag',
  'look',
  'mention',
  'check',
  'suggestion',
  'waiting',
  'done',
] as const
export type CardGroup = (typeof cardGroups)[number]

/** The decision a card offers besides opening what it is about (FR-616, FR-618, CON-211, FR-218). */
export const cardActions = ['not_written', 'not_a_problem', 'still_true', 'archive'] as const
export type CardAction = (typeof cardActions)[number]

/** Which card each decision belongs to: a Not found, a Reported, or a Due for a check card. */
export const actionGroup: Record<CardAction, 'gap' | 'flag' | 'check'> = {
  not_written: 'gap',
  not_a_problem: 'flag',
  still_true: 'check',
  archive: 'check',
}

/** A card's name, by what it shows: stable across reads, so a read receipt or a closing finds it. */
export const cardKey = {
  proposal: (id: string) => `proposal:${id}`,
  gap: (id: string) => `gap:${id}`,
  feedback: (id: string) => `feedback:${id}`,
  check: (itemId: string) => `check:${itemId}`,
}

/** What a card's name says it is, or null for a name that is none of them. */
export function parseCardKey(
  key: string,
): { kind: 'proposal' | 'gap' | 'feedback' | 'check'; id: string } | null {
  const match = /^(proposal|gap|feedback|check):(.+)$/.exec(key)
  return match
    ? { kind: match[1] as 'proposal' | 'gap' | 'feedback' | 'check', id: match[2]! }
    : null
}

/**
 * Cards by need, then newest first within a group, then by name, so two reads of the same records
 * give the same order. A done card goes under Done, whatever it was.
 */
export function byNeed<T extends { group: CardGroup; at: string; id: string; done: unknown }>(
  cards: readonly T[],
): T[] {
  const rank = (card: T) => cardGroups.indexOf(card.done ? 'done' : card.group)
  return [...cards].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** How many cards each group holds, in the groups' order, groups with none left out. */
export function groupCounts<T extends { group: CardGroup; done: unknown }>(
  cards: readonly T[],
  waiting = 0,
): { group: CardGroup; count: number }[] {
  const counts = new Map<CardGroup, number>()
  for (const card of cards) {
    const group = card.done ? 'done' : card.group
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  if (waiting) counts.set('waiting', waiting)
  return cardGroups
    .filter((g) => counts.has(g))
    .map((group) => ({ group, count: counts.get(group)! }))
}

/**
 * The setup checklist of a new workspace (FR-816): write first, connect later. Say what the
 * business is about, write one context item, ask about it in Ask, connect an agent, connect where
 * metrics are defined.
 */
export const setupSteps = ['about', 'fact', 'ask', 'agent', 'definitions'] as const
export type SetupStep = (typeof setupSteps)[number]
