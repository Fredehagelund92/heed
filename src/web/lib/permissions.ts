/**
 * What the signed-in person may do, worked out from the roles the service returns with the
 * session. These answers decide what a screen offers (a Claim button, an Accept that names its
 * reason when blocked); the service checks every change again and its answer wins
 * (requirements, section 3; FR-202, FR-206, FR-207, FR-211, FR-218).
 */
import type { Permissions } from '../../contract/auth.ts'
import type { ProposalState } from '../../domain/proposal-state.ts'
import type { Area } from '../../domain/item.ts'

export type AreaRole = Permissions['assignments'][number]['role']
/**
 * The capacity a decision is made in: a role in the proposal's domain, or administrator, which
 * decides in every domain (FR-202).
 */
export type Capacity = AreaRole | 'administrator'

const areaRoleOrder: readonly AreaRole[] = ['owner', 'approver']
// The glossary's names (src/domain/words.ts).
const roleNames: Record<AreaRole, string> = {
  owner: 'Owner',
  approver: 'High-risk approver',
}

/** The roles a person holds in one area, owner first. */
export function capacitiesIn(permissions: Permissions, areaId: string | null): Capacity[] {
  const held = new Set(
    permissions.assignments
      .filter((assignment) => assignment.areaId === areaId)
      .map((assignment) => assignment.role),
  )
  return areaRoleOrder.filter((role) => held.has(role))
}

export const isAdmin = (permissions: Permissions) => permissions.roles.includes('administrator')

/** An owner of the area: claims, hands over, comments as reviewer, rechecks. */
export function canReview(permissions: Permissions, areaId: string | null): boolean {
  return capacitiesIn(permissions, areaId).includes('owner')
}

/**
 * Whether the person reviews anything: an owner or approver, or an administrator, who
 * decides the vocabulary terms no domain holds. To review is theirs.
 */
export function reviewsAnything(permissions: Permissions): boolean {
  return permissions.assignments.length > 0 || isAdmin(permissions)
}

/**
 * Who a page or a menu entry is for (Quality design, section 0; Workbench plan, 3.4; navigation
 * decision, 12 October 2026). Everyone signed in uses the main places, the assistant and their
 * own Settings. Health and Editions (`quality`) are for the owners of an area and
 * for administrators; the Gaps page's entry is for everyone else (`contributors`: people with no
 * area role, high-risk approvers and auditors), since Health holds the gaps for the people it is
 * for. Administration (`administration`) is for administrators, who run the workspace, and for
 * auditors, who read its history log. What only administrators may change (`administrators`) is
 * run by the data platform team for the first release.
 */
export type Audience = 'everyone' | 'quality' | 'contributors' | 'administration' | 'administrators'

const maintainsAnArea = (permissions: Permissions) =>
  isAdmin(permissions) || permissions.assignments.some((assignment) => assignment.role === 'owner')

/**
 * Whether the person may open what is meant for the audience. While the roles load
 * (`undefined`) only what is for everyone is, so an entry never shows and then goes. The service
 * checks again.
 */
export function isFor(permissions: Permissions | undefined, audience: Audience): boolean {
  if (audience === 'everyone') return true
  if (!permissions) return false
  if (audience === 'administrators') return isAdmin(permissions)
  if (audience === 'administration') return canReadAudit(permissions)
  if (audience === 'quality') return maintainsAnArea(permissions)
  return !maintainsAnArea(permissions)
}

/** FR-218: an owner or administrator retires an item at once. */
export function canRetire(permissions: Permissions, areaId: string): boolean {
  return canReview(permissions, areaId) || isAdmin(permissions)
}

/** FR-813: what a domain is, its owners or an administrator writes. */
export function canDescribe(permissions: Permissions, areaId: string): boolean {
  return canReview(permissions, areaId) || isAdmin(permissions)
}

/** The proposal states a test question can be attached or detached in: until a decision. */
const attachableStates: readonly ProposalState[] = [
  'draft',
  'submitted',
  'in_review',
  'changes_requested',
]

