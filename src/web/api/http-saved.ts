/**
 * Saved questions on the http binding (FR-526): the service's records as Quality, the review, the
 * domain's page and the Overview read them. The service says what each question got and why, as
 * reasons and answers; the words are the domain's (src/domain/saved-check.ts), so they read the
 * same as the service's own pages say them.
 */
import type { SavedQuestionRecord, SavedStatus } from '@contract/saved-questions'
import { answerText, expectWords, savedWhy } from '@domain/saved-check'
import type { SavedQuestion } from '@/model/saved-questions'
import type { SavedCheck } from './client'
import { commentWhen } from './http-map'

/** A saved question as the app reads it, its times said as of `now`. */
export function savedQuestionOf(q: SavedQuestionRecord, now: Date): SavedQuestion {
  const { result } = q.result
  return {
    id: q.id,
    question: q.question,
    domain: q.areaId,
    savedBy: q.savedBy.name ?? 'Someone',
    expect: expectWords(q.saved, q.expectItems),
    result,
    why: savedWhy({
      reason: q.result.reason,
      saved: q.saved,
      now: q.result.now,
      expect: q.expectItems,
    }),
    when: commentWhen(q.result.checkedAt, now),
    // The item the answer comes from, or came from: what it should answer from first.
    factId: q.expectItems[0] ?? q.saved.items[0]?.id ?? q.result.now.items[0]?.id ?? '',
    ...(result === 'same'
      ? {}
      : { diff: { saved: answerText(q.saved), now: answerText(q.result.now) } }),
    ...(result !== 'same' && q.result.now.state === 'conflict'
      ? { conflict: q.result.now.items.map((i) => i.id) }
      : {}),
  }
}

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const month = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]!

/** Where the check stands, as Quality reads it; a week is named by its Monday, "1 Sep". */
export function savedCheckOf(status: SavedStatus, now: Date): SavedCheck {
  const run = status.run
  const state = run?.state === 'running' ? 'running' : run?.state === 'failed' ? 'failed' : 'idle'
  return {
    run: state,
    checked: run && state !== 'idle' ? run.checked : 0,
    total: run && state !== 'idle' ? run.total : 0,
    checkedAt: status.checkedAt ? commentWhen(status.checkedAt, now) : null,
    trend: {
      labels: status.weeks.map((w) => `${Number(w.week.slice(8, 10))} ${month(w.week)}`),
      same: status.weeks.map((w) => w.same),
      total: status.weeks.map((w) => w.total),
    },
  }
}
