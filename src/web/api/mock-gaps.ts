/**
 * Gaps and topic counts in the mock (FR-604 to FR-616), with the rules the service applies
 * (src/server/modules/gaps/service.ts and the gap views of db/migrations/0001_baseline.sql):
 *
 * - An owner or deputy of one of the topic's domains, or an administrator, manages a gap: sees it
 *   in full, changes its status, reads and adds notes. A topic without an area has the domains its
 *   metrics have (`cl_topic_domains`), so one that spans domains reaches each of their owners.
 * - Anyone else sees a gap only through the weeks where the topic was asked about at least the
 *   minimum number of times and the gap's own reports and no-item calls reach it too, and sees a
 *   count from one to just under the minimum as hidden (null). People's reports never count for
 *   them, nor show: anyone may add them (`readerWeek`).
 * - Topic counts show a topic week only when its calls reach the minimum, and its no-item calls
 *   only when they are zero or reach it.
 * - The managers link a gap to test questions of its area (FR-610). Resolving it records the live
 *   edition; leaving `resolved` clears that edition and the verification. Every reader sees
 *   whether it is verified by test, only its managers which tests and its history.
 * - A finished weekly or full run of an area verifies its resolved gaps by test, as the service's
 *   verifyGapsByRun does (`verifyByRun`).
 *
 * The conformance suite (tests/conformance/context-api-gaps.ts) plays the same steps here and
 * on the service.
 */
import type {
  Gap,
  GapDetail,
  GapHistoryEntry,
  GapReport,
  GapTest,
  TopicCounts,
  WeeklyCalls,
} from '../../contract/gaps.ts'
import { refusals } from '../../contract/refusals.ts'
import { textFindings } from '../../domain/draft.ts'
import { mondayOf } from '../../domain/status.ts'
import {
  clearsVerification,
  dimensionOfValue,
  draftFromTopic,
  gapOrigin,
  gapVerification,
  manualGapStatuses,
  passVerifies,
  readerWeek,
  visibleCount,
  visibleShare,
  visibleTotal,
  type GapStatus,
  type GapType,
} from '../../domain/gaps.ts'
import type { Verdict } from '../../domain/golden-question.ts'
import type { GapTopic } from '../../domain/gap-reports.ts'
import type { GapFixture, GapFixtureTopic } from '../mocks/gaps.ts'
import type {
  GapLinkTestInput,
  GapListParams,
  GapNoteInput,
  GapStatusInput,
  GapUnlinkTestInput,
  TestQuestion,
  TopicCountsParams,
  WeeklyCallsParams,
} from './client.ts'
import { ApiError, type StatusKind } from './errors.ts'

export type MockGapWorld = {
  topics: readonly GapFixtureTopic[]
  gaps: readonly GapFixture[]
  /** `privacy.min_count`. */
  minimum: number
}

type StoredGap = Omit<GapFixture, 'notes'> & {
  notes: (GapFixture['notes'][number] & { id: string })[]
  proposals: string[]
  /** The live edition's label when an owner resolved it; null while not resolved, or unknown. */
  resolvedEdition: string | null
  verified: { hour: string; edition: string } | null
  tests: Omit<GapTest, 'split' | 'active' | 'latest'>[]
  history: GapHistoryEntry[]
}

/** What a gap's test links read of the rest of the mock world. */
type TestReads = {
  question: (id: string) => TestQuestion | undefined
  /** A weekly or full run of an area, not a proposal's; undefined for any other or none. */
  areaRun: (id: string) => { area: string } | undefined
  /** The question's result in the newest finished weekly or full run of its area that tested it. */
  latest: (question: TestQuestion) => GapTest['latest']
}

const statusCodes: Record<StatusKind, number> = {
  'signed-out': 401,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  invalid: 422,
  precondition: 412,
  'bad-request': 400,
  unavailable: 503,
}

