/*
  The Ready line of the review (design contract, section 5.3): what can honestly be said about a
  suggestion before it is published, from its difference (doc-diff.ts), its claims against the
  copied sentence (claim-check.ts) and any clash with live context. It never says more than was
  checked: a new number or date without a new source says "not checked against a source", and
  only then.

  It also decides two rules of publishing:
  - only a clash with no answer holds Publish (FR-225): an unverified claim, a draft or a
    withdrawn retirement may still be published, by an owner who knows it is right;
  - "Publish the N you've read" takes only plain changes (FR-226): never a draft, a claim, a
    clash, a retirement, an unchecked value or a new link.

  Pure: no clock, no input or output. The words are the web app's (glossary v2).
*/
import type { ClaimRow } from './claim-check.ts'
import { claimsToCheck } from './claim-check.ts'
import { longDayWords } from './dates.ts'
import type { DocDiff } from './doc-diff.ts'

/** How a suggestion relates to a live item it clashes with (FR-225). */
export const clashRelations = ['replaces', 'disagrees', 'unrelated'] as const
export type ClashRelation = (typeof clashRelations)[number]

/** Each answer as the review offers it, and what it does when the suggestion is published. */
export const relationWords: Record<ClashRelation, { label: string; hint: string }> = {
  replaces: { label: 'This replaces it', hint: 'The live item is archived when you publish.' },
  disagrees: { label: 'These disagree', hint: 'Both stay; agents say context disagrees.' },
  unrelated: { label: 'Unrelated', hint: 'Both stay; they apply to different things.' },
}

export type ReadinessInput = {
  diff: DocDiff
  /** Drafted for a Not found card: nobody wrote it. */
  drafted: boolean
  /** Its claims against the copied sentence, when an agent or a draft brought one; else null. */
  claims: readonly ClaimRow[] | null
  /** A live item it clashes with, and the owner's answer once given. */
  clash: { itemId: string; relation: ClashRelation | null } | null
  /** A retirement its proposer took back in the comments. */
  withdrawn: boolean
  /** Made by a read of a document, never by a person. */
  synced: boolean
}

export const readinessStates = [
  'draft',
  'claims',
  'clash',
  'related',
  'withdrawn',
  'archive',
  'unsourced',
  'link',
  'layout',
  'order',
  'synced',
  'ready',
] as const
export type ReadinessState = (typeof readinessStates)[number]

export type Readiness = {
  state: ReadinessState
  /** It reads as Ready. */
  ok: boolean
  /** It may go out with "Publish the N you've read" (FR-226). */
  bulk: boolean
  /** Publish is open: only a clash with no answer holds it (FR-225). */
  publishable: boolean
  /** Claims the copied sentence does not plainly say. */
  claimsToCheck: number
  /** New numbers and dates of an edit that came without a new source, in their words. */
  unsourced: string[]
  relation: ClashRelation | null
}

/** A changed or added address: someone should open the page before it goes out. */
const newLink = (diff: DocDiff) =>
  diff.blocks.some((b) => b.kind === 'link' && 'after' in b && b.after !== null)

/** An edit's new numbers and dates, when no new source came with them. */
function unsourcedValues(diff: DocDiff): string[] {
  if (diff.mode !== 'edit' || newLink(diff)) return []
  return diff.values
    .filter((v) => (v.what === 'number' || v.what === 'date') && v.after !== null)
    .map((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v.after!) ? longDayWords(v.after!) : v.after!))
}

