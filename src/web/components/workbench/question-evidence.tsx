import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { EditionItemComparison, Gap, QuestionComparison, TestQuestion } from '@/api'
import {
  areasQuery,
  libraryQuery,
  peopleQuery,
  topicCountsQuery,
  vocabularyQuery,
} from '@/api/queries'
import { EditionChangeCard } from '@/components/editions/change-card'
import { WeeksTable } from '@/components/gaps/gap-body'
import { GapStatusBadge } from '@/components/gaps/gap-marks'
import {
  CheckIcon,
  CircleSlashIcon,
  CircleXIcon,
  GitCompareArrowsIcon,
  ListChecksIcon,
  MinusIcon,
  PackageIcon,
  ScaleIcon,
  SearchIcon,
  SearchXIcon,
  TextQuoteIcon,
  type Icon,
} from '@/components/icons'
import { KindIcon } from '@/components/item/item-marks'
import { RecordSection } from '@/components/page/record-parts'
import { RecordLink, type LinkTo } from '@/components/quality/panel-parts'
import type { DiffLookups } from '@/components/review/field-diff'
import { Skeleton } from '@/components/ui/skeleton'
import { gapWeeks, privacyNote, topicTitle } from '@/lib/gaps'
import { formatDay } from '@/lib/library'
import { targetsByKey } from '@/lib/mention-targets'
import { checkName, runKindWords } from '@/lib/quality'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { cn } from '@/lib/utils'
import { checkTallies, deliveredRows, type CheckTally, type Given } from '@/lib/workbench-evidence'

/*
  The Evidence tab of a test question's record in the Workbench (Workbench plan, slice W6b): each
  check on the run beside the run it is compared with, what Heed gave the controlled test on each
  edition, what changed in those items between the two editions (the diff kit's card), and the
  gaps on the question's scope with their anonymous weekly counts. The Test result and History
  tabs use its marks too.
*/

export type Side = QuestionComparison['run']

export const namingWords = {
  must_deliver: 'Must get',
  must_not_deliver: 'Must not get',
  reachable_via_link: 'Reaches by a link',
} as const

/** "the weekly run of 5 Oct 2026". */
export const runWords = (side: Side) =>
  `the ${runKindWords[side.run.kind].toLowerCase()} of ${formatDay(side.run.finishedAt)}`

/** "4 of 6 tries". */
export const triesWords = ({ held, tries }: Pick<CheckTally, 'held' | 'tries'>) =>
  `${held.toLocaleString('en')} of ${tries.toLocaleString('en')} ${tries === 1 ? 'try' : 'tries'}`

/** Pass or fail, by a word and a mark; colour is never the only sign. */
export function Outcome({ held }: { held: boolean | null }) {
  if (held === null)
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <MinusIcon aria-hidden="true" className="size-icon-sm" />
        Not checked
      </span>
    )
  return (
    <span
      data-tone={held ? 'success' : 'danger'}
      className="flex items-center gap-1 font-bold text-tone-ink"
    >
      {held ? (
        <CheckIcon aria-hidden="true" className="size-icon-sm" />
      ) : (
        <CircleXIcon aria-hidden="true" className="size-icon-sm" />
      )}
      {held ? 'Pass' : 'Fail'}
    </span>
  )
}

/** One check: its outcome on the run, the tries, and how it went on the run compared with. */
function CheckTile({
  name,
  icon: Glyph,
  held,
  detail,
  before,
}: {
  name: string
  icon: Icon
  held: boolean | null
  detail: string
  before: string | null
}) {
  return (
    <li
      data-slot="check"
      data-held={held === null ? undefined : held}
      className="flex min-w-0 flex-col gap-1 rounded-sm border bg-card px-3 py-2 text-dense"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground">
          <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="truncate">{name}</span>
        </span>
        <Outcome held={held} />
      </span>
      <span>{detail}</span>
      {before ? <span className="text-caption text-muted-foreground">{before}</span> : null}
    </li>
  )
}

