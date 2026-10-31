// Publishing without review (FR-421), as the screens say it. An admin switches it on for the
// workspace; then an owner of a domain lets one named agent's suggestions publish there without a
// review round, for low-risk new items only, up to a daily cap. It stays on until someone turns it
// off. Pure, so it is unit tested (tests/web/lib/policies.test.ts).

import {
  POLICY_DEFAULT_PER_DAY,
  POLICY_MAX_PER_DAY,
  policyPauseWords,
  type PolicyPause,
} from '@domain/agent-policies'
import type { DomainId } from '@/model/items'

export { POLICY_DEFAULT_PER_DAY, POLICY_MAX_PER_DAY }

/** One policy, as the agent's Details and the domain page show it. */
export type Policy = {
  id: string
  agentId: string
  /** The agent's name. */
  agent: string
  /** The person the agent works for. */
  who: string
  domain: DomainId
  domainName: string
  perDay: number
  setBy: string
  /** The day it was set: "31 Oct 2026". */
  setOn: string
  reason: string
  /** How many it published in the last 24 hours. */
  today: number
  pause: PolicyPause | null
  /** Whether the signed-in person may turn it off. */
  canEnd: boolean
}

/** A domain's policies, with whether the workspace allows them and the agents one may be for. */
export type DomainPolicies = {
  on: boolean
  canSet: boolean
  policies: Policy[]
  agents: { id: string; agent: string; who: string; sent: number; published: number }[]
}

/** The workspace switch, as an admin sees it: on or off, and how many policies are on. */
export type AutoPublish = { on: boolean; open: number }

/** What a policy lets through, in one line: "New low-risk items only, up to 10 a day". */
export const policyRule = (p: Pick<Policy, 'perDay'>) =>
  `New low-risk items only, up to ${p.perDay} a day`

/** Who set it and when: "Set by Jon Abara on 31 Oct 2026". */
export const policySetLine = (p: Pick<Policy, 'setBy' | 'setOn'>) =>
  `Set by ${p.setBy} on ${p.setOn}`

/** Why a policy that is on still waits for review, or null when it publishes. */
export const policyPauseLine = (p: Pick<Policy, 'pause' | 'setBy'>) =>
  p.pause ? `It waits for review now: ${policyPauseWords[p.pause](p.setBy)}` : null

/** What it published today, against its cap: "3 of 10 today". */
export const policyTodayLine = (p: Pick<Policy, 'today' | 'perDay'>) =>
  `${p.today} of ${p.perDay} today`

/** The first name, as a history line names a person: "Jon". */
const first = (name: string) => name.split(' ')[0] ?? name

/** A version published under a policy, as the history says it. */
export const publishedUnderLine = (sentBy: string, setBy: string) =>
  `Published by ${sentBy} under ${first(setBy)}'s policy`
