/**
 * The names a read makes (FR-141): each member of a definition source that no live term names,
 * as the term it would be, sorted into what an owner accepts with one press and what they must
 * look at first. One word has one meaning across the workspace (FR-138), so a name that would give
 * a word a second meaning is flagged, never picked: it stays out of Accept all, with the name
 * `termCandidates` offers for it, until an owner accepts or changes it. A date or an id stays out
 * by itself, since an item's dates and its scope cover those, and so does a member an owner left
 * out; while the card is open, either can still be accepted one by one. Dates and ids alone never
 * raise the card.
 *
 * Pure: the service and the mock binding make the same names from the same members.
 */
import {
  memberName,
  termCandidates,
  type CandidateMember,
  type KnownTerm,
  type TermCandidate,
} from './term-candidates.ts'
import {
  TERM_NAME_MAX,
  termName,
  termNamePattern,
  termWord,
  wordRefusal,
  type WordHolder,
} from './terms.ts'

/** Why a name needs an owner's eyes before it goes live. */
export const nameFlagCodes = ['taken', 'same_name', 'titles_differ', 'bad_name'] as const
export type NameFlagCode = (typeof nameFlagCodes)[number]
export type NameFlag = { code: NameFlagCode; message: string }

/** `ready` goes with Accept all, `flagged` waits for a look, `left_out` is only there to add. */
export const nameStates = ['ready', 'flagged', 'left_out'] as const
export type NameState = (typeof nameStates)[number]

export type SourceName = TermCandidate & {
  state: NameState
  flags: NameFlag[]
  /** Whether an owner left it out, rather than it being a date or an id. */
  leftByOwner: boolean
}

/** What has each word now, by its compared form: terms, synonyms and live vocabulary. */
export type WordHolders = ReadonlyMap<string, readonly WordHolder[]>

const quoted = (names: readonly string[]) => names.map((name) => `“${name}”`).join(' and ')

/** The name a candidate's members give it, before `termCandidates` told it from another. */
function plainName(candidate: TermCandidate, members: ReadonlyMap<string, CandidateMember>) {
  const member = candidate.definitionRefs.flatMap((ref) => members.get(ref) ?? [])[0]
  return member ? memberName(member) : candidate.name
}

/**
 * Who gives a word another meaning: a term people wrote, or a live name of another metric or
 * dimension. What a source calls a live term is left out: nobody reads a word by it, so an owner
 * who renamed one of two "Revenue"s can give the word to the other.
 */
const othersOf = (key: string, word: string, holders: WordHolders) =>
  (holders.get(word) ?? []).filter(
    (holder) => holder.origin === 'term' || (holder.origin === 'vocabulary' && holder.ref !== key),
  )

/**
 * The names the members make, given the live terms, what holds each word and the members owners
 * left out. A dimension's other names that another meaning has already are dropped, as `termCandidates`
 * drops them between members (CON-201): an owner adds one by hand to the term it belongs to.
 * Metrics first, then dimensions, each by name.
 */
