import type { Gate, LevelResult } from '@/api/client'

/*
  What the checks of a proposal say, in plain words (FR-505 to FR-516, contract 9.7). The contract
  types the details of every level; a level that has not run, or a result recorded without
  details, carries none, and the readers below fall back to a plain sentence for it.
*/

export type CheckLevel = LevelResult['level']

/**
 * How a level reads on screen. `running` is a level that has not run yet while its answer tests
 * are queued or running; `not_run` one that waits for something else.
 */
export type CheckState = 'passed' | 'failed' | 'error' | 'running' | 'not_run'

export const checkLevelNames: Record<CheckLevel, string> = {
  format: 'Complete',
  matching: 'Finds the right questions',
  delivery: 'Reaches AI apps',
  answer_impact: 'Answers stay right, questions it could change',
  answer_full: 'Answers stay right, whole domain',
}

/** The short names, for one line of outcomes (a timeline row, a folded summary). */
export const checkLevelShortNames: Record<CheckLevel, string> = {
  format: 'Complete',
  matching: 'Finds the right questions',
  delivery: 'Reaches AI apps',
  answer_impact: 'Answers stay right',
  answer_full: 'Whole domain',
}

export const checkStateNames: Record<CheckState, string> = {
  passed: 'Passed',
  failed: 'Failed',
  error: "Couldn't finish",
  running: 'Running',
  not_run: 'Not run yet',
}

export type CheckReading = {
  level: CheckLevel
  state: CheckState
  /** One plain sentence under the level's name. */
  summary: string
  /** Up to three lines that say what to fix, for a failed format or delivery check. */
  notes: string[]
}

type Details<Level extends CheckLevel> = Extract<LevelResult, { level: Level }>['details']

const text = (value: string | undefined): string | null =>
  value !== undefined && value.trim() !== '' ? value.trim() : null
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** Shown when a level that ran carries no details to read: a result recorded without them. */
export const unreadableDetails = "We can't show the details of this check here."

function formatReading(
  state: CheckState,
  details: Details<'format'>,
): Pick<CheckReading, 'summary' | 'notes'> {
  const findings = details.findings
  if (!findings)
    return { summary: state === 'passed' ? 'No problems found' : unreadableDetails, notes: [] }
  if (!findings.length) return { summary: 'No problems found', notes: [] }
  const errors = findings.filter((finding) => finding.severity !== 'warning').length
  const warnings = findings.length - errors
  const summary = [
    errors ? plural(errors, 'problem') + ' to fix' : null,
    warnings ? plural(warnings, 'warning') : null,
  ]
    .filter(Boolean)
    .join(', ')
  return {
    summary,
    notes: findings
      .map((finding) => text(finding.message))
      .filter((message): message is string => message !== null)
      .slice(0, 3),
  }
}

function matchingReading(
  state: CheckState,
  details: Details<'matching'>,
): Pick<CheckReading, 'summary' | 'notes'> {
  const probes = details.probes
  if (!probes?.length)
    return {
      summary: state === 'passed' ? 'Questions about where it applies find it' : unreadableDetails,
      notes: [],
    }
  const good = probes.filter((probe) => probe.passed).length
  const summary =
    probes.length === 1
      ? `The test question ${good ? 'finds' : "doesn't find"} it when it should`
      : `${good === probes.length ? 'All' : `${good} of`} ${probes.length} test questions find it when they should`
  return { summary, notes: [] }
}

function deliveryReading(
  state: CheckState,
  details: Details<'delivery'>,
): Pick<CheckReading, 'summary' | 'notes'> {
  const questions = details.questions
  const reaches = details.delivered === true || details.cut === true
  if (details.delivered === undefined || !questions)
    return { summary: state === 'passed' ? 'AI apps get it' : unreadableDetails, notes: [] }
  const worse = questions.filter((question) => question.regression).length
  const replaced = details.replacedShown?.length ?? 0
  const notes = [
    reaches ? null : "AI apps don't get it, even for a question about exactly where it applies.",
    details.cut === true ? "It's cut from the reply to fit the size limit." : null,
    replaced
      ? `AI apps still get ${replaced === 1 ? 'the fact' : `the ${replaced} facts`} it replaces.`
      : null,
  ].filter((note): note is string => note !== null)
  return {
    summary: `${reaches ? 'AI apps get it.' : "AI apps don't get it."} ${
      !questions.length
        ? 'The domain has no test questions yet'
        : worse
          ? `${worse} of ${plural(questions.length, 'test answer')} got worse`
          : `No test answer got worse (${questions.length} checked)`
    }`,
    notes,
  }
}

