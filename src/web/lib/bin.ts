import type { BinRestoreResult, RescueChange } from '@/api'
import { formatDay } from '@/lib/library'

/*
  The Bin's words. An item whose domain was deleted is restored into another domain (FR-814): it
  comes back retired, and a proposal opens there with its last content, fitted to that domain.
  The Restore dialog names each change the domain needs, one line each, before anyone confirms.
*/

const countOf = (count: number) => `${count.toLocaleString('en')} ${count === 1 ? 'fact' : 'facts'}`

/** One change restoring an item into another domain makes, as the Restore dialog lists it. */
export function rescueChangeLine(change: RescueChange): { label: string; words: string } {
  const { before, after } = change
  switch (change.field) {
    case 'domain':
      return { label: 'Domain', words: `${before} is deleted, so it moves to ${after}` }
    case 'owner':
      return {
        label: 'Owner',
        words: before
          ? `${after}, an owner there, takes over from ${before}`
          : `${after}, an owner there`,
      }
    case 'scope':
      return {
        label: 'Where it applies',
        words: `${before} is removed: it's no longer in the catalogue`,
      }
    case 'references':
      return {
        label: 'Definition',
        words: `${before} is removed: its source no longer has it`,
      }
    case 'mentions':
      return {
        label: 'Mention',
        words: `${before} becomes plain text: it's no longer there`,
      }
    case 'conflicts':
      return { label: 'Conflict', words: `${before} is removed: it's no longer accepted` }
    case 'reviewDate':
      return {
        label: 'Check date',
        words: `${formatDay(before!)} has passed, so it becomes ${formatDay(after!)}`,
      }
  }
}

/** The toast after a restore: what came back, what AI apps get again, and the proposals opened. */
export function restoredWords(
  result: BinRestoreResult,
  /** The domain the items of a deleted domain went to, by name. */
  domain?: string,
): { title: string; description: string } {
  const count = result.restored.length
  const opened = result.proposals.length
  const title = count === 1 ? 'Fact restored' : `${countOf(count)} restored`
  const served = result.edition
    ? `AI apps get ${count - opened === 1 ? 'it' : 'them'} again.`
    : null
  if (!opened)
    return {
      title,
      description: served ?? `${count === 1 ? "It's" : "They're"} back in the library, archived.`,
    }
  const where = domain ? ` of ${domain}` : ''
  const proposals =
    opened === 1
      ? `${count === 1 ? "It's" : 'One is'} back, archived. Proposal #${result.proposals[0]!.number} waits for the owners${where}.`
      : `${countOf(opened)} are back, archived, each with a proposal for the owners${where}.`
  return { title, description: served ? `${served} ${proposals}` : proposals }
}
