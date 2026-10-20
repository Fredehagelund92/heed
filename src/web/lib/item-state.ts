import type { CheckFlag, ContextItem } from '@domain/item'
import { itemConditions, type ItemConditions, type ItemLifecycle } from '@domain/item-conditions'
import { lastValidDay } from '@domain/status'
import { daysFrom, formatDay } from '@/lib/library'

/*
  The item page's state in plain words (the note line of the item page header): one chip for the
  period the item applies, a quiet text for when it is checked again, and, only when something
  asks for a look, one line that says what agents do with the item and who acts. The detail under
  the chip is the lifecycle sentence. Built only from fields the API has today. "Unverified" is
  the delivered label of FR-325.
*/

export type StateContext = {
  /** The service's day (the library index's `today`). */
  today: string
  ownerName: string | null
  areaName: string | null
  /** Who retired the item and when, from its history. */
  retired: { by: string | null; date: string } | null
}

/** Where an item is in its life, plus a period that has not started yet. */
export type LifecycleKey = ItemLifecycle | 'future'

export type LifecycleCopy = {
  key: LifecycleKey
  title: string
  /** One sentence: how long ago or how long to go, and what agents do. */
  line: string
}

/**
 * The validity chip: the period the item applies, never the next check. It names the end when
 * there is one and the start when there is not. `soon` tints it amber when its last day is within
 * 30 days, the rule of the library's Valid until column; `quiet` mutes a period that is over.
 */
export type ValidityChip = {
  key:
    | 'applies_since'
    | 'applies_until'
    | 'future'
    | 'active_since'
    | 'active_until'
    | 'ended'
    | 'resolved'
    | 'retired'
  label: string
  /** Period wording when the lifecycle title is already shown beside it. */
  summaryLabel?: string
  /** Muted words after the label, such as ", ongoing" or ", in 2 days". */
  tail: string
  soon: boolean
  quiet: boolean
}

const plural = (count: number, word: string) =>
  `${count.toLocaleString('en')} ${word}${count === 1 ? '' : 's'}`

const long = (date: string) => formatDay(date, 'long')

/** ", today" or ", in 3 days": how far off a day within 30 days is. */
const inDays = (days: number) => (days === 0 ? ', today' : `, in ${plural(days, 'day')}`)

