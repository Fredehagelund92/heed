import { dayWords } from './dates.ts'
import { concepts } from './words.ts'

/*
  Reviewed before served: how a fact an agent receives was reviewed (FR-326, amended 18 Oct
  2026). Every delivered item says it was accepted, on which day, by which role in which domain,
  and in which edition. What an agent receives names the role ("the owner of Sales"),
  never the person; inside Heed, behind sign-in, the review stamp may name the person too
  (design contract 7.2, `ReviewStamp`).
*/

/** The capacity an acceptance was decided in. An approver's decision is a second key, never the acceptance. */
export type AcceptedAs = 'owner' | 'deputy' | 'administrator'

/** How a served item version was accepted: the decision's day, capacity and domain, and the edition that first served it. */
export type ServedReview = {
  /** The UTC day of the accept decision. */
  acceptedOn: string
  acceptedAs: AcceptedAs
  /** The domain the decision was made in. */
  areaId: string
  /** The first edition that served this version. */
  edition: string
}

/** The id a proposal's own item has in its preview: the item it changes, or the new one it makes. */
export const previewItemId = (proposal: { id: string; itemId?: string | null }) =>
  proposal.itemId ?? `itm_${proposal.id.replaceAll('-', '').slice(-16)}`

/** Who looks after a domain's items, as a role: "the owner of Sales". */
export const ownerRole = (domain: string) => `the ${concepts.owner.name} of ${domain}`

/** The role that accepted a version, as agents read it: the owner of the domain (a deputy decided as one), or an admin. */
export const acceptedByRole = (as: AcceptedAs, domain: string) =>
  as === 'administrator' ? `an ${concepts.admin.name}` : ownerRole(domain)

/** A review in one sentence: "Accepted 12 Jun 2026 by the owner of Sales, in edition 2026-06-12.1." */
export const acceptedWords = (on: string, by: string, edition: string) =>
  `Accepted ${dayWords(on)} by ${by}, in edition ${edition}.`

/** A served review in one sentence, naming the role that accepted it. */
export const reviewedWords = (review: ServedReview, domain: string) =>
  acceptedWords(review.acceptedOn, acceptedByRole(review.acceptedAs, domain), review.edition)
