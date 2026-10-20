import { useId, useMemo, useRef, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { TestQuestion } from '@/api'
import { runComparisonQuery } from '@/api/queries'
import { RecordBar, RecordBody, RecordHeading } from '@/components/page/record-parts'
import {
  WorkbenchPane,
  WorkbenchPanes,
  WorkbenchUnderFocus,
  WorkbenchTemplate,
  workbenchBarClass,
} from '@/components/page/workbench'
import { AppFamiliesOverview } from '@/components/quality/app-families'
import { RatingsOverview } from '@/components/quality/assistant-ratings'
import { DomainsVerdict, HealthGrid } from '@/components/quality/domains-view'
import {
  QuestionDialog,
  refusalText,
  type QuestionDraft,
} from '@/components/quality/question-dialog'
import { exportQuestions, ImportDialog, StartRunDialog } from '@/components/quality/question-files'
import {
  useDomainHealth,
  useQualityQuestions,
  useQualityScope,
  type HealthState,
} from '@/components/quality/use-quality'
import { DownloadIcon, PencilLineIcon, PlayIcon, UploadIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { TruncatedText } from '@/components/ui/truncated-text'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatDay } from '@/lib/library'
import { runKindWords } from '@/lib/quality'
import type { WorkbenchSearch } from '@/lib/search-params'
import { workbenchRecord, workbenchRecordTabs } from '@/lib/workbench-address'
import { scopeSummary } from '@/lib/workbench-scope'
import { showToast } from '@/lib/toast'
import { CompareFocus } from './compare-focus'
import { DomainRecord } from './domain-record'
import { GapRecord } from './gap-record'
import { ItemRecord } from './item-record'
import { workbenchLinks } from './links'
import { QuestionRecord } from './question-record'
import { RunRecord } from './run-record'
import { ScopeStrip } from './scope-strip'
import { useWorkList } from './use-work-list'
import { WorkList } from './work-list'

/*
  Health (the Workbench until the navigation decision of 12 October 2026; Workbench plan, slice
  W4; design round 2, layout A), on the Workbench page template: one working surface for
  owners, deputies and administrators. Under the scope strip, three panes: the work list on the
  left, the open record in the middle and its actions on the right, each scrolling on its own
  while the page stays put. With nothing open the record's place shows the domain overview, the
  first screen of Quality. The address holds the whole state (`?open=question:…&tab=…`).

  The template, the record frame and the scope strip came first (slice W4), then the work list
  (W5): what needs the person, ranked like Fix next, with its views and search, and its keys.
  A test question, a run and a domain open as records with their tabs and the action panel beside
  them (W6b), and so do a gap and an item (W6c); links inside a record open another record in the
  same place, keeping the tab. The Workbench took over from Quality and from the owners' Gaps
  page (W8): it is their entry in the sidebar, and their old links land here.

  A test question's two runs open side by side in the compare focus (W7, `mode=compare`, Shift C):
  it covers the list and the record, which stay underneath, inert, so Escape returns to the same
  row with the list scrolled as it was. 1, 2 and 3 show the open record's tabs.
*/

export function WorkbenchPage({ search }: { search: WorkbenchSearch }) {
  const navigate = useNavigate({ from: '/health' })
  const router = useRouter()
  const phone = useIsMobile()
  const scope = useQualityScope()
  const area: Area | undefined = search.area
    ? scope.areas.find((entry) => entry.id === search.area)
    : scope.areas.length === 1
      ? scope.areas[0]
      : undefined
  const shownAreas = area ? [area] : scope.areas
  const { questions, byId, query: questionsQuery } = useQualityQuestions(scope.areas)
  const health = useDomainHealth(shownAreas, questions, scope.ready)
  const rows = health.state === 'ready' ? health.rows : null
  const row = area ? rows?.find((candidate) => candidate.area.id === area.id) : undefined
  const latest = row?.answers ? { run: row.answers.run, finishedAt: row.answers.finishedAt } : null
  const comparison = useQuery({
    ...runComparisonQuery({
      id: latest?.run ?? '',
      ...(search.against ? { against: search.against } : {}),
    }),
    enabled: latest !== null,
  })
  const summary = scopeSummary({ rows, area: area?.id, comparison: comparison.data })
  // A run the person chose to compare with replaces the run before in the overview too, so the
  // verdict and the strip count the same changes.
  const chosen = area && search.against && comparison.data?.against ? comparison.data : undefined
  const shownHealth: HealthState =
    chosen && health.state === 'ready'
      ? {
          state: 'ready',
          rows: health.rows.map((entry) =>
            entry.area.id === chosen.area ? { ...entry, flips: { ...chosen.signTest } } : entry,
          ),
        }
      : health
  const baseline = chosen?.against
    ? `the ${runKindWords[chosen.against.kind].toLowerCase()} of ${formatDay(chosen.against.finishedAt)}`
    : undefined
  const shownQuestions = questions.filter((question) =>
    shownAreas.some((entry) => entry.id === question.area),
  )
  const writable = scope.areas.filter((entry) => scope.maintains(entry.id))
  const [writing, setWriting] = useState<QuestionDraft | null>(null)
  // The domain to run, and whether the record stays open when it starts: a gap waiting for a
  // passing run stays, so its verification shows; any other record opens the new run.
  const [running, setRunning] = useState<{ area: string; stay: boolean } | null>(null)
  const run = (area: string, stay = false) => setRunning({ area, stay })
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      await exportQuestions(area)
    } catch (error) {
      showToast("Couldn't export the test questions", refusalText(error))
    } finally {
      setExporting(false)
    }
  }
  const linkTo = useMemo(() => workbenchLinks(search), [search])

  // Within the page's entry (a record's tab, the next record) the entry keeps its state.
  const go = (patch: Partial<WorkbenchSearch>, replace = true) =>
    void navigate({
      to: '/health',
      search: (previous) => ({ ...previous, ...patch }),
      replace,
      ...(replace ? { state: true as const } : {}),
      resetScroll: false,
    })
  const record = workbenchRecord(search.open)
  const comparing = search.mode === 'compare' && record?.kind === 'question'
  // The record the compare focus was opened on with a new history entry: leaving it goes Back,
  // so Back leaves it too and the page returns to where it was scrolled.
  const comparedFrom = useRef<string | null>(null)
  // What had focus before, to have it back after: once the focus covers it, it has lost focus.
  const focusedBefore = useRef<Element | null>(null)
  const openCompare = () => {
    comparedFrom.current = search.open ?? null
    focusedBefore.current = document.activeElement
    void navigate({ to: '/health', search: { ...search, mode: 'compare' }, resetScroll: true })
  }
  const leaveCompare = () => {
    const opened = comparedFrom.current
    comparedFrom.current = null
    if (opened !== null && opened === search.open && window.history.length > 1)
      router.history.back()
    else go({ mode: undefined })
  }
  const recordTabKeys = record ? workbenchRecordTabs[record.kind] : []
  const list = useWorkList({
    search,
    areas: scope.areas,
    area,
    isAdmin: scope.isAdmin,
    ready: scope.ready,
    questions: byId,
    questionsRead: questionsQuery,
    comparison: comparison.isError ? undefined : comparison.data,
    comparing: latest !== null && comparison.isPending,
    focusMode:
      record?.kind === 'question'
        ? { on: comparing, toggle: comparing ? leaveCompare : openCompare }
        : undefined,
    showTab:
      recordTabKeys.length > 0
        ? (index) => {
            const tab = recordTabKeys[index]
            if (tab) go({ tab: index === 0 ? undefined : tab })
          }
        : undefined,
  })
  const { dock } = list
  const openRow = (open: string) => go(list.openSearch(open))
  // Where the record is in the work list, and previous and next in it.
  const place = {
    position: dock.position,
    onPrevious: dock.previousId ? () => openRow(dock.previousId!) : undefined,
    onNext: dock.nextId ? () => openRow(dock.nextId!) : undefined,
  }

  return (
    // The compare focus is a mode with a crumb of its own (contract 9.11): the page names it.
    <WorkbenchTemplate
      title={comparing ? 'Compare' : 'Health'}
      documentTitle={comparing ? 'Compare - Health' : 'Health'}
    >
      <ScopeStrip
        areas={scope.areas}
        area={area}
        summary={summary}
        failed={health.state === 'failed' ? health.retry : undefined}
        latest={latest}
        comparison={comparison.isError ? undefined : comparison.data}
        onArea={(next) =>
          go(
            {
              area: next,
              open: undefined,
              tab: undefined,
              run: undefined,
              against: undefined,
              cell: undefined,
              mode: undefined,
            },
            false,
          )
        }
        onAgainst={(against) => go({ against }, false)}
      />
      <WorkbenchPanes>
        {/* Under the compare focus the list and the record stay as they were, out of reach. */}
        <WorkbenchUnderFocus covered={comparing}>
          <WorkList
            list={list}
            search={search}
            areas={scope.areas}
            hidden={phone && record !== null}
          />
          {record?.kind === 'question' ? (
            <QuestionRecord
              key={search.open}
              id={record.id}
              question={byId.get(record.id)}
              loading={!scope.ready || questionsQuery.isPending}
              area={scope.areaOf(byId.get(record.id)?.area ?? null)}
              search={search}
              linkTo={linkTo}
              maintains={scope.maintains(byId.get(record.id)?.area ?? '')}
              questions={byId}
              place={place}
              onTab={(tab) => go({ tab })}
              onClose={dock.closePanel}
              onEdit={(question) => setWriting({ mode: 'edit', question })}
              onRun={run}
              onCompare={openCompare}
            />
          ) : record?.kind === 'run' ? (
            <RunRecord
              key={search.open}
              id={record.id}
              search={search}
              linkTo={linkTo}
              areaOf={(id) => scope.areaOf(id)}
              questions={byId}
              maintains={scope.maintains}
              isAdmin={scope.isAdmin}
              place={place}
              onTab={(tab) => go({ tab })}
              onClose={dock.closePanel}
              onRun={run}
            />
          ) : record?.kind === 'domain' ? (
            <DomainRecord
              key={search.open}
              id={record.id}
              area={scope.areas.find((entry) => entry.id === record.id)}
              ready={scope.ready}
              search={search}
              linkTo={linkTo}
              questions={questions.filter((question) => question.area === record.id)}
              maintains={scope.maintains(record.id)}
              areaOf={scope.areaOf}
              place={place}
              onTab={(tab) => go({ tab })}
              onClose={dock.closePanel}
              onRun={() => run(record.id)}
              onWrite={(action) =>
                setWriting({
                  mode: 'new',
                  area: record.id,
                  ...(action ? { itemId: action.itemId } : {}),
                })
              }
            />
          ) : record?.kind === 'gap' ? (
            <GapRecord
              key={search.open}
              id={record.id}
              search={search}
              linkTo={linkTo}
              questions={byId}
              maintains={scope.maintains}
              place={place}
              onTab={(tab) => go({ tab })}
              onClose={dock.closePanel}
              onRun={(area) => run(area, true)}
              onWriteTest={(area, gap) => setWriting({ mode: 'new', area, gap })}
            />
          ) : record?.kind === 'item' ? (
            <ItemRecord
              key={search.open}
              id={record.id}
              scope={area?.id}
              editions={(areaId) =>
                comparison.data?.area === areaId && comparison.data.against
                  ? { from: comparison.data.against.edition, to: comparison.data.run.edition }
                  : undefined
              }
              areaOf={scope.areaOf}
              maintains={scope.maintains}
              place={place}
              onClose={dock.closePanel}
              onWrite={(item) => setWriting({ mode: 'new', area: item.areaId, itemId: item.id })}
            />
          ) : (
            <DomainOverview
              area={area}
              onlyDomain={scope.areas.length === 1}
              isAdmin={scope.isAdmin}
              phone={phone}
              search={search}
              health={shownHealth}
              baseline={baseline}
              questions={shownQuestions}
              canWrite={writable.length > 0}
              onWrite={() =>
                setWriting({
                  mode: 'new',
                  area: area?.id ?? (writable.length === 1 ? writable[0]!.id : undefined),
                })
              }
              onImport={() => setImporting(true)}
              onExport={() => void runExport()}
              exporting={exporting}
              onRun={area && scope.maintains(area.id) ? () => run(area.id) : undefined}
            />
          )}
        </WorkbenchUnderFocus>
        {comparing ? (
          <CompareFocus
            key={search.open}
            id={record.id}
            question={byId.get(record.id)}
            loading={!scope.ready || questionsQuery.isPending}
            area={scope.areaOf(byId.get(record.id)?.area ?? null)}
            search={search}
            meta={`Test question${dock.position ? ` · ${dock.position.index + 1} of ${dock.position.total}` : ''}`}
            returnFocus={focusedBefore}
            onLeave={leaveCompare}
          />
        ) : null}
      </WorkbenchPanes>
      {writing ? (
        <QuestionDialog
          draft={writing}
          areas={writable}
          takenIds={new Set(questions.map((question) => question.id))}
          onClose={() => setWriting(null)}
          onSaved={(saved: TestQuestion) => {
            const fromGap = writing.mode === 'new' && writing.gap
            setWriting(null)
            // A test written from a gap is linked to it, and the gap's record shows it there.
            if (!fromGap) go({ open: `question:${saved.id}`, tab: undefined })
          }}
        />
      ) : null}
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
      {running && scope.areaOf(running.area) ? (
        <StartRunDialog
          area={scope.areaOf(running.area)!}
          onClose={() => setRunning(null)}
          onStarted={(started) => {
            setRunning(null)
            if (!running.stay) go({ open: `run:${started}`, tab: undefined, cell: undefined })
          }}
        />
      ) : null}
    </WorkbenchTemplate>
  )
}