function refuse(kind: StatusKind, message: string, findings?: ApiError['findings']): never {
  throw new ApiError(kind, message, {
    status: statusCodes[kind],
    ...(findings ? { findings } : {}),
  })
}

function rejectSensitive(text: string, field: string) {
  const findings = textFindings(text, field)
  if (findings.length)
    refuse('invalid', 'Remove the email address, phone number or secret from the text.', findings)
}

const isInteger = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** A time to the hour, as gap times are kept. */
const toHour = (iso: string) => `${iso.slice(0, 13)}:00:00Z`

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function createMockGaps(
  world: MockGapWorld,
  {
    today,
    now,
    uuid,
    isDiscarded,
    liveEdition,
    metricArea,
  }: {
    today: string
    /** The workflow's clock, read on a change only. */
    now: () => string
    uuid: () => string
    /** A discarded draft leaves the gap's list of proposals, as on the service. */
    isDiscarded: (proposalId: string) => boolean
    /** The live edition's label; null before the first. */
    liveEdition: () => string | null
    /** Each metric's domain in the live edition, by the one domain rule. */
    metricArea: Readonly<Record<string, string>>
  },
) {
  const minimum = world.minimum
  const topics = new Map(world.topics.map((topic) => [topic.key, topic]))
  const gaps: StoredGap[] = world.gaps.map((gap) => ({
    ...structuredClone(gap),
    weeks: gap.weeks.map((week) => ({ ...week, personReports: week.personReports ?? 0 })),
    notes: gap.notes.map((note) => ({ ...note, id: uuid() })),
    proposals: [],
    resolvedEdition: null,
    verified: null,
    tests: [],
    history: [],
  }))
  let reported = 0

  const topicOf = (gap: StoredGap) => topics.get(gap.topic)!
  /** The topic's area, or the sorted domains its metrics have (`cl_topic_domains`). */
  const domainsOf = (topic: Pick<GapFixtureTopic, 'areaId' | 'metrics'>): string[] =>
    topic.areaId !== null
      ? [topic.areaId]
      : [...new Set(topic.metrics.flatMap((m) => (metricArea[m] ? [metricArea[m]] : [])))].sort()
  /** v_topic_weeks: a topic week is shown when its calls reach the minimum. */
  const topicWeekShown = (gap: StoredGap, week: string) =>
    topicOf(gap).weeks.some((candidate) => candidate.week === week && candidate.calls >= minimum)

  /**
   * What one person sees and may do.
   * `manages` says whether the person is an owner or deputy of an area, or an administrator.
   */
  function as({
    manages,
    tests: reads,
  }: {
    manages: (areaId: string | null) => boolean
    tests?: TestReads
  }) {
    const canManage = (gap: StoredGap) =>
      manages(topicOf(gap).areaId) || domainsOf(topicOf(gap)).some((area) => manages(area))
    const record = (gap: StoredGap, action: GapHistoryEntry['action'], details = {}) =>
      gap.history.push({ action, hour: toHour(now()), details })
    const testReads = () =>
      reads ?? refuse('unavailable', "Test questions aren't part of this demo.")
    const weeksOf = (gap: StoredGap) =>
      gap.weeks
        .filter(
          (week) =>
            canManage(gap) ||
            (readerWeek({ ...week, personReports: week.personReports ?? 0 }, minimum).shown &&
              topicWeekShown(gap, week.week)),
        )
        .sort((a, b) => a.week.localeCompare(b.week))
    const visible = (gap: StoredGap) => canManage(gap) || weeksOf(gap).length > 0

    function toGap(gap: StoredGap): Gap {
      const managed = canManage(gap)
      const shown = weeksOf(gap).map((week) => {
        const counts = { ...week, personReports: week.personReports ?? 0 }
        if (managed) return counts
        const { shown: _shown, ...reader } = readerWeek(counts, minimum)
        return { week: week.week, ...reader }
      })
      const total = (pick: (week: (typeof shown)[number]) => number | null) => {
        const sum = shown.reduce((acc, week) => acc + (pick(week) ?? 0), 0)
        return managed || sum >= minimum ? sum : null
      }
      const topic = topicOf(gap)
      return {
        id: gap.id,
        ref: gap.ref,
        topic: {
          areaId: topic.areaId,
          areaIds: domainsOf(topic),
          metrics: [...topic.metrics],
          dimensions: [...topic.dimensions],
          dimensionValues: topic.values.map((value) => ({
            dimension: dimensionOfValue(value),
            value,
          })),
          month: topic.month,
        },
        type: gap.type,
        status: gap.status,
        severity: gap.severity,
        openedBy: gapOrigin(gap.openedByCase),
        firstSeen: gap.firstSeen,
        lastSeen: gap.lastSeen,
        statusSince: gap.statusSince,
        reports: total((week) => week.reports),
        personReports: managed ? total((week) => week.personReports) : null,
        noItemCalls: total((week) => week.noItemCalls),
        weeks: shown,
        proposals: gap.proposals.filter((id) => !isDiscarded(id)).sort(),
        canManage: managed,
      }
    }

    function find(id: string): StoredGap {
      const gap = gaps.find((candidate) => candidate.id === id)
      if (!gap || !visible(gap))
        return refuse('not-found', "We couldn't find this gap, or you can't see it.")
      return gap
    }
    function managed(id: string): StoredGap {
      const gap = find(id)
      if (!canManage(gap))
        refuse('forbidden', 'Only an owner of the domain or an admin can do this.')
      return gap
    }
    function get(id: string): GapDetail {
      const gap = find(id)
      const managed = canManage(gap)
      const tests = managed
        ? [...gap.tests]
            .sort(
              (a, b) =>
                a.linkedHour.localeCompare(b.linkedHour) || a.question.localeCompare(b.question),
            )
            .map((test): GapTest => {
              const question = testReads().question(test.question)!
              return {
                ...structuredClone(test),
                split: question.split,
                active: question.status === 'active',
                latest: testReads().latest(question),
              }
            })
        : null
      const notes = canManage(gap)
        ? [...gap.notes]
            .sort((a, b) => a.createdHour.localeCompare(b.createdHour) || (a.id < b.id ? -1 : 1))
            .map(({ id: noteId, source, note, createdHour }) => ({
              id: noteId,
              source,
              note,
              createdHour,
            }))
        : null
      return {
        ...toGap(gap),
        notes,
        resolvedEdition: gap.resolvedEdition,
        verifiedAt: gap.verified?.hour ?? null,
        verifiedEdition: gap.verified?.edition ?? null,
        tests,
        history: managed ? structuredClone(gap.history) : null,
      }
    }
    const open = (status: GapStatus) => status === 'open' || status === 'proposal_made'

    return {
      list({ areaId, status, type, limit = 50, offset = 0 }: GapListParams = {}): Gap[] {
        if (!isInteger(limit, 1, 200) || !isInteger(offset, 0, Number.MAX_SAFE_INTEGER))
          refuse('bad-request', refusals.badRequest)
        return gaps
          .filter(
            (gap) =>
              visible(gap) &&
              (areaId === undefined || domainsOf(topicOf(gap)).includes(areaId)) &&
              (status === undefined || gap.status === status) &&
              (type === undefined || gap.type === type),
          )
          .sort(
            (a, b) =>
              Number(open(b.status)) - Number(open(a.status)) ||
              b.lastSeen.localeCompare(a.lastSeen) ||
              a.ref.localeCompare(b.ref),
          )
          .slice(offset, offset + limit)
          .map(toGap)
      },
      get,
      setStatus({ id, status, reason }: GapStatusInput): GapDetail {
        if (
          !(manualGapStatuses as readonly string[]).includes(status) ||
          (reason !== undefined && (reason.length < 1 || reason.length > 500))
        )
          refuse('bad-request', refusals.badRequest)
        const gap = managed(id)
        if (reason !== undefined) rejectSensitive(reason, 'reason')
        if (gap.status === status) return get(id)
        if (
          open(status) &&
          gaps.some(
            (other) =>
              other.id !== gap.id &&
              other.topic === gap.topic &&
              other.type === gap.type &&
              open(other.status),
          )
        )
          refuse('conflict', 'This topic already has an open gap of this type.')
        const before = gap.status
        const recorded =
          gap.resolvedEdition !== null ||
          gap.verified !== null ||
          gap.tests.some((test) => test.passed !== null)
        gap.status = status
        gap.statusSince = toHour(now())
        // FR-610: resolving records the live edition; leaving resolved clears the verification.
        gap.resolvedEdition = status === 'resolved' ? liveEdition() : null
        gap.verified = null
        const clears = clearsVerification(before, status)
        if (clears) for (const test of gap.tests) test.passed = null
        record(gap, 'gap.status_changed', {
          from: before,
          to: status,
          ...(gap.resolvedEdition ? { edition: gap.resolvedEdition } : {}),
          ...(reason === undefined ? {} : { reason }),
        })
        if (clears && recorded) record(gap, 'gap.verification_cleared')
        return get(id)
      },
      /** FR-610: as the service's linkTest; linking a test that is linked changes nothing. */
      linkTest({ id, question, evidenceRun }: GapLinkTestInput): GapDetail {
        const gap = managed(id)
        const found = testReads().question(question)
        if (!found || (found.split === 'held_out' && !manages(found.area)))
          refuse('not-found', "We couldn't find this test question, or you can't see it.")
        if (!domainsOf(topicOf(gap)).includes(found.area))
          refuse('invalid', 'This test question belongs to another domain than the gap.')
        if (evidenceRun !== undefined && testReads().areaRun(evidenceRun)?.area !== found.area)
          refuse('invalid', 'Choose a weekly or full test run of the gap’s domain.')
        if (!gap.tests.some((test) => test.question === question)) {
          gap.tests.push({
            question,
            linkedHour: toHour(now()),
            evidenceRun: evidenceRun ?? null,
            passed: null,
          })
          record(gap, 'gap.test_linked', {
            question,
            ...(evidenceRun === undefined ? {} : { evidenceRun }),
          })
        }
        return get(id)
      },
      /** Unlinks a test; a verification already recorded stays. */
      unlinkTest({ id, question }: GapUnlinkTestInput): GapDetail {
        const gap = managed(id)
        const before = gap.tests.length
        gap.tests = gap.tests.filter((test) => test.question !== question)
        if (gap.tests.length < before) record(gap, 'gap.test_unlinked', { question })
        return get(id)
      },
      addNote({ id, note }: GapNoteInput): GapDetail {
        if (note.length < 1 || note.length > 500) refuse('bad-request', refusals.badRequest)
        const gap = managed(id)
        rejectSensitive(note, 'note')
        gap.notes.push({ id: uuid(), source: 'owner', note, createdHour: toHour(now()) })
        record(gap, 'gap.note_added')
        return get(id)
      },
      /**
       * FR-606 case 5, as cl_report_gap_person and cl_gap_touch apply it: one report counts
       * against the topic's open gap of that type (or its won't-fix gap, which keeps its status),
       * and opens one when there is none or the last was resolved. Nothing names the person.
       */
      report({ topic, type, note }: { topic: GapTopic; type: GapType; note?: string }): GapReport {
        if (!topics.has(topic.key))
          topics.set(topic.key, {
            key: topic.key,
            areaId: topic.area,
            metrics: [...topic.metrics],
            values: [...topic.values],
            dimensions: [...topic.dimensions],
            month: topic.month,
            weeks: [],
          })
        const at = now()
        const day = at.slice(0, 10)
        const week = mondayOf(day)
        const candidates = gaps.filter((gap) => gap.topic === topic.key && gap.type === type)
        let gap =
          candidates.find((candidate) => open(candidate.status)) ??
          candidates.find((candidate) => candidate.status === 'wont_fix')
        if (!gap) {
          reported += 1
          gap = {
            id: `ca9b0000-0000-4000-8000-${reported.toString(16).padStart(12, '0')}`,
            ref: `gap_p${reported.toString(16).padStart(9, '0')}`,
            topic: topic.key,
            type,
            status: 'open',
            severity: 2,
            openedByCase: 5,
            firstSeen: day,
            lastSeen: day,
            statusSince: toHour(at),
            weeks: [],
            notes: [],
            proposals: [],
            resolvedEdition: null,
            verified: null,
            tests: [],
            history: [],
          }
          gaps.push(gap)
        }
        if (day > gap.lastSeen) gap.lastSeen = day
        const counts = gap.weeks.find((candidate) => candidate.week === week)
        if (counts) {
          counts.reports += 1
          counts.personReports = (counts.personReports ?? 0) + 1
        } else gap.weeks.push({ week, reports: 1, personReports: 1, noItemCalls: 0 })
        if (note !== undefined)
          gap.notes.push({ id: uuid(), source: 'person', note, createdHour: toHour(at) })
        return { id: gap.id }
      },
      /** FR-616: the draft a gap starts, filled with its topic's scope, in the chosen area. */
      draftOf(id: string, areaId?: string) {
        const gap = find(id)
        const topic = topicOf(gap)
        const area = areaId ?? topic.areaId
        if (!area)
          refuse(
            'bad-request',
            'This topic covers more than one domain. Choose the domain for the draft.',
          )
        return draftFromTopic(
          {
            metricKeys: topic.metrics,
            valueKeys: topic.values,
            dimensionKeys: topic.dimensions,
          },
          area,
        )
      },
      /**
       * Links a draft to the gap it started from; an open gap now has a draft. FR-524: the draft
       * carries the gap's linked, active development tests of its area (cl_gap_draft_tests),
       * which this returns.
       */
      linkProposal(id: string, proposalId: string, areaId: string | null): string[] {
        const gap = find(id)
        gap.proposals.push(proposalId)
        const tests = gap.tests
          .map((test) => reads?.question(test.question))
          .filter(
            (question) =>
              question?.split === 'development' &&
              question.status === 'active' &&
              question.area === areaId,
          )
          .map((question) => question!.id)
          .sort()
        if (gap.status === 'open') {
          gap.status = 'proposal_made'
          gap.statusSince = toHour(now())
        }
        record(gap, 'gap.draft_started', {
          proposal: proposalId,
          ...(tests.length ? { tests } : {}),
        })
        return tests
      },
      topicCounts({ areaId, weeks = 8 }: TopicCountsParams = {}): TopicCounts {
        if (!isInteger(weeks, 1, 52)) refuse('bad-request', refusals.badRequest)
        const since = addDays(mondayOf(today), -7 * (weeks - 1))
        const inWindow = world.topics.flatMap((topic) =>
          areaId !== undefined && !domainsOf(topic).includes(areaId)
            ? []
            : topic.weeks
                .filter((week) => week.week >= since)
                .map((week) => ({ topic, ...week, shown: week.calls >= minimum })),
        )
        return {
          minimumCount: minimum,
          rows: inWindow
            .filter((row) => row.shown)
            .sort(
              (a, b) =>
                b.week.localeCompare(a.week) ||
                b.calls - a.calls ||
                a.topic.key.localeCompare(b.topic.key),
            )
            .map(({ topic, week, calls, noItemCalls }) => {
              const shownNoItem = noItemCalls === 0 || noItemCalls >= minimum ? noItemCalls : null
              return {
                topic: {
                  areaId: topic.areaId,
                  areaIds: domainsOf(topic),
                  metrics: [...topic.metrics],
                  dimensions: [...topic.dimensions],
                  dimensionValues: topic.values.map((value) => ({
                    dimension: dimensionOfValue(value),
                    value,
                  })),
                  month: topic.month,
                },
                week,
                calls,
                noItemCalls: shownNoItem,
                noItemShare: visibleShare(shownNoItem, calls),
              }
            }),
          hiddenTopicWeeks: inWindow.filter((row) => !row.shown).length,
        }
      },
      /**
       * Calls per week over every topic. A total is hidden when it, or what it adds over the shown
       * topic weeks, is under the minimum (FR-614, `visibleTotal`), as on the service.
       */
      weeklyCalls({ weeks = 8 }: WeeklyCallsParams = {}): WeeklyCalls {
        if (!isInteger(weeks, 1, 52)) refuse('bad-request', refusals.badRequest)
        const monday = mondayOf(today)
        return {
          minimumCount: minimum,
          weeks: Array.from({ length: weeks }, (_, index) => {
            const week = addDays(monday, -7 * (weeks - 1 - index))
            let calls = 0
            let shownCalls = 0
            let noItemCalls = 0
            let shownNoItemCalls = 0
            for (const topic of world.topics)
              for (const row of topic.weeks)
                if (row.week === week) {
                  calls += row.calls
                  noItemCalls += row.noItemCalls
                  if (row.calls < minimum) continue
                  shownCalls += row.calls
                  shownNoItemCalls += visibleCount(row.noItemCalls, minimum) ?? 0
                }
            return {
              week,
              calls: visibleTotal(calls, shownCalls, minimum),
              noItemCalls: visibleTotal(noItemCalls, shownNoItemCalls, minimum),
              shownCalls,
            }
          }),
        }
      },
    }
  }

  /**
   * FR-610, as the service's verifyGapsByRun (gaps/verify.ts): a finished weekly or full run of an
   * area records, for each resolved gap of that area, the first pass of every linked test it
   * passed on the resolving edition or a later one, and verifies the gaps whose active tests have
   * all passed. The verification is the service's doing, so its history names no person. A gap
   * verified already keeps its fact; finishing the same run again changes nothing.
   */
  function verifyByRun({
    run,
    kind,
    area,
    edition,
    finishedAt,
    verdict,
    question,
    seqOf,
  }: {
    run: string
    kind: string
    area: string
    edition: string
    finishedAt: string
    /** The question's verdict in the run; null when the run did not test it. */
    verdict: (question: string) => Verdict | null
    question: (id: string) => TestQuestion | undefined
    /** An edition's sequence number by its label; null for one the mock does not know. */
    seqOf: (label: string) => number | null
  }) {
    const editionSeq = seqOf(edition)
    const hour = toHour(finishedAt)
    for (const gap of gaps) {
      if (gap.status !== 'resolved' || !domainsOf(topicOf(gap)).includes(area) || !gap.tests.length)
        continue
      const resolvedSeq = gap.resolvedEdition === null ? null : seqOf(gap.resolvedEdition)
      const facts = { kind, finished: true, editionSeq }
      for (const test of gap.tests) {
        const found = question(test.question)
        if (test.passed || !found || !passVerifies(facts, verdict(test.question), resolvedSeq))
          continue
        test.passed = { run, edition, revision: found.revision, hour }
      }
      if (gap.verified) continue
      const verification = gapVerification(
        gap.tests.map((test) => ({
          questionId: test.question,
          active: question(test.question)?.status === 'active',
          pass: test.passed
            ? { editionSeq: seqOf(test.passed.edition) ?? 0, hour: test.passed.hour }
            : null,
        })),
        resolvedSeq,
      )
      if (verification.state !== 'verified') continue
      const label =
        gap.tests.find(
          (test) => test.passed && seqOf(test.passed.edition) === verification.editionSeq,
        )?.passed?.edition ?? edition
      gap.verified = { hour: verification.hour, edition: label }
      gap.history.push({ action: 'gap.verified', hour, details: { edition: label, run } })
    }
  }

  return { as, verifyByRun }
}

export type MockGaps = ReturnType<typeof createMockGaps>