/** What can be said of a suggestion before it is published, and what publishing it may do. */
export function readiness(input: ReadinessInput): Readiness {
  const { diff } = input
  const toCheck = input.claims ? claimsToCheck(input.claims) : 0
  const relation = input.clash?.relation ?? null
  const base = {
    claimsToCheck: toCheck,
    unsourced: [] as string[],
    relation,
    publishable: !input.clash || relation !== null,
  }
  const out = (state: ReadinessState, ok: boolean, bulk = false): Readiness => ({
    ...base,
    state,
    ok,
    bulk,
  })
  if (input.drafted) return out('draft', false)
  if (toCheck) return out('claims', false)
  if (input.clash) return relation ? out('related', true) : out('clash', false)
  if (diff.mode === 'retire')
    return input.withdrawn ? out('withdrawn', false) : out('archive', true)
  const unsourced = unsourcedValues(diff)
  if (unsourced.length) return { ...out('unsourced', false), unsourced }
  if (newLink(diff)) return out('link', true)
  if (diff.only === 'formatting') return out('layout', true, true)
  if (diff.only === 'order') return out('order', true, true)
  if (input.synced) return out('synced', true, true)
  return out('ready', true, true)
}

/** Whether it needs care before publishing: a claim to check, or a clash with live context. */
export const needsCare = (r: Pick<Readiness, 'claimsToCheck' | 'state' | 'relation'>) =>
  r.claimsToCheck > 0 || r.state === 'clash' || r.state === 'related'

const list = (xs: readonly string[]) =>
  xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/** The Ready line in words: its title and the sentence under it. */
export function readinessWords(
  r: Readiness,
  context: {
    withdrawnBy?: string
    diff?: Pick<DocDiff, 'counts'>
    /** How many live items it clashes with: each needs its own answer. */
    clashes?: number
  } = {},
): { title: string; text: string } {
  const n = r.claimsToCheck
  switch (r.state) {
    case 'draft':
      return {
        title: 'A draft to check',
        text: 'Nobody has checked it yet. Read each claim against the source, edit what is off, then publish.',
      }
    case 'claims':
      return {
        title: `Ready, with ${n === 1 ? 'a claim' : `${n} claims`} to check`,
        text: `${n === 1 ? "One claim isn't" : `${n} claims aren't`} plainly in the copied sentence. Return it with a note, or publish anyway if you know it's right.`,
      }
    case 'clash':
      return {
        title: 'Not ready: choose how they relate',
        text:
          (context.clashes ?? 1) > 1
            ? `Publish waits until you say how this relates to each of the ${context.clashes} live items.`
            : 'Publish waits until you say how this relates to the live item.',
      }
    case 'related':
      return { title: 'Ready', text: relationWords[r.relation!].hint }
    case 'withdrawn':
      return {
        title: `Withdrawn by ${context.withdrawnBy ?? 'the person who suggested it'}`,
        text: 'In the comments they chose to suggest something else. Close the suggestion, or archive anyway if you disagree.',
      }
    case 'archive':
      return {
        title: 'Ready to archive',
        text: 'Nothing else depends on it. Questions it answered get Not found.',
      }
    case 'unsourced':
      return {
        title: 'Ready, not checked against a source',
        text: `Nothing compares ${list(r.unsourced)} with a source. Check it, or return it with a note.`,
      }
    case 'link':
      return {
        title: 'Ready',
        text: context.diff?.counts.every((c) => c.kind === 'link')
          ? 'The words are the same. Open the new page to check it says the same thing.'
          : 'The new values come with a new source page. Open it to check them.',
      }
    case 'layout':
      return { title: 'Ready', text: 'The words are the same; only the layout changes.' }
    case 'order':
      return { title: 'Ready', text: 'The words are the same; only the order changes.' }
    case 'synced':
      return {
        title: 'Ready',
        text: 'It says what the quoted document says. Who owns it is yours to decide.',
      }
    case 'ready':
      return { title: 'Ready', text: 'It reaches the questions it is meant for.' }
  }
}

/**
 * How long a change has to be on screen before it counts as read (FR-226): longer for more words,
 * from a second and a half for a date to eight seconds for a long rewording. Opening a suggestion
 * is not reading it.
 */
export const readTimeMs = (storedMarkdown: string) =>
  Math.min(8000, Math.max(1500, 1000 + 12 * storedMarkdown.length))
