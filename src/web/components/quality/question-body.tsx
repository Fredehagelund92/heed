import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { TestQuestion } from '@/api'
import { libraryQuery, useApiWrite } from '@/api/queries'
import { ConfirmDialog } from '@/components/form/confirm-dialog'
import {
  CalendarIcon,
  CircleSlashIcon,
  FileTextIcon,
  HeedDomainIcon,
  HeedRiskIcon,
  HistoryIcon,
  ListChecksIcon,
  MessageSquareIcon,
  QuoteIcon,
  RotateCcwIcon,
  SearchIcon,
  SplitIcon,
  TargetIcon,
  TextQuoteIcon,
} from '@/components/icons'
import { FieldRow, FieldTable } from '@/components/item/field-table'
import { KindIcon } from '@/components/item/item-marks'
import { RecordSection } from '@/components/page/record-parts'
import { formatDay } from '@/lib/library'
import { showToast } from '@/lib/toast'

/*
  A test question's record body, without a frame (Workbench plan, slice W6a): how it is asked,
  what agents must and must not get and what a good answer holds, and its details; and setting it
  aside. The Workbench's question record (its Evidence tab) and its actions show them.
*/

const riskWords = { low: 'Low', normal: 'Normal', high: 'High' } as const

/** Items by id with their titles, from the library's one cache. */
function ItemList({ ids, empty }: { ids: readonly string[]; empty: string }) {
  const { data: library } = useQuery(libraryQuery())
  if (ids.length === 0) return <span className="text-muted-foreground">{empty}</span>
  return (
    <ul className="flex flex-col gap-1">
      {ids.map((id) => {
        const item = library?.items.find((candidate) => candidate.id === id)
        return (
          <li key={id} className="flex min-w-0 items-center gap-2">
            {item ? <KindIcon kind={item.kind} size="sm" /> : null}
            <Link
              to="/library/$itemId"
              params={{ itemId: id }}
              className="min-w-0 truncate underline-offset-3 hover:underline"
            >
              {item?.title ?? id}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** How the question is asked, what a good answer has, and its details. */
export function QuestionText({ question }: { question: TestQuestion }) {
  return (
    <>
      <RecordSection title="How it is asked" icon={QuoteIcon}>
        <ul className="flex flex-col gap-3">
          {question.wordings.map((wording, index) => (
            <li key={index} className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                {wording.kind === 'natural' ? 'As a person asks it' : 'Precisely'}
              </span>
              <span className="text-body">{wording.text}</span>
            </li>
          ))}
        </ul>
      </RecordSection>
      <RecordSection title="What a good answer has" icon={TargetIcon}>
        <FieldTable label="What a good answer has" wideLabels>
          <FieldRow icon={ListChecksIcon} label="Must get">
            <ItemList ids={question.expected.must_deliver} empty="No fact named" />
          </FieldRow>
          <FieldRow icon={CircleSlashIcon} label="Must not get">
            <ItemList ids={question.expected.must_not_deliver} empty="No fact named" />
          </FieldRow>
          {question.expected.reachable_via_link ? (
            <FieldRow icon={SearchIcon} label="Reaches by a link">
              <ItemList ids={question.expected.reachable_via_link} empty="No fact named" />
            </FieldRow>
          ) : null}
          <FieldRow icon={TextQuoteIcon} label="Must mention">
            {question.expected.caveat ?? <span className="text-muted-foreground">None</span>}
          </FieldRow>
          <FieldRow icon={MessageSquareIcon} label="Cause">
            {question.expected.no_cause_claim ? 'Claims no cause' : 'May name a cause'}
          </FieldRow>
          <FieldRow icon={MessageSquareIcon} label="Clarifying">
            {question.expected.clarifying_question
              ? 'Asks a clarifying question'
              : 'Answers without asking back'}
          </FieldRow>
        </FieldTable>
        {question.rubrics.length ? (
          <ol className="flex list-inside list-decimal flex-col gap-1 text-body">
            {question.rubrics.map((rubric, index) => (
              <li key={index}>{rubric}</li>
            ))}
          </ol>
        ) : null}
      </RecordSection>
      <RecordSection title="Details" icon={FileTextIcon}>
        <FieldTable label="Details of the test question">
          <FieldRow icon={HeedDomainIcon} label="Name">
            <span className="font-mono">{question.id}</span>
          </FieldRow>
          <FieldRow
            icon={SplitIcon}
            label="Set"
            hint={
              question.split === 'held_out'
                ? 'Kept hidden to check the targets. Only owners read it.'
                : 'Used while improving the facts.'
            }
          >
            {question.split === 'held_out' ? 'Hidden' : 'Visible'}
          </FieldRow>
          <FieldRow icon={HeedRiskIcon} label="Risk">
            {riskWords[question.risk]}
          </FieldRow>
          <FieldRow icon={FileTextIcon} label="Source">
            {question.source}
          </FieldRow>
          <FieldRow icon={HistoryIcon} label="Revision">
            {question.revision.toLocaleString('en')}
          </FieldRow>
          <FieldRow icon={CalendarIcon} label="Changed">
            {formatDay(question.updatedAt, 'long')}
          </FieldRow>
        </FieldTable>
      </RecordSection>
    </>
  )
}

/** Sets a question aside with a reason, or brings it back (FR-514). */
export function SetAsideDialog({
  question,
  onClose,
}: {
  question: TestQuestion
  onClose: () => void
}) {
  const write = useApiWrite('setAsideTestQuestion')
  const back = question.setAsideReason !== null
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={back ? 'Bring this test question back?' : 'Set this test question aside?'}
      effect={
        back
          ? 'Runs test it again from the next one.'
          : 'Runs skip it until you bring it back. Its results stay.'
      }
      action={back ? 'Bring back' : 'Set aside'}
      actionIcon={back ? RotateCcwIcon : CircleSlashIcon}
      {...(back
        ? {}
        : {
            reason: {
              required: true,
              hint: 'Say why, so the next owner knows when to bring it back.',
            },
          })}
      onConfirm={async ({ reason }) => {
        await write.mutateAsync({
          id: question.id,
          revision: question.revision,
          reason: back ? null : reason.trim(),
        })
        showToast(back ? 'The test question is back' : 'The test question is set aside')
        onClose()
      }}
    />
  )
}
