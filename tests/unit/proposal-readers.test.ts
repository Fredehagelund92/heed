import { describe, expect, it } from 'vitest'
import type { LevelResult } from '@/api/client'
import { sourceHost, validityWords } from '@/components/proposal/agent-preview'
import { personChipText, personRoles } from '@/components/proposal/person-chip'
import {
  checkedEdition,
  gateHeadline,
  gateState,
  readGate,
  readLevel,
  requiredLine,
  unreadableDetails,
} from '@/lib/gate'
import { readAgentReply } from '@/lib/agent-reply'
import { formatMoment } from '@/lib/library'
import {
  checkFailedReply,
  conflictReply,
  formatFailedGate,
  matchedReply,
  mixedGate,
  noMatchReply,
  normalGate,
} from '@/design-preview/proposal-samples'

const level = <Level extends LevelResult['level']>(
  name: Level,
  outcome: LevelResult['outcome'],
  details: Extract<LevelResult, { level: Level }>['details'],
) => ({ level: name, outcome, ranAt: null, details }) as LevelResult
const finding = (message: string, severity: 'error' | 'warning' = 'error') => ({
  code: 'format',
  field: 'summary',
  message,
  severity,
})
const probe = (passed: boolean) => ({
  name: 'inside',
  scope: { metrics: [], filters: {}, window: { start: '2026-08-04', end: '2026-08-05' } },
  expect: 'delivered' as const,
  actual: passed ? ('delivered' as const) : ('silent' as const),
  passed,
})

describe('readLevel: a check in plain words (FR-505 to FR-516)', () => {
  it('reads format findings, problems first, with up to three notes', () => {
    expect(readLevel(level('format', 'passed', { findings: [] }))).toMatchObject({
      state: 'passed',
      summary: 'No problems found',
      notes: [],
    })
    const findings = ['a', 'b', 'c', 'd'].map((message) => finding(message))
    const failed = readLevel(
      level('format', 'failed', { findings: [...findings, finding('w', 'warning')] }),
    )
    expect(failed.summary).toBe('4 problems to fix, 1 warning')
    expect(failed.notes).toEqual(['a', 'b', 'c'])
    expect(readLevel(formatFailedGate.levels[0]!).summary).toBe('2 problems to fix')
  })

  it('counts the test questions that find it when they should', () => {
    const probes = [probe(true), probe(true), probe(false)]
    expect(readLevel(level('matching', 'failed', { probes })).summary).toBe(
      '2 of 3 test questions find it when they should',
    )
    expect(readLevel(level('matching', 'failed', { probes: probes.slice(1) })).summary).toBe(
      '1 of 2 test questions find it when they should',
    )
    expect(readLevel(level('matching', 'passed', { probes: probes.slice(0, 2) })).summary).toBe(
      'All 2 test questions find it when they should',
    )
    expect(readLevel(level('matching', 'failed', { probes: probes.slice(2) })).summary).toBe(
      "The test question doesn't find it when it should",
    )
  })

  it('says whether agents get it, and how many test answers got worse', () => {
    expect(readLevel(normalGate.levels[2]!).summary).toBe(
      'Agents get it. No test answer got worse (31 checked)',
    )
    const failed = readLevel(
      level('delivery', 'failed', {
        delivered: false,
        cut: false,
        replacedShown: ['itm_a'],
        questions: [{ id: 'gq_001', baseline: true, candidate: false, regression: true }],
      }),
    )
    expect(failed.summary).toBe("Agents don't get it. 1 of 1 test answer got worse")
    expect(failed.notes).toEqual([
      "Agents don't get it, even for a question about exactly where it applies.",
      'Agents still get the fact it replaces.',
    ])
  })

  it('shows the answer tests message the service wrote', () => {
    expect(readLevel(normalGate.levels[3]!).summary).toBe(
      '2 test questions could change. None got worse.',
    )
  })

  it('reads a queued or running answer run as running, and a waiting level as not run', () => {
    expect(readLevel(mixedGate.levels[3]!)).toMatchObject({
      state: 'running',
      summary: 'The answer tests are running against the live edition.',
    })
    expect(readLevel(formatFailedGate.levels[1]!)).toMatchObject({
      state: 'not_run',
      summary: "This check hasn't run yet.",
    })
    expect(readLevel(level('delivery', 'not_run', {})).summary).toBe("This check hasn't run yet.")
  })

  it('says so plainly when a level that ran was recorded without details', () => {
    for (const name of ['format', 'matching', 'delivery', 'answer_full'] as const) {
      const reading = readLevel(level(name, 'failed', {}))
      expect(reading.state).toBe('failed')
      expect(reading.summary).toBe(unreadableDetails)
    }
    expect(readLevel(level('format', 'passed', {})).summary).toBe('No problems found')
    expect(readLevel(level('matching', 'passed', { probes: [] })).summary).toBe(
      'Questions about where it applies find it',
    )
    expect(readLevel(level('delivery', 'passed', {})).summary).toBe('Agents get it')
    expect(readLevel(level('answer_full', 'error', {})).summary).toBe(
      "The answer tests couldn't finish. Run them again.",
    )
  })
})

