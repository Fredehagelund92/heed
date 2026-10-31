import { describe, expect, it } from 'vitest'
import {
  policyPauseLine,
  policyRule,
  policySetLine,
  policyTodayLine,
  publishedUnderLine,
} from '@/lib/policies'

describe('publishing without review, in the screens words', () => {
  it('says what a policy lets through', () => {
    expect(policyRule({ perDay: 10 })).toBe('New low-risk items only, up to 10 a day')
  })

  it('says who set it, how many today, and why it waits although it is on', () => {
    expect(policySetLine({ setBy: 'Jon Abara', setOn: '31 Oct 2026' })).toBe(
      'Set by Jon Abara on 31 Oct 2026',
    )
    expect(policyTodayLine({ today: 3, perDay: 10 })).toBe('3 of 10 today')
    expect(policyPauseLine({ pause: null, setBy: 'Jon Abara' })).toBeNull()
    expect(policyPauseLine({ pause: 'not_owner', setBy: 'Jon Abara' })).toBe(
      'It waits for review now: Jon Abara is no longer an owner of the domain.',
    )
    expect(policyPauseLine({ pause: 'tool_off', setBy: 'Jon Abara' })).toBe(
      'It waits for review now: suggest_context is off for this agent.',
    )
  })

  it("names the agent and whose policy published a version, by the owner's first name", () => {
    expect(publishedUnderLine('Claude Code for Kofi Mensah', 'Jon Abara')).toBe(
      "Published by Claude Code for Kofi Mensah under Jon's policy",
    )
  })
})
