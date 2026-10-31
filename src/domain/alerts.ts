/**
 * Alerts (FR-621, docs/product.md, section 10): eight rules, each one sentence, that raise a card
 * in the Inbox. Nothing emails and nothing rings. An administrator turns a rule on or off for
 * everyone and changes its threshold inside the sentence; an owner mutes a rule for their own
 * domains, so its cards stop reaching them and still reach the others.
 *
 * Pure: the rules, their words and thresholds, when a rule fires on the counts it reads, and how a
 * raise is said. The service reads the records and keeps what was raised; the app reads the same
 * words, so the Alerts page says what the service does.
 */
import { visibleCount } from './gaps.ts'

/** The eight rules, in the order the Alerts page lists them. */
export const alertRuleIds = [
  'gap',
  'saved',
  'disagree',
  'share',
  'fail',
  'spend',
  'sync',
  'due',
] as const
export type AlertRuleId = (typeof alertRuleIds)[number]

/** Who a rule's card goes to: the owners of the domain, the administrators, or both. */
export const alertAudiences = ['owners', 'admins', 'both'] as const
export type AlertAudience = (typeof alertAudiences)[number]

/** How a threshold reads: a number of times, or a share of a day's questions or of the cap. */
export type ThresholdUnit = 'times' | 'percent'

export type AlertThreshold = {
  /** What a rule fires at until an administrator changes it. */
  initial: number
  /** What an administrator picks from, in the sentence. */
  choices: readonly number[]
  unit: ThresholdUnit
  /** The setting that holds it, when another part of the service reads it too. */
  setting?: 'gaps.no_item_threshold'
}

export type AlertRule = {
  id: AlertRuleId
  name: string
  /** When it fires, one sentence; `{n}` is the threshold an administrator can change. */
  when: string
  /** What happens: where the card goes. */
  then: string
  audience: AlertAudience
  /** New with the alerts; the others raised cards before there were rules. */
  isNew?: true
  threshold?: AlertThreshold
}

export const alertRules: readonly AlertRule[] = [
  {
    id: 'gap',
    name: 'Not found',
    when: '{n} or more times in 7 days about the same thing, even across a month edge',
    then: 'A Not found card to the owners',
    audience: 'owners',
    threshold: {
      initial: 5,
      choices: [3, 5, 10],
      unit: 'times',
      setting: 'gaps.no_item_threshold',
    },
  },
  {
    id: 'saved',
    name: 'A saved question needs a look',
    when: 'After a publish, an archive, a restore, a sync, or a check date passing',
    then: 'A card to the owners of the domain',
    audience: 'owners',
  },
  {
    id: 'disagree',
    name: 'Conflict',
    when: 'Two items that apply say different things, asked {n} or more times',
    then: 'A card to the owners',
    audience: 'owners',
    isNew: true,
    threshold: { initial: 3, choices: [2, 3, 5], unit: 'times' },
  },
  {
    id: 'share',
    name: 'More questions not found',
    when: "More than {n} of a day's questions, two days running",
    then: 'A line on Overview and a card to admins',
    audience: 'admins',
    isNew: true,
    threshold: { initial: 20, choices: [10, 20, 30], unit: 'percent' },
  },
  {
    id: 'fail',
    name: 'Calls fail',
    when: "More than {n} of a day's calls could not be read or failed",
    then: 'A card to admins',
    audience: 'admins',
    isNew: true,
    threshold: { initial: 5, choices: [2, 5, 10], unit: 'percent' },
  },
  {
    id: 'spend',
    name: 'Model spend',
    when: 'Reaches {n} of the monthly cap',
    then: 'A card to admins',
    audience: 'admins',
    isNew: true,
    threshold: { initial: 80, choices: [50, 80, 100], unit: 'percent' },
  },
  {
    id: 'sync',
    name: 'A connected tool did not sync',
    when: 'A read failed or is overdue',
    then: 'A card to admins and the owners',
    audience: 'both',
  },
  {
    id: 'due',
    name: 'A check is due',
    when: 'A check date is reached',
    then: 'A reminder to the owner at 07:00',
    audience: 'owners',
  },
]

export const alertRule = (id: AlertRuleId): AlertRule => alertRules.find((r) => r.id === id)!

/** A threshold as the sentence says it: "5", "20%". */
export const thresholdWords = (value: number, unit: ThresholdUnit) =>
  unit === 'percent' ? `${value}%` : String(value)

/** A threshold the sentence offers, from its words: "20%" is 20; anything else is null. */
export function thresholdOfWords(id: AlertRuleId, words: string): number | null {
  const t = alertRule(id).threshold
  if (!t) return null
  const value = Number(words.replace(/%$/, ''))
  return t.choices.includes(value) ? value : null
}

/** Rules an owner gets, as the page lists them for someone who is not an administrator. */
export const reachesOwners = (rule: AlertRule) => rule.audience !== 'admins'

/** The hour, UTC, from which a check that is due raises its reminder. */
export const dueHour = 7

/** "9 times", or "fewer than 5 times" for a count from agents under the minimum (FR-614). */
export function timesWords(count: number, minimum: number): string {
  const shown = visibleCount(count, minimum)
  return shown === null
    ? `fewer than ${minimum} times`
    : `${shown} ${shown === 1 ? 'time' : 'times'}`
}

/** A day's questions or calls: how many there were, and how many found nothing or failed. */
export type DayShare = { day: string; total: number; part: number }