describe('readGate and its summaries', () => {
  it('lists every required level in order, and a level without a result as not run', () => {
    const readings = readGate({
      required: ['format', 'matching', 'delivery', 'answer_impact'],
      levels: [normalGate.levels[1]!, normalGate.levels[0]!],
    })
    expect(readings.map((reading) => [reading.level, reading.state])).toEqual([
      ['format', 'passed'],
      ['matching', 'passed'],
      ['delivery', 'not_run'],
      ['answer_impact', 'not_run'],
    ])
  })

  it('folds into the worst state and a headline', () => {
    expect(gateState(readGate(normalGate))).toBe('passed')
    expect(gateHeadline(readGate(normalGate))).toBe('4 of 4 passed')
    expect(gateState(readGate(mixedGate))).toBe('failed')
    expect(gateHeadline(readGate(mixedGate))).toBe(
      "2 of 5 passed, 1 failed, 1 couldn't finish, 1 running",
    )
    expect(gateState([])).toBe('not_run')
  })

  it('says the rule behind the list', () => {
    expect(requiredLine(normalGate.required, 'normal')).toBe(
      'Normal risk: all four checks must pass before it can be accepted.',
    )
    expect(requiredLine(['format', 'matching', 'delivery'], 'low')).toBe(
      'Low risk: all three checks must pass before it can be accepted.',
    )
    expect(requiredLine(['format'], null)).toBe('One check must pass before it can be accepted.')
  })

  it('finds the edition the checks ran against, and ignores anything that is not one', () => {
    expect(checkedEdition(normalGate)).toBe('2026-10-07.2')
    expect(checkedEdition(formatFailedGate)).toBeNull()
    expect(checkedEdition({ levels: [level('matching', 'passed', { edition: 'live' })] })).toBe(
      null,
    )
  })
})

