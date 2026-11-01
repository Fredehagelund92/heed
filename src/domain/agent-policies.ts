/*
  Publishing without review (FR-421). An owner of a domain lets one named agent's suggestions
  publish without a review round, as the owner's own decision. It is off for the workspace until an
  admin switches it on. A policy covers one app agent and one domain and has a daily
  cap. It publishes only a new item at low risk that clashes with nothing live and has nothing
  that needs care. It never changes or archives a live item, and it never expires: it stays until
  someone turns it off. Every rule is checked again by the database when it publishes.
*/

/** The most a policy may publish in a day, and what a new one starts with. */
export const POLICY_MAX_PER_DAY = 50
export const POLICY_DEFAULT_PER_DAY = 10

/** Why a policy does not publish now, though it is on. */
export const policyPauses = ['not_owner', 'tool_off', 'workspace_tool_off'] as const
export type PolicyPause = (typeof policyPauses)[number]

/** What a policy's paused line says, after "It waits for review now:". */
export const policyPauseWords: Record<PolicyPause, (setBy: string) => string> = {
  not_owner: (setBy) => `${setBy} is no longer an owner of the domain.`,
  tool_off: () => 'suggest_context is off for this agent.',
  workspace_tool_off: () => 'suggest_context is off for every agent.',
}

/**
 * Why a suggestion an agent sent was not published under a policy, though one is on for the agent
 * and the domain: the service says it in the tool's reply, and the suggestion waits for review.
 */
export const policySkips = [
  'not_new',
  'risk',
  'clash',
  'needs_care',
  'daily_cap',
  'not_owner',
  'tool_off',
  'checks',
] as const
export type PolicySkip = (typeof policySkips)[number]

export const policySkipWords: Record<PolicySkip, string> = {
  not_new: 'it changes or archives a live item',
  risk: 'it is not low risk',
  clash: 'it clashes with live context',
  needs_care: 'something in it needs care',
  daily_cap: 'the policy published its most for today',
  not_owner: 'the person who set the policy is no longer an owner of the domain',
  tool_off: 'suggest_context is off',
  checks: 'a check did not pass',
}
