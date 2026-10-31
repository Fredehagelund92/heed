import type { AnswerState } from './ask'
import type { Validity } from './validity'
import type { SavedResult } from './saved-questions'

// A suggestion's review as the app reads it (src/web/api): the change split into blocks by kind,
// what agents say before and after, and what to watch for. Pure types and the rules that follow
// from a review's fields; in Heed the blocks come from diffing the parsed document (words,
// formatting, links and order told apart deterministically, no model).

/** A run of text in a change: unchanged, added, removed, or the same words formatted differently. */
export type Seg = { t: 'same' | 'add' | 'del' | 'fmt'; text: string; note?: string }

/**
 * Text with marks, so the data stays readable: [-removed-], {+added+}, {*formatted|what changed*}.
 */
export function marks(s: string): Seg[] {
  const out: Seg[] = []
  const re = /\[-([\s\S]+?)-\]|\{\+([\s\S]+?)\+\}|\{\*([\s\S]+?)\*\}/g
  let last = 0
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push({ t: 'same', text: s.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'del', text: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'add', text: m[2] })
    else {
      const [text = '', note] = m[3]!.split('|')
      out.push({ t: 'fmt', text, note })
    }
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: 'same', text: s.slice(last) })
  return out
}

/** "1 link", "2 links", "3 dates", "2 wording": a count of changes of one kind. */
export function countWord(kind: ChangeKind, n: number) {
  const w = kind.toLowerCase()
  if (n === 1) return w.replace(/s$/, '')
  return kind === 'Link' || kind === 'Order' ? `${w}s` : w
}

/** The quiet label each change block carries. */
export type ChangeKind = 'Wording' | 'Formatting' | 'Link' | 'Order' | 'Added' | 'Removed' | 'Dates'

export type Block =
  | { kind: 'Wording' | 'Added' | 'Removed'; field: string; text: string }
  | {
      kind: 'Formatting'
      field: string
      label: string
      text: string
      list?: { ordered: boolean; was: 'bullets' | 'numbers'; items: string[] }
    }
  | { kind: 'Link'; field: string; text: string; before: string; after: string }
  /** An @ link added or removed in the text: what an agent can follow from the item changes. */
  | {
      kind: 'Link'
      field: string
      text: string
      mention: { id: string; label: string; change: 'added' | 'removed' }
    }
  | { kind: 'Order'; field: string; label: string; steps: { text: string; from?: number }[] }
  | {
      kind: 'Dates'
      field: string
      before: string
      after: string
      /**
       * The days of the month it starts, ended and now ends, for the small timeline; left out
       * when the change spans more than one month.
       */
      span?: { from: number; was: number; now: number; month: string }
    }

export type Answer = { state: AnswerState; text: string }

/**
 * One side of a suggestion's fields, as the Fields table compares them: the version agents get
 * now, or the suggested one, in the words people read (the kind's name, the domain and the owner
 * by name, what it applies to by name). Dates are stored dates; `validity.until` is its last day.
 */
export type FieldSide = {
  title: string
  kind: string
  domain: string
  owner: string
  scope: string[]
  validity: Validity
  reviewDate?: string
  sources: { url: string; quote?: string }[]
  dontConclude: string
}

export type Review = {
  /** The Inbox card this review is for. */
  id: string
  title: string
  from: string
  agent?: string
  via: string
  on: string
  note?: string
  mode: 'edit' | 'new' | 'retire'
  /** Drafted for a Not found card: how many questions it answers, and what it was drafted from. Nobody wrote it. */
  drafted?: { questions: number; scope: string; from: string }
  /** A suggestion a sync created from a document: where it came from, and the quote Heed kept. */
  synced?: { tool: string; folder: string; doc: string; read: string; quote: string }
  /** One sentence: what changes, said before any mark is shown. */
  summary: string
  /** Counts by kind, for the summary line. */
  counts: { kind: ChangeKind; n: number }[]
  /** The values that moved, pulled out: Number 312 to 340. */
  moved: { label: string; before?: string; after: string }[]
  blocks: Block[]
  unchanged: string[]
  formattingOnly?: boolean
  /** A long rewrite: side by side, with where the changes sit. */
  rewrite?: { field: string; before: string; after: string; changes: number }
  /** An agent's suggestion: each claim against the sentence the agent copied from the source. */
  claims?: {
    sentence: string
    rows: { claim: string; source: string; same: 'same' | 'different' | 'check' }[]
  }
  /**
   * Overlaps live context: the suggestion's words once, and each live item it overlaps, which the
   * owner answers on its own. Publish sends each answer for its own item.
   */
  clash?: {
    mine: string
    items: { factId: string; title: string; theirs: string; relation?: Relation }[]
  }
  retire?: {
    factId: string
    reason: string
    used: number
    checkFirst: string
    /** The proposer took it back in the comments: the review shows that, and Archive steps back. */
    withdrawn?: { by: string; when: string; quote: string }
  }
  tryIt: { question: string; before: Answer; after: Answer; reach: number }
  /**
   * Every field of both versions, for the Fields table: before is null for a new item, after is
   * null for an archive.
   */
  fields: { before: FieldSide | null; after: FieldSide | null }
  /**
   * The two versions the review compares: the one agents get now (null for a new item) and the
   * suggested one (null for an archive). A thread on a line or a field names them.
   */
  versions: { before: string | null; after: string | null }
  /** The stored markdown of each version, mentions as the app's tokens, for the Text diff. */
  source: { before: string; after: string }
  /**
   * The Ready line as the service says it, where the service decides the publish rules: it holds
   * over the one worked out here from the fields above.
   */
  ready?: Readiness
  /** How long the change must be on screen to count as read, as the service says it. */
  readMs?: number
  /**
   * The saved questions that answer from its item, checked against the draft, as the service
   * says it (FR-526): it holds over the check worked out here (lib/saved-check.ts).
   */
  saved?: { id: string; result: SavedResult; why: string; before: string; now: string }[]
}