describe('readAgentReply: the preview reply in the words of the card', () => {
  it('reads a matched reply with its items', () => {
    const reply = readAgentReply(matchedReply)
    expect(reply).toMatchObject({ status: 'matched', edition: '2026-10-07.2', cut: false })
    if (reply.status !== 'matched') throw new Error('expected a match')
    expect(reply.items[0]).toMatchObject({
      kind: 'event',
      claimLevel: 'fact_only',
      verified: true,
      validity: { start: '2026-08-04', end: null },
      evidence: [{ url: 'https://www.regulator.example/notices/2026-08', date: '2026-08-05' }],
    })
  })

  it('reads a conflict, a cut, an unverified item and a partial match', () => {
    const reply = readAgentReply(conflictReply)
    if (reply.status !== 'conflict') throw new Error('expected a conflict')
    expect(reply.cut).toBe(true)
    expect(reply.items[1]).toMatchObject({
      verified: false,
      appliesNote: 'Applies to brand: Lucky North only.',
      claimLevel: 'effect_stated',
    })
  })

  it('keeps the body an agent receives, and leaves an empty one out', () => {
    const withBody = {
      ...matchedReply,
      items: matchedReply.items!.map((item) => ({ ...item, body: '## Steps\n\n1. Check it' })),
    }
    const reply = readAgentReply(withBody)
    if (reply.status !== 'matched') throw new Error('expected a match')
    expect(reply.items[0]?.body).toBe('## Steps\n\n1. Check it')
    const blank = readAgentReply({
      ...matchedReply,
      items: matchedReply.items!.map((item) => ({ ...item, body: '  ' })),
    })
    if (blank.status !== 'matched') throw new Error('expected a match')
    expect(blank.items[0]?.body).toBeNull()
  })

  it("keeps the contributor's own caveat and reads the default as none (FR-104)", () => {
    const caveat = 'Lower orders in Norway after 4 August do not mean fewer customers.'
    const own = readAgentReply({
      ...matchedReply,
      items: matchedReply.items!.map((item) => ({ ...item, not_to_conclude: caveat })),
    })
    if (own.status !== 'matched') throw new Error('expected a match')
    expect(own.items[0]?.notToConclude).toBe(caveat)
    const fallback = readAgentReply({
      ...matchedReply,
      items: matchedReply.items!.map((item) => ({ ...item, not_to_conclude: 'Cause not proven' })),
    })
    if (fallback.status !== 'matched') throw new Error('expected a match')
    expect(fallback.items[0]?.notToConclude).toBeNull()
  })

  it('reads the replies without items', () => {
    expect(readAgentReply(noMatchReply)).toEqual({ status: 'no_match', edition: '2026-10-07.2' })
    expect(readAgentReply(checkFailedReply)).toEqual({
      status: 'check_failed',
      edition: null,
      message: 'Context checks could not run. Try again shortly.',
    })
  })

  it('reads a question that needs more detail', () => {
    expect(readAgentReply({ ...noMatchReply, status: 'need_more_detail' })).toEqual({
      status: 'need_more_detail',
      edition: '2026-10-07.2',
    })
  })
})

describe('the words of the parts', () => {
  it('shows the last day of a half-open window (NFR-048)', () => {
    expect(validityWords({ start: '2026-08-04', end: null })).toBe(
      'From 4 August 2026, still going on.',
    )
    expect(validityWords({ start: '2026-08-01', end: '2026-09-01' })).toBe(
      'From 1 August to 31 August 2026.',
    )
    expect(validityWords({ start: '2026-08-01', end: '2026-08-02' })).toBe('On 1 August 2026 only.')
    expect(validityWords({ start: '2026-12-20', end: '2027-01-05' })).toBe(
      'From 20 December 2026 to 4 January 2027.',
    )
    expect(validityWords({ start: '2026-08-01', end: '2026-08-02' })).toBe('On 1 August 2026 only.')
    expect(validityWords(null)).toBeNull()
  })

  it('names the site of a web source and nothing else', () => {
    expect(sourceHost('https://www.regulator.example/notices')).toBe('regulator.example')
    expect(sourceHost('http://news.example/a')).toBe('news.example')
    expect(sourceHost('javascript:alert(1)')).toBeNull()
    expect(sourceHost('not a link')).toBeNull()
  })

  it('writes a moment in UTC, short and long', () => {
    expect(formatMoment('2026-10-08T09:12:00Z')).toBe('8 Oct, 09:12')
    expect(formatMoment('2026-10-08T23:30:00+02:00')).toBe('8 Oct, 21:30')
    expect(formatMoment('2026-10-08T09:12:00Z', 'long')).toBe('8 October 2026 at 09:12 UTC')
  })

  it('says "you" for the viewer in every part a person plays', () => {
    for (const role of personRoles) {
      expect(personChipText(role, 'Jon Abara', false)).toContain('Jon Abara')
      expect(personChipText(role, 'Jon Abara', true)).not.toContain('Jon Abara')
      expect(personChipText(role, 'Jon Abara', true).toLowerCase()).toContain('you')
    }
    expect(personChipText('proposer', 'Maria Lindqvist', true, '2026-10-07')).toBe(
      'Proposed by you, 7 Oct 2026',
    )
  })
})