const checkIcons: Record<string, Icon> = {
  delivered: PackageIcon,
  not_delivered: CircleSlashIcon,
  cited: TextQuoteIcon,
  caveat: ScaleIcon,
  no_cause_claim: ListChecksIcon,
}

/** The checks on the run, each beside the run it is compared with. */
export function Checks({
  data,
  retrieval,
}: {
  data: QuestionComparison
  retrieval: readonly { edition: string; passed: boolean; checks: Record<string, boolean> }[]
}) {
  const now = checkTallies(data.run)
  const then = new Map(checkTallies(data.against).map((tally) => [tally.check, tally]))
  const passOf = (edition: string | undefined) =>
    retrieval.find((pass) => pass.edition === edition) ?? null
  const retrievalNow = passOf(data.run.run.edition)
  const retrievalThen = data.against ? passOf(data.against.run.edition) : null
  const failedRetrieval = Object.entries(retrievalNow?.checks ?? {})
    .filter(([, held]) => !held)
    .map(([check]) => checkName(check))
  const before = (text: string | null) => (data.against && text ? `Before: ${text}` : null)
  return (
    <RecordSection title="Checks" icon={ListChecksIcon}>
      <p className="text-dense text-muted-foreground">
        {sentence(runWords(data.run))}
        {data.against ? `, against ${runWords(data.against)}` : ''}.
      </p>
      <ul
        aria-label="Checks"
        className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @2xl:grid-cols-3"
        data-slot="checks"
      >
        <CheckTile
          name="Right facts"
          icon={SearchIcon}
          held={retrievalNow?.passed ?? null}
          detail={
            retrievalNow === null
              ? 'Not checked for this run'
              : failedRetrieval.length
                ? `Failed: ${failedRetrieval.join(', ')}`
                : 'Every wording got the facts it should'
          }
          before={before(
            retrievalThen === null ? null : retrievalThen.passed ? 'passed' : 'failed',
          )}
        />
        {now.map((tally) => {
          const earlier = then.get(tally.check)
          return (
            <CheckTile
              key={tally.check}
              name={sentence(checkName(tally.check))}
              icon={checkIcons[tally.check] ?? ListChecksIcon}
              held={tally.held === tally.tries}
              detail={triesWords(tally)}
              before={before(earlier ? triesWords(earlier) : null)}
            />
          )
        })}
      </ul>
      {now.length === 0 ? (
        <p className="text-dense text-muted-foreground">
          {data.run.revision === null
            ? `${sentence(runWords(data.run))} didn't test this question.`
            : 'No try of this run was scored.'}
        </p>
      ) : null}
    </RecordSection>
  )
}

/** "Given in 6 of 6", "Not given" or "Not run"; in the danger ink when an expected item was lost. */
function GivenCell({ given, lost = false }: { given: Given | null; lost?: boolean }) {
  if (!given || given.of === 0) return <span className="text-muted-foreground">Not run</span>
  return (
    <span
      data-tone={lost ? 'danger' : undefined}
      className={cn(lost ? 'text-tone-ink' : given.tries === 0 && 'text-muted-foreground')}
    >
      {given.tries === 0
        ? 'Not given'
        : `Given in ${given.tries.toLocaleString('en')} of ${given.of.toLocaleString('en')}`}
    </span>
  )
}

/** A check's name as a label: "Caveat kept". */
const sentence = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

/** Item titles from the library's one cache, and from the comparison for a changed item. */
export function useItemTitles(data: QuestionComparison) {
  const library = useQuery(libraryQuery())
  return (id: string) => {
    const changed = data.items.find((item) => item.itemId === id)
    if (changed) return { title: changed.title, kind: changed.kind }
    const item = library.data?.items.find((candidate) => candidate.id === id)
    if (item) return { title: item.title, kind: item.kind }
    return { title: library.isPending ? '' : "A fact you can't open", kind: null }
  }
}