/** "6 to 22 Sep 2026" or "6 Apr to 10 May 2026"; the year shows once unless the range crosses one. */
export function dayRange(first: string, last: string, style: 'short' | 'long' = 'short'): string {
  const day = (date: string) => formatDay(date, style)
  if (first === last) return day(first)
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${day(first)} to ${day(last)}`
  const sameMonth = first.slice(0, 7) === last.slice(0, 7)
  const head = day(first).replace(/ \d{4}$/, '')
  return `${sameMonth ? head.replace(/ \D+$/, '') : head} to ${day(last)}`
}

/** A range in whole month names, or "on" one day: "3 to 14 August 2026", "on 10 September 2026". */
const appliedRange = (first: string, last: string) =>
  `${first === last ? 'on ' : ''}${dayRange(first, last, 'long')}`

/** A standing fact or an open issue whose period starts after today. */
function startsLater(
  item: Pick<ContextItem, 'validity'>,
  conditions: ItemConditions,
  today: string,
) {
  return (
    item.validity.start > today &&
    (conditions.lifecycle === 'accepted' || conditions.lifecycle === 'active_issue')
  )
}

/** The lifecycle's title and sentence, the detail under the validity chip. */
export function lifecycleCopy(
  item: ContextItem,
  conditions: ItemConditions,
  context: StateContext,
): LifecycleCopy {
  const { today } = context
  const { start, end } = item.validity
  const last = end === null ? null : lastValidDay(end)
  const calm = conditions.warnings.length === 0
  const stale = conditions.warnings.includes('stale')
  const review = item.reviewDate
  const reviewLine = (asks: 'still_correct' | 'still_going_on') => {
    if (review === null) return ''
    const days = daysFrom(today, review)
    if (stale) return ` The check was due ${plural(-days, 'day')} ago, on ${long(review)}.`
    const action =
      asks === 'still_going_on' ? "asks whether it's still going on" : 'checks it again'
    return ` The owner ${action} by ${long(review)}, ${days === 0 ? 'today' : `in ${plural(days, 'day')}`}.`
  }
  if (startsLater(item, conditions, today)) {
    // FR-316: an item matches a question only when its period overlaps the question's dates.
    return {
      key: 'future',
      title: 'Not started yet',
      line: `It applies from ${long(start)}, in ${plural(daysFrom(today, start), 'day')}${last === null ? '' : `, until ${long(last)}`}. AI apps get it only for questions about dates from then on.${review === null ? '' : ` The owner checks it by ${long(review)}.`}`,
    }
  }
  switch (conditions.lifecycle) {
    case 'retired': {
      const who = context.retired?.by
      const when = context.retired?.date
      return {
        key: 'retired',
        title: 'Archived',
        line: `${who && when ? `${who} archived it on ${long(when)}. ` : ''}It stays in the history, and AI apps don't get it.`,
      }
    }
    case 'ended': {
      const ago = daysFrom(last ?? today, today)
      return {
        key: 'ended',
        title: 'Ended',
        line: `It ended ${ago === 0 ? 'today' : `${plural(ago, 'day')} ago`}, on ${long(last ?? today)}. AI apps get it only for questions about that period.`,
      }
    }
    case 'resolved_issue': {
      const lastDay = last ?? today
      return {
        key: 'resolved_issue',
        title: 'Resolved',
        line: `Resolved on ${long(lastDay)}. It applied ${appliedRange(start, lastDay)}, so AI apps get it only for questions about that period.`,
      }
    }
    case 'active_issue': {
      if (last !== null) {
        const left = daysFrom(today, last)
        return {
          key: 'active_issue',
          title: 'Active issue',
          line: `It started on ${long(start)} and applies until ${long(last)}, ${left === 0 ? 'which is today' : `in ${plural(left, 'day')}`}. AI apps warn about it in answers about that time.`,
        }
      }
      return {
        key: 'active_issue',
        title: 'Active issue',
        line: `It started on ${long(start)} and is still going on. AI apps warn about it in answers about that time.${reviewLine('still_going_on')}`,
      }
    }
    case 'accepted': {
      const agents = calm ? ' AI apps get it when a question is about it.' : ''
      if (last !== null) {
        const left = daysFrom(today, last)
        return {
          key: 'accepted',
          title: 'Accepted',
          line: `It applies from ${long(start)} until ${long(last)}. Its last day is ${left === 0 ? 'today' : `in ${plural(left, 'day')}`}.${agents}`,
        }
      }
      return {
        key: 'accepted',
        title: 'Accepted',
        line: `It applies from ${long(start)} and is still going on.${agents}${reviewLine('still_correct')}`,
      }
    }
  }
}

