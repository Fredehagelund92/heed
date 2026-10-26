import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AttachedTest, ProposalRecord } from '@/api'
import { proposalTestsQuery, testQuestionsQuery, useApiWrite } from '@/api/queries'
import { LoaderCircleIcon, UnlinkIcon } from '@/components/icons'
import { refusalText } from '@/components/quality/question-dialog'
import { Button } from '@/components/ui/button'
import { readAttachedTest, reportOnly, withResults } from '@/lib/attached-tests'
import { questionTitle } from '@/lib/quality'
import { showToast } from '@/lib/toast'
import { usePermissions } from '@/lib/use-session'
import { CheckGlyph } from './gate-result'
import { PartCard } from './part-card'

/*
  The test questions attached to a draft or proposal (FR-524, Workbench plan, slice V6), under
  its checks on the Add context form, the proposal's page and panel, and the review screen and
  panel. Each test says where delivery stands with the change (no answer test runs on a
  proposal), and the part says once that these results are reported and never block. Detach is
  offered to whoever may: the draft's author while it is a draft, the area's owners, deputies and
  administrators until a decision. The service checks again. With no test attached the part is
  not shown.
*/

export function AttachedTests({
  proposal,
  results,
  headingLevel = 2,
}: {
  proposal: Pick<ProposalRecord, 'id' | 'state' | 'areaId' | 'proposerId'>
  /** The gate's results for each attached test; a draft has none until it is submitted. */
  results?: readonly AttachedTest[]
  headingLevel?: 2 | 3
}) {
  const tests = useQuery(proposalTestsQuery(proposal.id))
  const questions = useQuery({
    ...testQuestionsQuery({ area: proposal.areaId ?? undefined }),
    enabled: Boolean(proposal.areaId) && Boolean(tests.data?.length),
  })
  const { canAttachTests } = usePermissions()
  const detach = useApiWrite('detachProposalTest')
  const [detaching, setDetaching] = useState<string | null>(null)
  if (!tests.data?.length) return null
  const mayDetach = canAttachTests(proposal)
  const byId = new Map((questions.data ?? []).map((question) => [question.id, question]))
  const remove = async (question: string, name: string) => {
    setDetaching(question)
    try {
      await detach.mutateAsync({ id: proposal.id, question })
      showToast('Test detached', `We no longer report ${name} with this change.`)
    } catch (error) {
      showToast("Couldn't detach the test", refusalText(error))
    } finally {
      setDetaching(null)
    }
  }
  return (
    <PartCard title="Attached tests" headingLevel={headingLevel} data-slot="attached-tests">
      <p className="text-caption text-muted-foreground">
        Test questions checked with this change. {reportOnly}
      </p>
      <ul className="flex flex-col" aria-label="Attached tests">
        {withResults(tests.data, results).map((test) => {
          const reading = readAttachedTest(test, { state: proposal.state })
          const name = questionTitle(byId.get(test.question), test.question)
          return (
            <li
              key={test.question}
              data-slot="attached-test"
              data-state={reading.state}
              className="flex gap-3 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <CheckGlyph state={reading.state} className="h-5 items-center" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-dense font-bold break-words">{name}</p>
                <p className="text-caption text-muted-foreground">{reading.delivery}</p>
                {reading.answer ? (
                  <p className="text-caption text-muted-foreground">{reading.answer}</p>
                ) : null}
                {mayDetach ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    aria-label={`Detach ${name}`}
                    aria-disabled={detaching !== null || undefined}
                    onClick={() => {
                      if (detaching === null) void remove(test.question, name)
                    }}
                  >
                    {detaching === test.question ? (
                      <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                    ) : (
                      <UnlinkIcon aria-hidden="true" />
                    )}
                    Detach
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </PartCard>
  )
}