/** What Heed gave the controlled test on each edition, item by item. */
export function Delivered({
  question,
  data,
}: {
  question: TestQuestion
  data: QuestionComparison
}) {
  const rows = deliveredRows(question, data)
  const titleOf = useItemTitles(data)
  const changed = new Set(data.items.map((item) => item.itemId))
  if (rows.length === 0)
    return (
      <RecordSection title="What the test got" icon={PackageIcon}>
        <p className="text-body text-muted-foreground">
          The question names no fact, and no try got one.
        </p>
      </RecordSection>
    )
  const cell = 'px-3 py-2 align-top'
  return (
    <RecordSection title="What the test got" icon={PackageIcon}>
      <table
        data-slot="delivered"
        className="w-full border-separate border-spacing-0 overflow-hidden rounded-sm border text-dense"
      >
        <caption className="sr-only">The facts each run gave the test question</caption>
        <thead className="text-left text-muted-foreground">
          <tr className="h-row">
            <th scope="col" className={cn(cell, 'border-b font-normal')}>
              Fact
            </th>
            {data.against ? (
              <th scope="col" className={cn(cell, 'border-b border-l font-normal')}>
                <span className="whitespace-nowrap">{formatDay(data.against.run.finishedAt)}</span>
              </th>
            ) : null}
            <th scope="col" className={cn(cell, 'border-b border-l font-normal')}>
              <span className="whitespace-nowrap">{formatDay(data.run.run.finishedAt)}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const { title, kind } = titleOf(row.itemId)
            // An expected item some try was not given, or a forbidden one some try was.
            const lost =
              (row.named === 'must_deliver' && row.run.tries < row.run.of) ||
              (row.named === 'must_not_deliver' && row.run.tries > 0)
            return (
              <tr
                key={row.itemId}
                className="h-row"
                data-changed={changed.has(row.itemId) || undefined}
              >
                <th
                  scope="row"
                  className={cn(cell, 'text-left font-normal', index > 0 && 'border-t')}
                >
                  <span className="flex min-w-0 items-start gap-2">
                    {kind ? <KindIcon kind={kind} size="sm" /> : null}
                    <span className="flex min-w-0 flex-col">
                      <Link
                        to="/library/$itemId"
                        params={{ itemId: row.itemId }}
                        className="break-words underline-offset-3 hover:underline"
                      >
                        {title || <Skeleton className="h-4 w-1/2" />}
                      </Link>
                      <span className="text-caption text-muted-foreground">
                        {row.named ? namingWords[row.named] : 'Not named by the question'}
                        {changed.has(row.itemId) ? ' · changed between the runs' : ''}
                      </span>
                    </span>
                  </span>
                </th>
                {data.against ? (
                  <td className={cn(cell, 'border-l', index > 0 && 'border-t')}>
                    <GivenCell given={row.against} />
                  </td>
                ) : null}
                <td className={cn(cell, 'border-l', index > 0 && 'border-t')}>
                  <GivenCell given={row.run} lost={lost} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-caption text-muted-foreground">
        From controlled test calls, counted over every try. Given means the agent got the fact. It
        doesn&apos;t show what the agent did with it.
      </p>
    </RecordSection>
  )
}

/** Lookups the diff kit's card needs: the domains, the people and the mention targets. */
export function useDiffLookups(): DiffLookups {
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const { targets } = useMentionTargets()
  return useMemo(
    () => ({
      areas,
      targets: targetsByKey(targets),
      nameOf: (id) => people.find((person) => person.id === id)?.name ?? null,
    }),
    [areas, people, targets],
  )
}

/** The items the question names or was given that changed between the two runs' editions. */
export function ItemChanges({
  data,
  changed,
}: {
  data: QuestionComparison
  changed: {
    item: QuestionComparison['items'][number]
    comparison:
      { data?: EditionItemComparison; isError: boolean; refetch: () => unknown } | undefined
  }[]
}) {
  const lookups = useDiffLookups()
  if (!data.against) return null
  const title = 'What changed in these facts'
  if (data.against.run.edition === data.run.run.edition)
    return (
      <RecordSection title={title} icon={GitCompareArrowsIcon}>
        <p className="text-body text-muted-foreground">
          Both runs used the same facts, so none changed between them. A difference comes from the
          answers, not the facts.
        </p>
      </RecordSection>
    )
  return (
    <RecordSection title={title} icon={GitCompareArrowsIcon}>
      {changed.length === 0 ? (
        <p className="text-body text-muted-foreground">
          None of the facts the question names or got changed between the two runs.
        </p>
      ) : (
        <>
          <p className="text-dense text-muted-foreground">
            Changed between the two runs. A change here may explain a different result. Whether it
            does is for you to confirm.
          </p>
          <ul className="flex flex-col gap-4" aria-label="Changed facts">
            {changed.map(({ item, comparison }) => (
              <li key={item.itemId} className="flex min-w-0 flex-col gap-2">
                <p className="text-dense text-muted-foreground">
                  {item.named.length ? `${namingWords[item.named[0]!]}. ` : ''}
                  {item.delivered.against && !item.delivered.run
                    ? 'Given before, not given now.'
                    : !item.delivered.against && item.delivered.run
                      ? 'Not given before, given now.'
                      : item.delivered.run
                        ? 'Given in both runs.'
                        : 'Given in neither run.'}
                </p>
                {comparison?.data ? (
                  <EditionChangeCard comparison={comparison.data} lookups={lookups} />
                ) : comparison?.isError ? (
                  <p className="text-body text-muted-foreground">
                    We couldn&apos;t load what changed in {item.title}.{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void comparison.refetch()}
                    >
                      Try again
                    </button>
                  </p>
                ) : (
                  <Skeleton
                    role="status"
                    aria-label={`Loading what changed in ${item.title}`}
                    className="h-row-scope w-full"
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {data.withheld ? (
        <p className="text-caption text-muted-foreground">
          {data.withheld === 1
            ? "One more changed fact is only for some groups, so it isn't shown."
            : `${data.withheld.toLocaleString('en')} more changed facts are only for some groups, so they aren't shown.`}
        </p>
      ) : null}
    </RecordSection>
  )
}

/** The gaps on the question's scope, with their anonymous weekly counts. */
export function SameScope({
  gaps,
  matching,
  linkTo,
}: {
  /** The gap list's read, for its loading and error states. */
  gaps: { isPending: boolean; isError: boolean; data?: unknown; refetch: () => unknown }
  /** The gaps on the question's scope. */
  matching: readonly Gap[]
  linkTo: LinkTo
}) {
  const vocabulary = useQuery(vocabularyQuery())
  const counts = useQuery(topicCountsQuery())
  // Until the minimum is known every count but zero is hidden (lib/gaps.ts).
  const minimum = counts.data?.minimumCount ?? null
  const title = 'Gaps on the same topic'
  return (
    <RecordSection title={title} icon={SearchXIcon}>
      {gaps.isPending ? (
        <Skeleton role="status" aria-label="Loading the gaps" className="h-row-scope w-full" />
      ) : gaps.isError && !gaps.data ? (
        <p className="text-body text-muted-foreground">
          We couldn&apos;t load the gaps.{' '}
          <button type="button" className="underline" onClick={() => void gaps.refetch()}>
            Try again
          </button>
        </p>
      ) : matching.length === 0 ? (
        <p className="text-body text-muted-foreground">
          No gap is about this question’s topic. Either agents haven&apos;t missed anything on it,
          or you can&apos;t see such a gap here.
        </p>
      ) : (
        <ul className="flex flex-col gap-6" aria-label="Gaps on this topic">
          {matching.map((gap) => (
            <li key={gap.id} className="flex min-w-0 flex-col gap-3" data-slot="scope-gap">
              <div className="flex flex-wrap items-center gap-2">
                <RecordLink
                  linkTo={linkTo}
                  record={`gap:${gap.id}`}
                  className="text-body font-bold"
                >
                  {topicTitle(gap.topic, vocabulary.data)}
                </RecordLink>
                <GapStatusBadge status={gap.status} size="sm" />
              </div>
              {gap.weeks.length ? (
                <WeeksTable weeks={gapWeeks(gap, minimum)} />
              ) : (
                <p className="text-dense text-muted-foreground">No weeks counted yet.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">
        Calls and reports per week, not people; no question is stored. {privacyNote(minimum)}
      </p>
    </RecordSection>
  )
}
