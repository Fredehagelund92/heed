/** Shared presentation for compare, the feed and the dock. No reads or page state. */
import type { ContractRouterClient } from '@orpc/contract'
import type { Contract } from '../../contract/index'
import {
  editionChangeKinds,
  noChanges,
  type ChangeCounts,
  type EditionChangeKind,
} from '@domain/editions'
import type { CreationChannel } from '@domain/item'

// Exactly the generated client's responses, not a second set of UI payloads.
type EditionsClient = ContractRouterClient<Contract>['editions']
export type ItemComparison = Awaited<ReturnType<EditionsClient['compareItem']>>
export type EditionComparison = Awaited<ReturnType<EditionsClient['compare']>>
export type EditionSummary = Awaited<ReturnType<EditionsClient['feed']>>['entries'][number]
export type ItemChange = NonNullable<ItemComparison['change']>

export const changeLabels: Record<EditionChangeKind, string> = {
  added: 'Added',
  changed: 'Changed',
  checked: 'Checked, still correct',
  resaved: 'Saved again, nothing different',
  retired: 'Archived',
  removed: 'No longer shared',
}

/** Counts only the supplied facts. A page uses the endpoint's full counts instead. */
export function countItemChanges(items: readonly Pick<ItemChange, 'change'>[]): ChangeCounts {
  const counts = noChanges()
  for (const item of items) counts[item.change] += 1
  return counts
}

export function changeCountParts(counts: ChangeCounts) {
  return editionChangeKinds
    .filter((kind) => counts[kind] > 0)
    .map((kind) => ({
      kind,
      count: counts[kind],
      text: `${counts[kind].toLocaleString('en')} ${changeLabels[kind].toLowerCase()}`,
    }))
}

export function itemChangeSentence(change: ItemChange): string {
  switch (change.change) {
    case 'added':
      return 'Added. Agents get this fact from this edition on.'
    case 'retired':
      return 'Archived. Agents no longer get this fact. Its history stays.'
    case 'removed':
      return 'Agents no longer get this fact in this edition. Its history stays.'
    case 'resaved':
      return 'Saved again, nothing different. What agents read is the same.'
    case 'checked':
      return 'Checked, still correct. The content stays the same.'
    case 'changed':
      return 'The fields below show what changed.'
  }
}

/** The capacity a decision was made in, as people say it: an owner, an approver, an admin. */
const capacityWords: Record<ItemChange['why']['decisions'][number]['capacity'], string> = {
  owner: 'owner',
  deputy: 'owner',
  approver: 'approver',
  administrator: 'admin',
}

const channelWords: Record<CreationChannel, string> = {
  form: 'the form',
  assistant: 'the assistant',
  chat: 'chat',
  mcp: 'an agent',
  import: 'an import',
  command_line: 'the command line',
  source: 'a content source',
}

/** Missing names are explicit, never internal identifiers or a guessed service actor. */
export function changeAttribution(
  why: ItemChange['why'],
  nameOf: (id: string) => string | null,
): string[] {
  const name = (id: string) => nameOf(id) ?? 'a person whose name is unavailable'
  const lines: string[] = []
  if (why.proposerId) {
    lines.push(
      `Proposed by ${name(why.proposerId)}${why.channel ? ` through ${channelWords[why.channel]}` : ''}.`,
    )
  }
  if (why.editedBy) lines.push(`Edited during review by ${name(why.editedBy)}.`)
  for (const decision of why.decisions) {
    lines.push(
      `${decision.outcome === 'retire' ? 'Archived' : 'Accepted'} by ${name(decision.decidedBy)} as ${capacityWords[decision.capacity]}.`,
    )
    if (decision.reason.trim()) lines.push(`Why: ${decision.reason.trim()}`)
  }
  if (!why.decisions.length) lines.push('No decision on record for this change.')
  return lines
}

/** The service owns the classification of system fields, including future fields. */
export function partitionEditionFields(fields: ItemComparison['fields']) {
  return {
    content: fields.filter((field) => !field.systemFilled),
    system: fields.filter((field) => field.systemFilled),
  }
}