/**
 * With nothing open: the domain overview, Quality's first screen folded into the scope. The
 * verdict says whether answers are better than last time, and the grid gives each domain's health;
 * a domain opens as a record; under it, the assistant's ratings this week and, over every
 * domain, how the AI apps that called Heed fared this week. Above them, for
 * whoever maintains a domain in scope, what Quality's toolbar offered: write a test question,
 * import and export them, and run the domain in scope.
 */
function DomainOverview({
  area,
  onlyDomain,
  isAdmin,
  phone,
  search,
  health,
  baseline,
  questions,
  canWrite,
  onWrite,
  onImport,
  onExport,
  exporting,
  onRun,
}: {
  area: Area | undefined
  /** The person looks after this one domain only, so it is every domain they look after. */
  onlyDomain: boolean
  isAdmin: boolean
  phone: boolean
  search: WorkbenchSearch
  health: HealthState
  baseline: string | undefined
  /** The test questions of the domains shown. */
  questions: readonly TestQuestion[]
  canWrite: boolean
  onWrite: () => void
  onImport: () => void
  onExport: () => void
  exporting: boolean
  /** Runs the domain in scope, when the person maintains it. */
  onRun: (() => void) | undefined
}) {
  const titleId = useId()
  const title = area ? area.name : isAdmin ? 'Every domain' : 'Your domains'
  return (
    <WorkbenchPane aria-labelledby={titleId} data-slot="workbench-overview">
      <RecordBar
        meta={`${area ? area.name : 'All domains'} · nothing open`}
        browse={false}
        touch={phone}
        className={workbenchBarClass}
      />
      <RecordHeading
        title={title}
        titleId={titleId}
        note={
          <p className="text-dense text-muted-foreground">
            Nothing is open. Open a domain below to see its test questions and runs.
          </p>
        }
      />
      <RecordBody clearLauncher>
        <div className="flex max-w-overview flex-col gap-6">
          {canWrite ? (
            <div
              role="group"
              aria-label="Test questions"
              className="flex flex-wrap items-center gap-2"
            >
              <Button variant="outline" size="toolbar" onClick={onWrite}>
                <PencilLineIcon aria-hidden="true" />
                Write a test question
              </Button>
              {onRun && area ? (
                <Button
                  variant="outline"
                  size="toolbar"
                  className="max-w-full min-w-0"
                  onClick={onRun}
                >
                  <PlayIcon aria-hidden="true" />
                  <TruncatedText text={`Run ${area.name}`} />
                </Button>
              ) : null}
              <Button variant="ghost" size="toolbar" onClick={onImport}>
                <UploadIcon aria-hidden="true" />
                Import
              </Button>
              <Button
                variant="ghost"
                size="toolbar"
                aria-disabled={exporting || undefined}
                onClick={onExport}
              >
                <DownloadIcon aria-hidden="true" />
                Export
              </Button>
            </div>
          ) : null}
          <DomainsVerdict health={health} questions={questions} baseline={baseline} />
          <HealthGrid health={health} workbench={search} canWrite={canWrite} onWrite={onWrite} />
          {health.state === 'ready' && health.rows.length ? (
            <RatingsOverview areas={health.rows.map((row) => row.area)} everyDomain={!area} />
          ) : null}
          {/* A request names no domain, so the AI apps show where every domain the person looks after is in scope. */}
          {!area || onlyDomain ? <AppFamiliesOverview /> : null}
        </div>
      </RecordBody>
    </WorkbenchPane>
  )
}