/**
 * Whether a share fires: more than `percent` of the day's calls. Only a part of at least the
 * minimum counts, so a raise never tells of a part that would be hidden (FR-614): a share of a
 * small day is a small count said another way.
 */
export function shareFires(d: DayShare, percent: number, minimum: number): boolean {
  return d.part >= minimum && d.part * 100 > percent * d.total
}

/** More questions not found: the share fires two days running; the later day names the raise. */
export function twoDaysRunning(
  days: readonly DayShare[],
  percent: number,
  minimum: number,
): string | null {
  const sorted = [...days].sort((a, b) => (a.day < b.day ? -1 : 1))
  for (let i = sorted.length - 1; i > 0; i--) {
    const [a, b] = [sorted[i - 1]!, sorted[i]!]
    const next = new Date(`${a.day}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    if (
      next.toISOString().slice(0, 10) === b.day &&
      shareFires(a, percent, minimum) &&
      shareFires(b, percent, minimum)
    )
      return b.day
  }
  return null
}

/** Model spend: this month's spend reached `percent` of the monthly cap. */
export const spendReached = (spentMicros: number, capMicros: number, percent: number) =>
  capMicros > 0 && spentMicros * 100 >= percent * capMicros

/**
 * Where a raise sends people: the card it raised in the Inbox, or, for a rule whose card is still
 * to be drawn, the page it is about.
 */
export type RaiseSubject =
  | { card: string }
  | { topic: string; pair?: string }
  | { page: 'overview' | 'usage' }
  | { connector: string }

/** Who a raise reached, as the page says it: "A card went to Jon Abara and Sofia Brandt." */
export function raisedLine(rule: AlertRuleId, names: readonly string[]): string {
  const card = rule === 'gap' ? 'A Not found card' : rule === 'due' ? 'A reminder' : 'A card'
  if (!names.length)
    return `${card} went to ${alertRule(rule).audience === 'admins' ? 'the admins' : 'the owners'}.`
  const sorted = [...names].sort((a, b) => a.localeCompare(b))
  const list =
    sorted.length === 1
      ? sorted[0]!
      : `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]!}`
  return `${card} went to ${list}.`
}

/** "2 saved questions need a look", the saved-question card's title. */
export const lookTitle = (n: number) =>
  `${n} saved ${n === 1 ? 'question needs' : 'questions need'} a look`

/**
 * The rules whose raise is a card of its own in the Inbox, an Alert card in the Alerts group (the
 * owner's call of 28 October 2026). The other three raise the cards the Inbox already has: a Not
 * found card, a domain's saved questions that need a look, and an item whose check date passed.
 */
export const alertCardRules = ['disagree', 'share', 'fail', 'spend', 'sync'] as const
export type AlertCardRule = (typeof alertCardRules)[number]

export const isAlertCardRule = (rule: AlertRuleId): rule is AlertCardRule =>
  (alertCardRules as readonly string[]).includes(rule)

/** How long an Alert card stays in the Inbox after its rule raised it. */
export const alertCardDays = 7

/** An Alert card's words: what happened, what to do about it, and its one action. */
export const alertCardWords: Record<AlertCardRule, { line: string; detail: string; open: string }> =
  {
    disagree: {
      line: 'Agents got two context items that say different things about this.',
      detail: 'Fix the one that is wrong, or archive it. The answer panel shows both.',
      open: 'Open the topic',
    },
    share: {
      line: "More of a day's questions found nothing than the rule allows, two days running.",
      detail: 'Overview shows what agents asked and found nothing for.',
      open: 'Open Overview',
    },
    fail: {
      line: "More of yesterday's calls failed or could not be read than the rule allows.",
      detail: 'Usage shows which tools failed and how often.',
      open: 'Open Usage',
    },
    spend: {
      line: "This month's model spend reached the share of the monthly cap the rule names.",
      detail: 'Usage shows the spend by feature. The cap is in Settings, Advanced.',
      open: 'Open Usage',
    },
    sync: {
      line: 'Its last read failed, or it has not read for longer than it should.',
      detail: 'Agents keep getting what it read last until it reads again.',
      open: 'Open the integration',
    },
  }

/**
 * The rule whose card an Inbox card is: an Alert card's own rule, a Not found card, a domain's
 * saved questions that need a look, and an item whose check date passed. Any other card is no
 * rule's.
 */
export function ruleOfCard(card: {
  group: string
  reason?: string
  rule?: string
}): AlertRuleId | null {
  if (card.group === 'alert') return (card.rule as AlertRuleId | undefined) ?? null
  if (card.group === 'gap') return 'gap'
  if (card.group === 'look') return 'saved'
  if (card.group === 'check' && card.reason === 'date') return 'due'
  return null
}

/** What a person set for the rules: those turned off for everyone, and what they muted where. */
export type AlertState = {
  off: readonly AlertRuleId[]
  muted: readonly { rule: AlertRuleId; areaId: string }[]
}

/**
 * Whether a card reaches the person: no rule's card always does; a rule's card does while the rule
 * is on and the person has not muted it for the card's domain (an Alert card's mutes are decided
 * over all of its raise's domains by the feed).
 */
export function cardReaches(
  card: { group: string; reason?: string; rule?: string; areaId: string },
  state: AlertState,
): boolean {
  const rule = ruleOfCard(card)
  return (
    !rule ||
    (!state.off.includes(rule) &&
      (card.group === 'alert' ||
        !state.muted.some((m) => m.rule === rule && m.areaId === card.areaId)))
  )
}