export function sourceNames(
  members: readonly CandidateMember[],
  known: readonly KnownTerm[],
  holders: WordHolders,
  leftOut: ReadonlySet<string>,
): SourceName[] {
  const byRef = new Map(members.map((member) => [member.ref, member]))
  const live = new Map(known.map((term) => [term.key, term]))
  const base = termCandidates(members, known)
  const adds = (candidate: TermCandidate) =>
    candidate.definitionRefs.filter((ref) => !candidate.linked.includes(ref))
  const leftByOwner = (candidate: TermCandidate) => adds(candidate).every((ref) => leftOut.has(ref))
  // The names that claim words: those on offer, and a live name gaining a view.
  const claiming = base.filter(
    (candidate) => candidate.suggested && (candidate.linked.length || !leftByOwner(candidate)),
  )
  const claimedBy = new Map<string, Set<TermCandidate>>()
  for (const candidate of claiming) {
    const words = [
      ...(candidate.linked.length ? [] : [plainName(candidate, byRef)]),
      candidate.name,
      ...candidate.aliases,
    ].map(termWord)
    for (const word of words) claimedBy.set(word, (claimedBy.get(word) ?? new Set()).add(candidate))
  }
  // An other name goes to one meaning only: one that a term people wrote, a live name or another
  // name on offer has too goes to neither (CON-201). A live term keeps the ones it has.
  const candidates = base.map((candidate) => {
    const kept = new Set((live.get(candidate.key)?.aliases ?? []).map(termWord))
    return {
      ...candidate,
      aliases: candidate.aliases.filter((alias) => {
        const word = termWord(alias)
        if (kept.has(word)) return true
        const claimants = claimedBy.get(word)
        return (
          !othersOf(candidate.key, word, holders).length &&
          !(claimants && [...claimants].some((other) => other.key !== candidate.key))
        )
      }),
    }
  })
  const offered = new Set(
    candidates.filter(
      (candidate) => candidate.suggested && !leftByOwner(candidate) && !candidate.linked.length,
    ),
  )
  // Which of the names on offer read as one word, across kinds: "Orders", a metric and a dimension.
  const sharing = new Map<string, TermCandidate[]>()
  for (const candidate of offered) {
    const words = new Set(
      [plainName(candidate, byRef), candidate.name, ...candidate.aliases].map(termWord),
    )
    for (const word of words) sharing.set(word, [...(sharing.get(word) ?? []), candidate])
  }
  const flagsOf = (candidate: TermCandidate): NameFlag[] => {
    if (candidate.linked.length) {
      if (!candidate.suggested) return []
      const views = [
        ...new Set(
          adds(candidate).flatMap((ref) => {
            const member = byRef.get(ref)
            return member?.title && termWord(memberName(member)) !== termWord(candidate.name)
              ? [memberName(member)]
              : []
          }),
        ),
      ]
      return views.length
        ? [
            {
              code: 'titles_differ',
              message: `Its new views call it ${quoted(views)}, not “${candidate.name}”. It keeps the name it has.`,
            },
          ]
        : []
    }
    if (!offered.has(candidate)) return []
    const plain = plainName(candidate, byRef)
    const flags: NameFlag[] = []
    const shape = nameShapeRefusal(candidate.name)
    if (shape) flags.push({ code: 'bad_name', message: shape })
    const held = wordRefusal(plain, othersOf(candidate.key, termWord(plain), holders), null)
    if (held) flags.push({ code: 'taken', message: held.message })
    const others = (sharing.get(termWord(plain)) ?? []).filter((other) => other !== candidate)
    if (others.length)
      flags.push({
        code: 'same_name',
        message: `${others.length === 1 ? 'Another definition is' : `${others.length} others are`} called “${plain}”: ${others
          .map((other) => byRef.get(other.definitionRefs[0]!)?.name ?? other.key)
          .join(', ')}.`,
      })
    const titles = [
      ...new Set(
        candidate.definitionRefs.flatMap((ref) => {
          const member = byRef.get(ref)
          return member?.title ? [memberName(member)] : []
        }),
      ),
    ]
    if (titles.length > 1)
      flags.push({
        code: 'titles_differ',
        message: `Its views call it ${quoted(titles)}. Choose the one people say.`,
      })
    return flags
  }
  return candidates.map((candidate) => {
    const flags = flagsOf(candidate)
    return {
      ...candidate,
      state:
        candidate.linked.length || offered.has(candidate)
          ? flags.length
            ? 'flagged'
            : 'ready'
          : 'left_out',
      flags,
      leftByOwner: leftByOwner(candidate) && candidate.suggested,
    }
  })
}

/** What is wrong with the shape of a name, whatever else holds its word; null when it is fine. */
function nameShapeRefusal(name: string): string | null {
  const said = termName(name)
  if (!termWord(said)) return 'Give it a name.'
  if (said.length > TERM_NAME_MAX) return `A name can be ${TERM_NAME_MAX} characters at most.`
  if (!termNamePattern.test(said)) return 'A name holds no comma or line break.'
  return null
}

/** Why a name can't be accepted as it stands, in one sentence; null when it can. */
export function nameRefusal(
  key: string,
  name: string,
  holders: WordHolders,
  chosen: ReadonlyMap<string, readonly string[]>,
): string | null {
  const shape = nameShapeRefusal(name)
  if (shape) return shape
  const said = termName(name)
  const word = termWord(said)
  const held = wordRefusal(said, othersOf(key, word, holders), null)
  if (held) return held.message
  const mine = new Set((chosen.get(key) ?? [said]).map(termWord))
  for (const [other, otherWords] of chosen)
    if (other !== key) {
      const shared = otherWords.find((w) => mine.has(termWord(w)))
      if (shared !== undefined)
        return `You gave two definitions the word “${shared}”. One word has one meaning.`
    }
  return null
}

/** The compared forms of the names a list of terms goes by. */
export function wordsOf(terms: readonly Pick<TermCandidate, 'name' | 'aliases'>[]): string[] {
  return [...new Set(terms.flatMap((term) => [term.name, ...term.aliases]).map(termWord))]
}