/**
 * FR-524: the draft's author attaches and detaches test questions while it is a draft; the area's
 * owners and administrators until a decision. Mirrors the service
 * (proposals/service.ts, `attachable`).
 */
export function canAttachTests(
  permissions: Permissions,
  personId: string,
  proposal: Pick<DecidableProposal, 'areaId' | 'proposerId' | 'state'>,
): boolean {
  if (!attachableStates.includes(proposal.state)) return false
  if (proposal.state === 'draft' && proposal.proposerId === personId) return true
  return isAdmin(permissions) || canReview(permissions, proposal.areaId)
}

/** FR-808: administrators and auditors read the history log. */
export function canReadAudit(permissions: Permissions): boolean {
  return isAdmin(permissions) || permissions.roles.includes('auditor')
}

export type DecisionCheck =
  { allowed: true; capacity: Capacity } | { allowed: false; reason: string }

export type DecidableProposal = {
  areaId: string | null
  proposerId: string
  state: ProposalState
  riskLevel: 'low' | 'normal' | 'high' | null
  claimedBy: string | null
}

/**
 * Whether the person may decide a proposal they made (FR-206): an administrator, in any domain,
 * and an owner of the proposal's domain. Mirrors the database (cl_decides_own).
 */
export function decidesOwn(permissions: Permissions, areaId: string | null): boolean {
  return isAdmin(permissions) || canReview(permissions, areaId)
}

/**
 * Whether the person may make this decision now, and in which capacity; or, when not, the
 * sentence a blocked button shows. Mirrors the service's rules (review/service.ts).
 */
export function canDecide(
  permissions: Permissions,
  personId: string,
  proposal: DecidableProposal,
  outcome: 'accept' | 'request_changes' | 'reject' = 'accept',
): DecisionCheck {
  if (proposal.state !== 'submitted' && proposal.state !== 'in_review')
    return { allowed: false, reason: "This proposal isn't waiting for a decision." }
  const capacities = capacitiesIn(permissions, proposal.areaId)
  // An owner of the domain, or an administrator in any: their own proposals too.
  const decider =
    capacities.find((capacity) => capacity !== 'approver') ??
    (isAdmin(permissions) ? 'administrator' : undefined)
  if (decider) {
    if (proposal.claimedBy && proposal.claimedBy !== personId)
      return { allowed: false, reason: 'Someone else has claimed this proposal.' }
    return { allowed: true, capacity: decider }
  }
  if (capacities.includes('approver')) {
    if (outcome !== 'accept' || proposal.riskLevel !== 'high')
      return {
        allowed: false,
        reason: 'A high-risk approver adds the second accept to a high-risk proposal only.',
      }
    if (proposal.proposerId === personId)
      return { allowed: false, reason: 'Someone else must accept a proposal you wrote.' }
    return { allowed: true, capacity: 'approver' }
  }
  return {
    allowed: false,
    reason: 'Only an owner or high-risk approver of the domain, or an admin, can decide.',
  }
}

/** A proposal as a list row knows it: enough to say whether the person may decide it there. */
export type ListedProposal = Pick<
  DecidableProposal,
  'areaId' | 'proposerId' | 'state' | 'riskLevel'
> & {
  subject: 'item' | 'vocabulary'
}

/** The roles that decide a proposal in its domain, an administrator for a term. */
export type DeciderRole = 'owner' | 'approver' | 'administrator'

/**
 * Who decides a proposal: the roles, in its domain (none for a term without one), and whether
 * its proposer is left out of them unless they are an administrator or an owner of its domain.
 */
export type Deciders = {
  roles: readonly DeciderRole[]
  areaId: string | null
  proposerExcluded: boolean
}

export type ListDecision =
  | { allowed: true }
  | {
      allowed: false
      /**
       * `waiting`: it waits for no decision; `proposer`: the person proposed it and is neither an
       * administrator nor an owner of its domain; `role`: no role.
       */
      why: 'waiting' | 'proposer' | 'role'
      deciders: Deciders
    }

