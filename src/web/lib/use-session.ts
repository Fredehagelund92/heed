import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Permissions } from '@/api'
import { areasQuery, sessionQuery } from '@/api/queries'
import {
  canAttachTests,
  canDecide,
  canDecideInList,
  canReadAudit,
  canRetire,
  canDescribe,
  canReview,
  capacitiesIn,
  isAdmin,
  isFor,
  roleLines,
  type Audience,
  type DecidableProposal,
  type ListDecision,
  type ListedProposal,
} from './permissions'

/** The signed-in person, their roles and the change token, from the one session cache. */
export function useSession() {
  return useQuery(sessionQuery())
}

const nobody: Permissions = { roles: [], assignments: [] }

/**
 * What the signed-in person may do, bound to their session. While the session loads, every
 * answer is "no", so a screen never offers an action it may then withdraw.
 */
export function usePermissions() {
  const { data: session } = useSession()
  const { data: areas } = useQuery(areasQuery())
  return useMemo(() => {
    const permissions = session?.person.permissions ?? nobody
    const personId = session?.person.id ?? ''
    return {
      ready: session !== undefined,
      personId,
      permissions,
      isAdmin: isAdmin(permissions),
      canReadAudit: canReadAudit(permissions),
      /** Whether a page or a menu entry for the audience is the person's to open. */
      isFor: (audience: Audience) => isFor(session?.person.permissions, audience),
      capacitiesIn: (areaId: string | null) => capacitiesIn(permissions, areaId),
      canReview: (areaId: string | null) => canReview(permissions, areaId),
      canRetire: (areaId: string) => canRetire(permissions, areaId),
      canDescribe: (areaId: string) => canDescribe(permissions, areaId),
      canAttachTests: (proposal: Pick<DecidableProposal, 'areaId' | 'proposerId' | 'state'>) =>
        session ? canAttachTests(permissions, personId, proposal) : false,
      canDecide: (
        proposal: DecidableProposal,
        outcome?: 'accept' | 'request_changes' | 'reject',
      ) =>
        session
          ? canDecide(permissions, personId, proposal, outcome)
          : ({ allowed: false, reason: 'Loading your roles.' } as const),
      /** Whether a list row's proposal is the person's to decide (and select), or who can. */
      canDecideInList: (proposal: ListedProposal): ListDecision =>
        session
          ? canDecideInList(permissions, personId, proposal)
          : {
              allowed: false,
              why: 'role',
              deciders: { roles: [], areaId: proposal.areaId, proposerExcluded: true },
            },
      /** The person's roles in words, one per line ("Owner of Commercial and Sandbox"). */
      roleLines: session ? roleLines(permissions, areas) : [],
    }
  }, [session, areas])
}
