import { ApiError } from '../errors'
import type { Connected } from '@/lib/connect'
import type { DomainPolicies, Policy } from '@/lib/policies'
import type { DomainId, Kind } from '@/model/items'

// Publishing without review in the demo (FR-421), kept until the page reloads. It is off for the
// workspace as the demo starts, with no policy anywhere, as on a new install; the review flag
// ?autopublish=on starts it switched on. The demo's agents send no suggestions of their own, so a
// policy here publishes nothing: the screens show it, its rules and Turn off, as the service keeps
// them.

/** Who is signed in, as the policies ask it. */
type Reader = { name: string; admin: boolean; owns: readonly DomainId[] }

export function createPolicies() {
  let on = false
  let policies: Policy[] = []
  let made = 0
  /** Whether the review flag was read: it switches it on once, and a later switch stands. */
  let flagged = false

  /** Whether the reader may turn this one off: whoever set it, an owner, an admin, the agent's person. */
  const mayEnd = (p: Policy, r: Reader) =>
    p.setBy === r.name || r.admin || r.owns.includes(p.domain) || p.who === r.name
  const shown = (p: Policy, r: Reader): Policy => ({ ...p, canEnd: mayEnd(p, r) })

  return {
    /** The review flag ?autopublish=on: switched on as the demo starts. */
    fromAddress(query: Record<string, string | undefined>) {
      if (flagged) return
      flagged = true
      if (query.autopublish === 'on') on = true
    },
    state: () => ({ on, open: policies.length }),
    /** Off ends every policy at once. */
    switchTo(next: boolean, r: Reader) {
      if (!r.admin)
        throw new ApiError('forbidden', 'Only an admin switches this for the workspace.')
      const ended = next ? 0 : policies.length
      if (!next) policies = []
      on = next
      return { ended }
    },
    /** The open policies of one agent, for its row in Agents and access. */
    ofAgent: (agentId: string, r: Reader) =>
      policies.filter((p) => p.agentId === agentId).map((p) => shown(p, r)),
    forDomain(domain: DomainId, r: Reader, agents: readonly Connected[]): DomainPolicies {
      const canSet = r.admin || r.owns.includes(domain)
      return {
        on,
        canSet,
        policies: policies.filter((p) => p.domain === domain).map((p) => shown(p, r)),
        // The apps that may still suggest, with what came of what they sent.
        agents: canSet
          ? agents
              .filter(
                (a) =>
                  a.kind === 'app' &&
                  a.tools.some((t) => t.tool === 'suggest_context' && t.on && t.allowed),
              )
              .map((a) => ({
                id: a.id,
                agent: a.agent,
                who: a.who,
                sent: a.sent,
                published: a.recent.filter((s) => s.state === 'accepted').length,
              }))
          : [],
      }
    },
    set(
      input: {
        agent: Connected
        domain: DomainId
        domainName: string
        kinds: Kind[]
        perDay: number
        reason: string
      },
      r: Reader,
    ): Policy {
      if (!on)
        throw new ApiError(
          'conflict',
          'Publishing without review is off for the workspace. An admin turns it on in Agents and access.',
        )
      if (!r.admin && !r.owns.includes(input.domain))
        throw new ApiError(
          'forbidden',
          'Only the owners of this domain, or an admin, can let an agent publish here.',
        )
      if (input.agent.kind !== 'app')
        throw new ApiError(
          'conflict',
          'An access key names no person and never suggests, so it never publishes.',
        )
      const policy: Policy = {
        id: `policy-${++made}`,
        agentId: input.agent.id,
        agent: input.agent.agent,
        who: input.agent.who,
        domain: input.domain,
        domainName: input.domainName,
        kinds: [...new Set(input.kinds)],
        perDay: input.perDay,
        setBy: r.name,
        setOn: '23 Oct 2026',
        reason: input.reason,
        today: 0,
        pause: input.agent.tools.some((t) => t.tool === 'suggest_context' && t.on)
          ? null
          : 'tool_off',
        canEnd: true,
      }
      // A change is a new policy: it replaces the agent's policy in that domain.
      policies = [
        policy,
        ...policies.filter((p) => !(p.agentId === policy.agentId && p.domain === policy.domain)),
      ]
      return policy
    },
    end(id: string, r: Reader) {
      const policy = policies.find((p) => p.id === id)
      if (!policy) return
      if (!mayEnd(policy, r))
        throw new ApiError(
          'forbidden',
          'Only whoever set it, an owner of the domain, an admin or the person the agent works for can turn it off.',
        )
      policies = policies.filter((p) => p !== policy)
    },
    /** A revoked app has every policy ended with it. */
    endAgent(agentId: string) {
      policies = policies.filter((p) => p.agentId !== agentId)
    },
  }
}