/** Reads one level's result. A level without details gives a plain sentence. */
export function readLevel(result: LevelResult): CheckReading {
  const answer =
    result.level === 'answer_impact' || result.level === 'answer_full' ? result.details : null
  const message = text(answer?.message)
  const runState = answer?.runState
  const state: CheckState =
    result.outcome === 'not_run' && (runState === 'queued' || runState === 'running')
      ? 'running'
      : result.outcome
  const base = { level: result.level, state }
  if (state === 'running' || state === 'not_run')
    return { ...base, summary: message ?? "This check hasn't run yet.", notes: [] }
  switch (result.level) {
    case 'format':
      return { ...base, ...formatReading(state, result.details) }
    case 'matching':
      return { ...base, ...matchingReading(state, result.details) }
    case 'delivery':
      return { ...base, ...deliveryReading(state, result.details) }
    case 'answer_impact':
    case 'answer_full':
      return {
        ...base,
        summary:
          message ??
          (state === 'error'
            ? "The answer tests couldn't finish. Run them again."
            : unreadableDetails),
        notes: [],
      }
  }
}

/** Every required level in the gate's order; a level the gate has no result for reads "not run". */
export function readGate(gate: Pick<Gate, 'required' | 'levels'>): CheckReading[] {
  return gate.required.map((level) => {
    const result = gate.levels.find((candidate) => candidate.level === level)
    return readLevel(result ?? { level, outcome: 'not_run', ranAt: null, details: {} })
  })
}

/** The edition the checks ran against, when a level names one. */
export function checkedEdition(gate: Pick<Gate, 'levels'>): string | null {
  for (const level of gate.levels) {
    const edition = 'edition' in level.details ? text(level.details.edition) : null
    if (edition && /^\d{4}-\d{2}-\d{2}\.\d+$/.test(edition)) return edition
  }
  return null
}

/** The overall state, for a folded row: the worst state among the levels. */
export function gateState(readings: readonly CheckReading[]): CheckState {
  const order: CheckState[] = ['failed', 'error', 'running', 'not_run', 'passed']
  return order.find((state) => readings.some((reading) => reading.state === state)) ?? 'not_run'
}

/** "4 of 4 passed", "1 failed", "2 of 5 passed, 3 not run yet": the folded row's words. */
export function gateHeadline(readings: readonly CheckReading[]): string {
  const count = (state: CheckState) => readings.filter((reading) => reading.state === state).length
  const passed = count('passed')
  const parts = [
    `${passed} of ${readings.length} passed`,
    count('failed') ? `${count('failed')} failed` : null,
    count('error') ? `${count('error')} couldn't finish` : null,
    count('running') ? `${count('running')} running` : null,
    count('not_run') ? `${count('not_run')} not run yet` : null,
  ]
  return parts.filter(Boolean).join(', ')
}

/**
 * "Normal risk: all four checks must pass before it can be accepted." The rule behind the list
 * (FR-513).
 */
export function requiredLine(
  required: readonly CheckLevel[],
  risk: 'low' | 'normal' | 'high' | null,
) {
  const words = ['no', 'one', 'two', 'three', 'four', 'five']
  const checks = `${required.length > 1 ? 'all ' : ''}${words[required.length] ?? required.length} ${required.length === 1 ? 'check' : 'checks'}`
  const rule = `${checks} must pass before it can be accepted.`
  return risk
    ? `${risk === 'high' ? 'High' : risk === 'low' ? 'Low' : 'Normal'} risk: ${rule}`
    : `${rule[0]?.toUpperCase()}${rule.slice(1)}`
}