/**
 * Whether the person may decide this proposal from a list (the review queue and Mine), so its row
 * can be selected for a bulk step (FR-223); and, when not, who can. The one place a list asks
 * this: the rule mirrors the service's bulk plan (review/service.ts), whose answer still wins and
 * names each proposal it leaves out. An administrator decides any proposal, and an owner of its
 * domain decides their own there; anyone else never decides their own (FR-206).
 */
export function canDecideInList(
  permissions: Permissions,
  personId: string,
  proposal: ListedProposal,
): ListDecision {
  const term = proposal.subject === 'vocabulary'
  const deciders: Deciders = {
    roles: term
      ? proposal.areaId
        ? ['owner', 'administrator']
        : ['administrator']
      : proposal.riskLevel === 'high'
        ? ['owner', 'approver', 'administrator']
        : ['owner', 'administrator'],
    areaId: proposal.areaId,
    proposerExcluded: true,
  }
  if (proposal.state !== 'submitted' && proposal.state !== 'in_review')
    return { allowed: false, why: 'waiting', deciders }
  const own = decidesOwn(permissions, proposal.areaId)
  if (proposal.proposerId === personId && !own) return { allowed: false, why: 'proposer', deciders }
  const decides =
    own ||
    (!term &&
      capacitiesIn(permissions, proposal.areaId).includes('approver') &&
      proposal.riskLevel === 'high')
  return decides ? { allowed: true } : { allowed: false, why: 'role', deciders }
}

const deciderNames: Record<DeciderRole, string> = {
  owner: 'owner',
  approver: 'high-risk approver',
  administrator: 'admin',
}

/**
 * Who decides, in words: "an owner of Search, or an admin". `areaName` null
 * says "its domain", for many proposals at once. When the person proposed it, a role they hold
 * there reads "another": they are not the one who decides.
 */
export function decidersWords(
  deciders: Deciders,
  areaName: string | null,
  { permissions, proposer = false }: { permissions?: Permissions; proposer?: boolean } = {},
): string {
  const held = new Set<DeciderRole>(
    permissions
      ? [
          ...capacitiesIn(permissions, deciders.areaId),
          ...(isAdmin(permissions) ? (['administrator'] as const) : []),
        ]
      : [],
  )
  const article = (role: DeciderRole) =>
    proposer && deciders.proposerExcluded && held.has(role) ? 'another' : 'a'
  const areaRoles = deciders.roles.filter((role) => role !== 'administrator')
  const parts: string[] = []
  if (areaRoles.length) {
    // "an owner or high-risk approver", or "another owner" when the person is one of them.
    const names = areaRoles.map((role) => deciderNames[role])
    const joined =
      names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)!}` : names[0]!
    const lead = areaRoles.some((role) => article(role) === 'another')
      ? 'another'
      : /^[aeiou]/i.test(joined)
        ? 'an'
        : 'a'
    parts.push(`${lead} ${joined} of ${areaName ?? 'its domain'}`)
  }
  if (deciders.roles.includes('administrator'))
    parts.push(article('administrator') === 'another' ? 'another admin' : 'an admin')
  return parts.join(', or ')
}

/** "… or an admin, can": a comma closes a list of deciders before its verb. */
const deciderSubject = (who: string) => (who.includes(', or ') ? `${who},` : who)

/** The deciders as the subject that starts a sentence: "An owner of Commercial, or an admin,". */
const deciderStart = (who: string) => {
  const subject = deciderSubject(who)
  return subject.charAt(0).toUpperCase() + subject.slice(1)
}

/**
 * Why the person cannot decide a proposal from a list, and who can, in one sentence: what a
 * disabled checkbox says.
 */
export function listDecisionWords(
  decision: Extract<ListDecision, { allowed: false }>,
  areaName: string | null,
  permissions?: Permissions,
): string {
  if (decision.why === 'waiting') return "It isn't waiting for a decision."
  const who = decidersWords(decision.deciders, areaName, {
    ...(permissions ? { permissions } : {}),
    proposer: decision.why === 'proposer',
  })
  return decision.why === 'proposer'
    ? `You can't decide a proposal you made. ${deciderStart(who)} can.`
    : `You can't decide this proposal. ${deciderStart(who)} can.`
}