/** The validity chip of the header. The dates are the last valid day, as the library shows them. */
export function validityChip(
  item: Pick<ContextItem, 'validity'>,
  conditions: ItemConditions,
  context: StateContext,
): ValidityChip {
  const { today } = context
  const { start, end } = item.validity
  const last = end === null ? null : lastValidDay(end)
  const left = last === null ? null : daysFrom(today, last)
  const soon = left !== null && left >= 0 && left <= 30
  const until = (key: 'applies_until' | 'active_until', words: string): ValidityChip => ({
    key,
    label: `${words} ${long(last ?? today)}`,
    tail: soon ? inDays(left ?? 0) : '',
    soon,
    quiet: false,
  })
  if (startsLater(item, conditions, today)) {
    return {
      key: 'future',
      label: `Starts ${long(start)}`,
      tail: `, in ${plural(daysFrom(today, start), 'day')}`,
      soon: false,
      quiet: false,
    }
  }
  switch (conditions.lifecycle) {
    case 'retired': {
      const on = context.retired?.date
      return {
        key: 'retired',
        label: on ? `Archived ${long(on)}` : 'Archived',
        tail: '',
        soon: false,
        quiet: true,
      }
    }
    case 'ended':
      return {
        key: 'ended',
        label: `Applied ${appliedRange(start, last ?? today)}`,
        tail: '',
        soon: false,
        quiet: true,
      }
    case 'resolved_issue':
      return {
        key: 'resolved',
        label: `Resolved, applied ${appliedRange(start, last ?? today)}`,
        summaryLabel: `Applied ${appliedRange(start, last ?? today)}`,
        tail: '',
        soon: false,
        quiet: true,
      }
    case 'active_issue':
      return last === null
        ? {
            key: 'active_since',
            label: `Active since ${long(start)}`,
            tail: '',
            soon: false,
            quiet: false,
          }
        : until('active_until', 'Active until')
    case 'accepted':
      return last === null
        ? {
            key: 'applies_since',
            label: `From ${long(start)}`,
            tail: ', still going on',
            soon: false,
            quiet: false,
          }
        : until('applies_until', 'Until')
  }
}

/**
 * When the owner checks the fact again, as quiet text beside the chip: the check date, with the
 * days left within 30 days, or when the check was due once it has passed (the Check due badge
 * carries the colour). Only while the item still applies.
 */
export function nextCheckText(
  item: ContextItem,
  conditions: ItemConditions,
  today: string,
): string | null {
  const review = item.reviewDate
  if (review === null) return null
  if (conditions.lifecycle !== 'accepted' && conditions.lifecycle !== 'active_issue') return null
  if (conditions.warnings.includes('stale')) return `Check was due ${long(review)}`
  const days = daysFrom(today, review)
  return `Check again by ${long(review)}${days <= 30 ? inDays(days) : ''}`
}

/**
 * The one line under the title while something needs checking: what AI apps do with the fact and
 * who acts. The badges say what is wrong; this says the consequence. Null when nothing does.
 */
export function noteText(
  item: ContextItem,
  conditions: ItemConditions,
  context: StateContext,
): string | null {
  const { warnings } = conditions
  if (warnings.length === 0) return null
  const who =
    context.ownerName ?? (context.areaName ? `the owner of ${context.areaName}` : 'the owner')
  const act = stillGoingOn(item, conditions)
    ? "confirms it's still going on"
    : warnings.length === 1 && warnings[0] === 'stale'
      ? 'checks it again'
      : 'checks it'
  const head =
    item.riskLevel === 'high' ? 'AI apps may not get it' : 'AI apps are told it may be out of date'
  return `${head} until ${who} ${act}.`
}

/** An open issue past its review date is asked "Is this still going on?" (FR-135). */
function stillGoingOn(item: ContextItem, conditions: ItemConditions) {
  return conditions.warnings.includes('stale') && item.reviewQuestion === 'still_going_on'
}

/** What a source flag means, for the Source row of the Source tab. */
const sourceWhat: Record<CheckFlag, string> = {
  source_missing: 'Something this fact is about is gone from its source.',
  needs_check: 'Something this fact is about changed in its source.',
}

/** Everything the item page header and the Source tab say about the state, from the item and the day. */
export function itemState(item: ContextItem, context: StateContext) {
  const conditions = itemConditions(item, context.today)
  const sourceFlag = conditions.warnings.find(
    (warning): warning is CheckFlag => warning === 'source_missing' || warning === 'needs_check',
  )
  return {
    conditions,
    lifecycle: lifecycleCopy(item, conditions, context),
    chip: validityChip(item, conditions, context),
    nextCheck: nextCheckText(item, conditions, context.today),
    note: noteText(item, conditions, context),
    stillGoingOn: stillGoingOn(item, conditions),
    source: sourceFlag ? { flag: sourceFlag, what: sourceWhat[sourceFlag] } : null,
  }
}

export type ItemState = ReturnType<typeof itemState>