/** How a suggestion that overlaps a live item relates to it, as the owner chose. */
export type Relation = 'replaces' | 'disagree' | 'unrelated'

/** The claims an agent or a draft makes that the copied sentence doesn't plainly say. */
export const claimsToCheck = (r: Review) =>
  r.claims?.rows.filter((x) => x.same !== 'same').length ?? 0

/** What needs care, in a few words, for the quick view and the Inbox row: "2 claims to check". */
export function careLine(r: Review) {
  const n = claimsToCheck(r)
  if (n) return `${n} ${n === 1 ? 'claim' : 'claims'} to check`
  if (r.clash) return 'Overlaps live context'
  if (r.retire?.withdrawn) return `Withdrawn by ${r.retire.withdrawn.by}`
  return undefined
}

/** An edit's new numbers and dates that come without a source: no new source page came with them. */
function unsourced(r: Review) {
  if (r.mode !== 'edit') return []
  const newSource = r.blocks.some((b) => b.kind === 'Link' && 'after' in b)
  return newSource ? [] : r.moved.filter((m) => /number|date/i.test(m.label)).map((m) => m.after)
}

/** A changed link: someone should open the new page before it goes out. */
const changesALink = (r: Review) => r.blocks.some((b) => b.kind === 'Link' && 'after' in b)

const list = (xs: string[]) =>
  xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

/** `bulk` says whether it may go out with "Publish the ones you've read": not while something still needs a look. */
export type Readiness = { ok: boolean; title: string; text: string; bulk: boolean }

/**
 * The Ready line: what can honestly be said before publishing. Claims are checked only against a
 * copied sentence; a new number or date with no source says so, and only then. `relation` is what
 * the answers to a clash do, once every live item it overlaps has one (clashOutcome).
 */
export function readiness(r: Review, relation?: { hint: string } | null): Readiness {
  // The service's line, unless the owner has just answered a clash here: Publish then sends it.
  if (r.ready && !(r.clash && relation)) return r.ready
  const n = claimsToCheck(r)
  const no = (x: Omit<Readiness, 'bulk'>): Readiness => ({ ...x, bulk: false })
  if (r.drafted)
    return no({
      ok: false,
      title: 'A draft to check',
      text: 'Nobody has checked it yet. Read each claim against the source, edit what is off, then publish.',
    })
  if (r.claims)
    return no({
      ok: false,
      title: `Ready, with ${n === 1 ? 'a claim' : `${n} claims`} to check`,
      text: `${n === 1 ? "One claim isn't" : `${n} claims aren't`} plainly in the copied sentence. Return it with a note, or publish anyway if you know it's right.`,
    })
  if (r.clash)
    return relation
      ? no({ ok: true, title: 'Ready', text: relation.hint })
      : no({
          ok: false,
          title: 'Not ready: choose how they relate',
          text:
            r.clash.items.length === 1
              ? 'Publish waits until you say how this relates to the live item.'
              : `Publish waits until you say how this relates to each of the ${r.clash.items.length} live items.`,
        })
  if (r.retire?.withdrawn)
    return no({
      ok: false,
      title: `Withdrawn by ${r.retire.withdrawn.by}`,
      text: 'In the comments they chose to suggest new dates instead. Close the suggestion, or archive anyway if you disagree.',
    })
  if (r.retire)
    return no({
      ok: true,
      title: 'Ready to archive',
      text: 'Nothing else depends on it. Questions it answered get Not found.',
    })
  const values = unsourced(r)
  if (values.length)
    return no({
      ok: false,
      title: 'Ready, not checked against a source',
      text: `Nothing compares ${list(values)} with a source. Check it, or return it with a note.`,
    })
  if (changesALink(r))
    return no({
      ok: true,
      title: 'Ready',
      text: r.counts.every((c) => c.kind === 'Link')
        ? 'The words are the same. Open the new page to check it says the same thing.'
        : 'The new values come with a new source page. Open it to check them.',
    })
  if (r.formattingOnly)
    return {
      ok: true,
      title: 'Ready',
      text: 'The words are the same; only the layout changes.',
      bulk: true,
    }
  if (r.counts.every((c) => c.kind === 'Order'))
    return {
      ok: true,
      title: 'Ready',
      text: 'The words are the same; only the order changes.',
      bulk: true,
    }
  if (r.synced)
    return {
      ok: true,
      title: 'Ready',
      text: 'It says what the quoted document says. Who owns it is yours to decide.',
      bulk: true,
    }
  return { ok: true, title: 'Ready', text: 'It reaches the questions it is meant for.', bulk: true }
}