/**
 * The line above a list whose waiting proposals the person cannot all decide: how many, why, and
 * who can, from each row's `canDecideInList`. Null when they can decide every one that waits.
 */
export function undecidableSummary(
  rows: readonly { decision: ListDecision; areaName: string }[],
  permissions: Permissions,
): string | null {
  const waiting = rows.filter((row) => row.decision.allowed || row.decision.why !== 'waiting')
  const denied = waiting.flatMap((row) =>
    row.decision.allowed ? [] : [{ decision: row.decision, areaName: row.areaName }],
  )
  if (!denied.length) return null
  const first = denied[0]!
  const same = denied.every(
    ({ decision }) =>
      decision.deciders.areaId === first.decision.deciders.areaId &&
      decision.deciders.roles.join() === first.decision.deciders.roles.join(),
  )
  const proposer = denied.every(({ decision }) => decision.why === 'proposer')
  const deciders: Deciders = same
    ? first.decision.deciders
    : {
        // Many domains: the roles any of them needs, in "its domain".
        roles: (['owner', 'approver', 'administrator'] as const).filter((role) =>
          denied.some(({ decision }) => decision.deciders.roles.includes(role)),
        ),
        areaId: null,
        proposerExcluded: denied.some(({ decision }) => decision.deciders.proposerExcluded),
      }
  const who = decidersWords(deciders, same ? first.areaName : null, { permissions, proposer })
  const which =
    denied.length === waiting.length
      ? denied.length === 1
        ? 'this proposal'
        : 'these proposals'
      : `${denied.length.toLocaleString('en')} of these proposals`
  const made = proposer ? `, as you made ${denied.length === 1 ? 'it' : 'them'}` : ''
  return `You can't decide ${which}${made}. ${same ? deciderStart(who) : `For each, ${deciderSubject(who)}`} can.`
}

const listFormat = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })

/**
 * The person's roles in words, one line each, for the user menu: "Admin", "Owner of
 * Commercial and Sandbox". Everyone signed in is a contributor (requirements, section 3), so a
 * person with no other role is "Contributor". Areas are named, never shown by id; until the
 * names load, an area role is shown without its areas.
 */
export function roleLines(permissions: Permissions, areas: readonly Area[] | undefined): string[] {
  const lines: string[] = []
  if (permissions.roles.includes('administrator')) lines.push('Admin')
  if (permissions.roles.includes('auditor')) lines.push('Auditor')
  for (const role of areaRoleOrder) {
    const areaIds = permissions.assignments
      .filter((assignment) => assignment.role === role)
      .map((assignment) => assignment.areaId)
    if (!areaIds.length) continue
    const names = areas
      ? areaIds
          .map((id) => areas.find((area) => area.id === id)?.name)
          .filter((name): name is string => name !== undefined)
          .sort((a, b) => a.localeCompare(b, 'en'))
      : []
    lines.push(names.length ? `${roleNames[role]} of ${listFormat.format(names)}` : roleNames[role])
  }
  return lines.length ? lines : ['Contributor']
}

/**
 * The person's roles as titles, without their areas, for a place that shows the areas on their
 * own (the sign-in picker): "Admin", "Owner". "Contributor" when they hold no other.
 */
export function roleTitles(permissions: Permissions): string[] {
  const titles: string[] = []
  if (permissions.roles.includes('administrator')) titles.push('Admin')
  if (permissions.roles.includes('auditor')) titles.push('Auditor')
  for (const role of areaRoleOrder)
    if (permissions.assignments.some((assignment) => assignment.role === role))
      titles.push(roleNames[role])
  return titles.length ? titles : ['Contributor']
}

/** The roles as one line, for the place under the person's name. */
export function roleSummary(permissions: Permissions, areas: readonly Area[] | undefined): string {
  return roleLines(permissions, areas).join(', ')
}
